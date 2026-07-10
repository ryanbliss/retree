import { IReactiveDependency, ReactiveNode } from "../ReactiveNode";
import { TreeNode } from "../types";
import {
    getCustomProxyHandlerFromMetadata,
    isCustomProxy,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types";

interface DependencyAccessFrame {
    /**
     * Append-only entry log. Removals tombstone slots to `undefined` instead of
     * splicing so that per-access bookkeeping stays O(1) amortized; collection
     * skips dead slots in one pass.
     */
    entries: (DependencyAccessEntry | undefined)[];
    mode: "dependencies" | "comparisons";
    /**
     * Live indices of `managed-value` entries keyed by unproxied node, so a
     * later property read on the same owner can retire them without scanning.
     * Allocated on first use so tiny frames (e.g. trapped memos with a couple
     * of reads) skip the Map allocations entirely.
     */
    managedValueIndices: Map<TreeNode, number[]> | null;
    /**
     * Live indices of property-read entries keyed by the read value's unproxied
     * node. Only maintained in `comparisons` mode, where intermediate path
     * reads are deduped when the same node is read from again as an owner.
     */
    propertyValueIndices: Map<TreeNode, number[]> | null;
    /**
     * Property keys written during the frame, keyed by owner. Reads of a
     * written property are excluded from comparisons at collection time.
     * Writes retire earlier reads with a linear scan instead of an index:
     * writes during tracking are rare, while reads are the hot path that
     * must not pay per-read index maintenance for them.
     */
    writtenKeys: Map<TreeNode, Set<string | symbol>> | null;
}

export interface DependencyComparisonAccessor {
    readonly kind: "retree-dependency-comparison-accessor";
    readonly dependencyNode?: TreeNode;
    readonly sourceUnproxiedNode?: TreeNode;
    getValues(): unknown[];
}

type DependencyAccessEntry =
    | {
          kind: "dependency";
          value: unknown;
          comparisonAccessor?: DependencyComparisonAccessor;
          ownerUnproxiedNode?: TreeNode;
          propertyKey?: string | symbol;
          isArrayElementRead?: boolean;
          valueUnproxiedNode?: TreeNode;
      }
    | {
          kind: "managed-value";
          value: TCustomProxy<TreeNode>;
          unproxiedNode: TreeNode;
      };

const dependencyAccessStack: DependencyAccessFrame[] = [];
let pauseDependencyTrackingDepth = 0;

export function runWithoutDependencyTracking<T>(callback: () => T): T {
    pauseDependencyTrackingDepth++;
    try {
        return callback();
    } finally {
        pauseDependencyTrackingDepth--;
    }
}

export function runWithIsolatedDependencyTracking<T>(callback: () => T): T {
    const outerFrames = dependencyAccessStack.splice(
        0,
        dependencyAccessStack.length
    );
    try {
        return callback();
    } finally {
        dependencyAccessStack.splice(0, 0, ...outerFrames);
    }
}

export function isDependencyTrackingActive(): boolean {
    if (pauseDependencyTrackingDepth > 0) {
        return false;
    }
    return dependencyAccessStack.length > 0;
}

function createDependencyAccessFrame(
    mode: "dependencies" | "comparisons"
): DependencyAccessFrame {
    return {
        entries: [],
        mode,
        managedValueIndices: null,
        propertyValueIndices: null,
        writtenKeys: null,
    };
}

export function collectDependencyAccesses<T>(callback: () => T): unknown[] {
    const frame = createDependencyAccessFrame("dependencies");
    dependencyAccessStack.push(frame);
    try {
        callback();
    } finally {
        dependencyAccessStack.pop();
    }
    const dependencies: unknown[] = [];
    for (const entry of frame.entries) {
        if (entry === undefined) {
            continue;
        }
        dependencies.push(entry.value);
    }
    return dependencies;
}

/**
 * One re-checkable read captured while a tracked selector ran. `accessor`
 * re-reads the current value of the same property; `capturedValues` holds the
 * comparison cells observed during the tracked run.
 */
export interface ITrackedAccessValidator {
    accessor: DependencyComparisonAccessor;
    capturedValues: readonly unknown[];
}

/**
 * Everything a tracked selector read from one node, grouped so a later
 * `nodeChanged` from that node can be validated cheaply instead of re-running
 * the whole selector.
 */
export interface ITrackedNodeAccessSummary {
    /**
     * The selector observed this node as a whole value (not just properties),
     * so any change to the node may change the selection.
     */
    wholeNodeRead: boolean;
    /**
     * True when every validated read is attributable to a property key, so
     * emitted field changes that miss `propertyKeys` can be skipped outright.
     */
    keyScopable: boolean;
    propertyKeys: Set<string>;
    validators: ITrackedAccessValidator[];
}

export interface ITrackedSelectionAccesses<T> {
    value: T;
    dependencies: unknown[];
    /**
     * Builds (and memoizes) per-node read summaries keyed by unproxied node.
     * Lazy because summaries are only needed when a dependency emits between
     * selector runs; selector-only runs skip the Map/Set allocations.
     */
    getAccessSummaries: () => Map<TreeNode, ITrackedNodeAccessSummary>;
}

function getOrCreateAccessSummary(
    accessSummaries: Map<TreeNode, ITrackedNodeAccessSummary>,
    node: TreeNode
): ITrackedNodeAccessSummary {
    const existing = accessSummaries.get(node);
    if (existing !== undefined) {
        return existing;
    }
    const created: ITrackedNodeAccessSummary = {
        wholeNodeRead: false,
        keyScopable: true,
        propertyKeys: new Set(),
        validators: [],
    };
    accessSummaries.set(node, created);
    return created;
}

function getEntryDependencyUnproxiedNode(
    entry: DependencyAccessEntry
): TreeNode | undefined {
    if (entry.kind !== "dependency") {
        return undefined;
    }
    if (entry.ownerUnproxiedNode !== undefined) {
        return entry.ownerUnproxiedNode;
    }
    const value = entry.value;
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    if (!("node" in value)) {
        return undefined;
    }
    const dependencyNode = (value as IReactiveDependency).node;
    if (
        dependencyNode === null ||
        dependencyNode === undefined ||
        typeof dependencyNode !== "object"
    ) {
        return undefined;
    }
    const handler = getCustomProxyHandlerFromMetadata(dependencyNode);
    if (handler === undefined) {
        return undefined;
    }
    return handler[unproxiedBaseNodeKey];
}

/**
 * Like {@link collectDependencyAccesses}, but also returns per-node read
 * summaries so tracked `Retree.select` can validate a dependency's
 * `nodeChanged` without re-running the selector.
 */
export function collectTrackedSelectionAccesses<T>(
    callback: () => T
): ITrackedSelectionAccesses<T> {
    let value: T | undefined;
    const frame = createDependencyAccessFrame("dependencies");
    dependencyAccessStack.push(frame);
    try {
        value = callback();
    } finally {
        dependencyAccessStack.pop();
    }
    const dependencies: unknown[] = [];
    const liveEntries: DependencyAccessEntry[] = [];
    for (const entry of frame.entries) {
        if (entry === undefined) {
            continue;
        }
        dependencies.push(entry.value);
        liveEntries.push(entry);
    }
    let memoizedSummaries: Map<TreeNode, ITrackedNodeAccessSummary> | undefined;
    return {
        value: value as T,
        dependencies,
        getAccessSummaries: () => {
            memoizedSummaries ??= buildAccessSummaries(liveEntries);
            return memoizedSummaries;
        },
    };
}

function buildAccessSummaries(
    entries: readonly DependencyAccessEntry[]
): Map<TreeNode, ITrackedNodeAccessSummary> {
    const accessSummaries = new Map<TreeNode, ITrackedNodeAccessSummary>();
    for (const entry of entries) {
        if (entry.kind === "managed-value") {
            getOrCreateAccessSummary(
                accessSummaries,
                entry.unproxiedNode
            ).wholeNodeRead = true;
            continue;
        }
        const dependencyUnproxiedNode = getEntryDependencyUnproxiedNode(entry);
        if (dependencyUnproxiedNode === undefined) {
            // Primitive read with no owner; nothing subscribes to it.
            continue;
        }
        const summary = getOrCreateAccessSummary(
            accessSummaries,
            dependencyUnproxiedNode
        );
        if (entry.comparisonAccessor === undefined) {
            // Cannot re-check this read; treat the node as broadly observed.
            summary.wholeNodeRead = true;
            continue;
        }
        const capturedValues =
            (entry.value as IReactiveDependency).comparisons ?? [];
        summary.validators.push({
            accessor: entry.comparisonAccessor,
            capturedValues,
        });
        if (entry.propertyKey === undefined) {
            summary.keyScopable = false;
        } else {
            summary.propertyKeys.add(String(entry.propertyKey));
        }
    }
    return accessSummaries;
}

export function collectDependencyComparisonAccesses<T>(callback: () => T): {
    value: T;
    comparisons: unknown[];
} {
    let value: T | undefined;
    const frame = createDependencyAccessFrame("comparisons");
    dependencyAccessStack.push(frame);
    try {
        value = callback();
    } finally {
        dependencyAccessStack.pop();
    }
    const comparisons: unknown[] = [];
    for (const entry of frame.entries) {
        if (entry === undefined) {
            continue;
        }
        if (isWrittenPropertyEntry(frame, entry)) {
            continue;
        }
        if (entry.kind === "managed-value") {
            comparisons.push(
                createComparisonAccessor(
                    () => [entry.value],
                    entry.value,
                    entry.unproxiedNode
                )
            );
            continue;
        }
        if (entry.comparisonAccessor !== undefined) {
            comparisons.push(entry.comparisonAccessor);
            continue;
        }
        comparisons.push(entry.value);
    }
    return {
        value: value as T,
        comparisons,
    };
}

export function trackDependencyAccess<T>(value: T): T {
    if (pauseDependencyTrackingDepth > 0) {
        return value;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return value;
    }
    if (typeof value === "function") {
        return value;
    }
    if (isCustomProxy(value)) {
        const handler = getCustomProxyHandlerFromMetadata(value);
        if (handler === undefined) {
            throw new Error(
                "Retree internal invariant failed: cannot track a managed dependency value without Retree proxy metadata."
            );
        }
        const unproxiedNode = handler[unproxiedBaseNodeKey];
        const entryIndex = currentFrame.entries.length;
        currentFrame.entries.push({
            kind: "managed-value",
            value,
            unproxiedNode,
        });
        currentFrame.managedValueIndices = appendIndexEntry(
            currentFrame.managedValueIndices,
            unproxiedNode,
            entryIndex
        );
        return value;
    }
    currentFrame.entries.push({ kind: "dependency", value });
    return value;
}

function appendIndexEntry(
    indexMap: Map<TreeNode, number[]> | null,
    node: TreeNode,
    entryIndex: number
): Map<TreeNode, number[]> {
    if (indexMap === null) {
        return new Map([[node, [entryIndex]]]);
    }
    const indices = indexMap.get(node);
    if (indices === undefined) {
        indexMap.set(node, [entryIndex]);
        return indexMap;
    }
    indices.push(entryIndex);
    return indexMap;
}

function tombstoneIndexedEntries(
    frame: DependencyAccessFrame,
    indexMap: Map<TreeNode, number[]> | null,
    node: TreeNode
): void {
    if (indexMap === null) {
        return;
    }
    const indices = indexMap.get(node);
    if (indices === undefined) {
        return;
    }
    for (const entryIndex of indices) {
        frame.entries[entryIndex] = undefined;
    }
    indexMap.delete(node);
}

export function trackDependencyOwnerAccess(value: unknown): void {
    if (pauseDependencyTrackingDepth > 0) {
        return;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return;
    }
    if (value === null || typeof value !== "object") {
        return;
    }
    currentFrame.entries.push({ kind: "dependency", value });
}

export function trackDependencyPropertyAccess<T>(
    owner: unknown,
    propertyKey: string | symbol,
    value: T
): T {
    if (pauseDependencyTrackingDepth > 0) {
        return value;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return value;
    }
    if (isRetreeInternalProperty(propertyKey)) {
        return value;
    }
    if (typeof value === "function") {
        return value;
    }
    if (!isCustomProxy(owner)) {
        return trackDependencyAccess(value);
    }
    const ownerHandler = getCustomProxyHandlerFromMetadata(owner);
    if (ownerHandler === undefined) {
        throw new Error(
            "Retree internal invariant failed: cannot track a dependency property read without owner proxy metadata."
        );
    }
    const ownerUnproxiedNode = ownerHandler[unproxiedBaseNodeKey];
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    if (currentFrame.mode === "comparisons") {
        removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
    }
    const valueUnproxiedNode = getValueUnproxiedNode(value);
    const arrayElementRead = isArrayElementRead(
        ownerUnproxiedNode,
        propertyKey
    );
    const comparisonValue = arrayElementRead
        ? getArrayElementComparisonValue(value)
        : value;
    const entryIndex = currentFrame.entries.length;
    currentFrame.entries.push({
        kind: "dependency",
        value: {
            node: owner,
            comparisons: [comparisonValue],
        } satisfies IReactiveDependency,
        comparisonAccessor: createComparisonAccessor(
            () => [
                arrayElementRead
                    ? getArrayElementComparisonValue(
                          Reflect.get(owner, propertyKey)
                      )
                    : Reflect.get(owner, propertyKey),
            ],
            owner,
            getComparisonAccessorSource(ownerUnproxiedNode, propertyKey)
        ),
        ownerUnproxiedNode,
        propertyKey,
        isArrayElementRead: arrayElementRead,
        valueUnproxiedNode,
    });
    if (
        currentFrame.mode === "comparisons" &&
        valueUnproxiedNode !== undefined &&
        !arrayElementRead
    ) {
        currentFrame.propertyValueIndices = appendIndexEntry(
            currentFrame.propertyValueIndices,
            valueUnproxiedNode,
            entryIndex
        );
    }
    if (arrayElementRead) {
        return value;
    }
    if (currentFrame.mode === "comparisons") {
        return value;
    }
    return trackDependencyAccess(value);
}

export function replayDependencyComparisonAccesses(
    comparisons: unknown[],
    comparisonValues?: readonly (readonly unknown[])[]
): void {
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined || currentFrame.mode !== "dependencies") {
        return;
    }
    for (let index = 0; index < comparisons.length; index++) {
        const comparison = comparisons[index];
        if (!isDependencyComparisonAccessor(comparison)) {
            continue;
        }
        const dependencyNode = comparison.dependencyNode;
        if (dependencyNode === undefined) {
            continue;
        }
        // Cached trapped memos can already know the current comparison cells
        // from their validation pass. Reusing those cells keeps nested @select
        // collection from re-running expensive property accessors a second time.
        // The accessor is kept so tracked selections can re-check this read
        // later without re-running the selector; it has no property key, so
        // the node stays unscopeable by changed keys.
        currentFrame.entries.push({
            kind: "dependency",
            value: {
                node: dependencyNode,
                comparisons: [
                    ...(comparisonValues?.[index] ?? comparison.getValues()),
                ],
            } satisfies IReactiveDependency,
            comparisonAccessor: comparison,
        });
    }
}

export function trackDependencyPropertyWrite(
    owner: unknown,
    propertyKey: string | symbol
): void {
    if (pauseDependencyTrackingDepth > 0) {
        return;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return;
    }
    if (isRetreeInternalProperty(propertyKey)) {
        return;
    }
    if (!isCustomProxy(owner)) {
        return;
    }
    const handler = getCustomProxyHandlerFromMetadata(owner);
    if (handler === undefined) {
        throw new Error(
            "Retree internal invariant failed: cannot track a dependency property write without owner proxy metadata."
        );
    }
    const ownerUnproxiedNode = handler[unproxiedBaseNodeKey];
    currentFrame.writtenKeys ??= new Map();
    const writtenOwnerKeys = currentFrame.writtenKeys.get(ownerUnproxiedNode);
    if (writtenOwnerKeys === undefined) {
        currentFrame.writtenKeys.set(
            ownerUnproxiedNode,
            new Set([propertyKey])
        );
    } else {
        writtenOwnerKeys.add(propertyKey);
    }
    removePendingPropertyAccess(currentFrame, ownerUnproxiedNode, propertyKey);
}

function isRetreeInternalProperty(propertyKey: string | symbol): boolean {
    if (typeof propertyKey !== "string") {
        return false;
    }
    return propertyKey.startsWith("RETREE_");
}

function createComparisonAccessor(
    getValues: () => unknown[],
    dependencyNode?: TreeNode,
    sourceUnproxiedNode?: TreeNode
): DependencyComparisonAccessor {
    return {
        kind: "retree-dependency-comparison-accessor",
        dependencyNode,
        sourceUnproxiedNode,
        getValues,
    };
}

function isDependencyComparisonAccessor(
    value: unknown
): value is DependencyComparisonAccessor {
    if (value === null || typeof value !== "object") {
        return false;
    }
    if (!("kind" in value)) {
        return false;
    }
    return value.kind === "retree-dependency-comparison-accessor";
}

function getComparisonAccessorSource(
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
): TreeNode | undefined {
    if (ownerUnproxiedNode instanceof ReactiveNode) {
        return undefined;
    }
    return ownerUnproxiedNode;
}

function removePendingPropertyAccess(
    frame: DependencyAccessFrame,
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
) {
    // Linear scan is acceptable here: this only runs on writes during
    // tracking, which are rare compared to reads.
    for (let index = frame.entries.length - 1; index >= 0; index--) {
        const entry = frame.entries[index];
        if (entry === undefined) {
            continue;
        }
        if (entry.kind !== "dependency") {
            continue;
        }
        if (entry.ownerUnproxiedNode !== ownerUnproxiedNode) {
            continue;
        }
        if (entry.propertyKey !== propertyKey) {
            continue;
        }
        frame.entries[index] = undefined;
    }
}

function isWrittenPropertyEntry(
    frame: DependencyAccessFrame,
    entry: DependencyAccessEntry
): boolean {
    if (entry.kind !== "dependency") {
        return false;
    }
    if (entry.ownerUnproxiedNode === undefined) {
        return false;
    }
    if (entry.propertyKey === undefined) {
        return false;
    }
    if (frame.writtenKeys === null) {
        return false;
    }
    const writtenOwnerKeys = frame.writtenKeys.get(entry.ownerUnproxiedNode);
    if (writtenOwnerKeys === undefined) {
        return false;
    }
    return writtenOwnerKeys.has(entry.propertyKey);
}

function removePendingPropertyValueAccess(
    frame: DependencyAccessFrame,
    valueUnproxiedNode: TreeNode
) {
    tombstoneIndexedEntries(
        frame,
        frame.propertyValueIndices,
        valueUnproxiedNode
    );
}

function getArrayElementComparisonValue(value: unknown): unknown {
    if (!isCustomProxy(value)) {
        return value;
    }
    const handler = getCustomProxyHandlerFromMetadata(value);
    if (handler === undefined) {
        throw new Error(
            "Retree internal invariant failed: cannot compare an array element proxy without Retree metadata."
        );
    }
    return handler[unproxiedBaseNodeKey];
}

function getValueUnproxiedNode(value: unknown): TreeNode | undefined {
    if (!isCustomProxy(value)) {
        return undefined;
    }
    const handler = getCustomProxyHandlerFromMetadata(value);
    if (handler === undefined) {
        throw new Error(
            "Retree internal invariant failed: cannot track a dependency value proxy without Retree metadata."
        );
    }
    return handler[unproxiedBaseNodeKey];
}

function isArrayElementRead(
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
) {
    if (!Array.isArray(ownerUnproxiedNode)) {
        return false;
    }
    if (typeof propertyKey !== "string") {
        return false;
    }
    const index = Number(propertyKey);
    if (!Number.isInteger(index)) {
        return false;
    }
    return index >= 0;
}

function removePendingManagedValueAccess(
    frame: DependencyAccessFrame,
    unproxiedNode: TreeNode
) {
    tombstoneIndexedEntries(frame, frame.managedValueIndices, unproxiedNode);
}
