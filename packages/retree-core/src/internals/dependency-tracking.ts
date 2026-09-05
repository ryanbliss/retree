import { IReactiveDependency, ReactiveNode } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import { isDevMode } from "./dev.js";
import {
    getCustomProxyHandlerFromMetadata,
    ICustomProxyHandler,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";

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
    /**
     * Validators for reads that a later write to the same owner+key retired
     * from this frame. `Retree.effect` re-checks them after a run: a retired
     * read whose value changed means the run wrote a property it had already
     * read, so the effect must re-run — during the creation run no
     * subscription exists yet to deliver that write's `nodeChanged`.
     */
    writeInvalidatedReads: ITrackedAccessValidator[] | null;
}

export interface DependencyComparisonAccessor {
    readonly kind: "retree-dependency-comparison-accessor";
    readonly dependencyNode?: TreeNode;
    readonly sourceUnproxiedNode?: TreeNode;
    /** Managed property values also compare their current view; array slots compare raw identities. */
    readonly valueUnproxiedNode?: TreeNode;
    getValues(): unknown[];
}

/**
 * One re-checkable read captured while a tracked selector ran. `getValues`
 * re-reads the current comparison cells; `capturedValues` holds the cells
 * observed during the tracked run.
 */
export interface ITrackedAccessValidator {
    getValues(): unknown[];
    readonly capturedValues: readonly unknown[];
}

enum TrackedReadKind {
    Property,
    ArrayElement,
    Presence,
    Keys,
}

/**
 * One tracked read of a Retree node's property, key presence, or key set. The
 * record is its own comparison accessor and validator, so a tracked read
 * allocates this object and its captured cells and nothing else; the
 * `{ node, comparisons }` dependency value is only built when asked for.
 */
class TrackedNodeRead
    implements DependencyComparisonAccessor, ITrackedAccessValidator
{
    public readonly kind = "retree-dependency-comparison-accessor";
    constructor(
        public readonly readKind: TrackedReadKind,
        public readonly ownerHandler: ICustomProxyHandler<TreeNode>,
        /** The proxy the read went through; dependency values point at it. */
        public readonly dependencyNode: TCustomProxy<TreeNode>,
        /** Undefined for keys reads, which cannot be scoped to one key. */
        public readonly propertyKey: string | symbol | undefined,
        public readonly capturedValues: unknown[],
        /** Managed property values also compare their current view. */
        public readonly valueUnproxiedNode: TreeNode | undefined
    ) {}

    public get ownerUnproxiedNode(): TreeNode {
        return this.ownerHandler[unproxiedBaseNodeKey];
    }

    /**
     * Owner a write must target to invalidate this read, or undefined for
     * ReactiveNode getter reads whose value derives from other fields.
     * Resolved lazily: only memo validation needs it, and the descriptor
     * lookup it takes on ReactiveNodes is too costly for every tracked read.
     */
    public get sourceUnproxiedNode(): TreeNode | undefined {
        const owner = this.ownerUnproxiedNode;
        if (!(owner instanceof ReactiveNode)) return owner;
        const descriptor = Reflect.getOwnPropertyDescriptor(
            owner,
            this.propertyKey ?? "ownKeys"
        );
        if (descriptor === undefined) return undefined;
        return "value" in descriptor ? owner : undefined;
    }

    public getValues(): unknown[] {
        const propertyKey = this.propertyKey;
        if (propertyKey === undefined) {
            // Keys read from the raw node: validation runs outside tracking
            // frames, and the raw read avoids re-entering the ownKeys trap.
            return Reflect.ownKeys(this.ownerUnproxiedNode);
        }
        switch (this.readKind) {
            case TrackedReadKind.Presence:
                return [Reflect.has(this.dependencyNode, propertyKey)];
            case TrackedReadKind.ArrayElement:
                return [
                    getArrayElementComparisonValue(
                        Reflect.get(this.dependencyNode, propertyKey)
                    ),
                ];
            default:
                return [Reflect.get(this.dependencyNode, propertyKey)];
        }
    }
}

/**
 * A cached trapped memo's comparison replayed into an enclosing frame. Kept
 * re-checkable so tracked selections can validate the read later; it has no
 * property key, so its node stays unscopeable by changed keys.
 */
class ReplayedRead implements ITrackedAccessValidator {
    constructor(
        public readonly node: TreeNode,
        public readonly accessor: DependencyComparisonAccessor,
        public readonly capturedValues: unknown[]
    ) {}

    public getValues(): unknown[] {
        return this.accessor.getValues();
    }
}

type DependencyAccessEntry =
    | TrackedNodeRead
    | ReplayedRead
    | { kind: "value"; value: unknown }
    | {
          kind: "managed-value";
          value: TCustomProxy<TreeNode>;
          unproxiedNode: TreeNode;
          baseProxy: TCustomProxy<TreeNode>;
      };

function toDependencyValue(entry: DependencyAccessEntry): unknown {
    if (entry instanceof TrackedNodeRead) {
        return {
            node: entry.dependencyNode,
            comparisons: entry.capturedValues,
        } satisfies IReactiveDependency;
    }
    if (entry instanceof ReplayedRead) {
        return {
            node: entry.node,
            comparisons: entry.capturedValues,
        } satisfies IReactiveDependency;
    }
    return entry.value;
}

function collectDependencyValues(
    entries: readonly (DependencyAccessEntry | undefined)[]
): unknown[] {
    const dependencies: unknown[] = [];
    for (const entry of entries) {
        if (entry === undefined) continue;
        dependencies.push(toDependencyValue(entry));
    }
    return dependencies;
}

const dependencyAccessStack: DependencyAccessFrame[] = [];
let pauseDependencyTrackingDepth = 0;
let trackedWriteWarningSuppressionDepth = 0;

/**
 * Run a tracked callback with the dev-only "write during tracked selector"
 * warning suppressed.
 *
 * @remarks
 * `Retree.effect` bodies are tracked for dependency collection but are
 * explicitly allowed to write, so the selector-purity warning would be
 * misleading there. Write bookkeeping still applies: reads of a written
 * property are excluded from dependency comparisons exactly as in selectors.
 */
export function runWithTrackedWriteWarningSuppressed<T>(callback: () => T): T {
    trackedWriteWarningSuppressionDepth++;
    try {
        return callback();
    } finally {
        trackedWriteWarningSuppressionDepth--;
    }
}

export function runWithoutDependencyTracking<T>(callback: () => T): T {
    pauseDependencyTrackingDepth++;
    try {
        return callback();
    } finally {
        pauseDependencyTrackingDepth--;
    }
}

export function runWithIsolatedDependencyTracking<T>(callback: () => T): T {
    if (dependencyAccessStack.length === 0) {
        // Nothing to isolate from: the common write-outside-tracking case.
        return callback();
    }
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
        writeInvalidatedReads: null,
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
    return collectDependencyValues(frame.entries);
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

/**
 * One Retree node a tracked run read, resolved to the identities subscription
 * code needs: the raw node for keying and the base proxy for `Retree.on`.
 */
export interface ITrackedDependencySource {
    rawNode: TreeNode;
    baseProxy: TCustomProxy<TreeNode>;
}

export interface ITrackedSelectionAccesses<T> {
    value: T;
    /**
     * The run's reads as `IReactiveDependency` values, in read order. Built
     * on demand: only `@select` collection consumes them.
     */
    getDependencies: () => unknown[];
    /**
     * Every node the run read, deduped in first-read order. Computed from the
     * entries' cached handlers so subscribers never re-normalize
     * `dependencies` through proxy traps.
     */
    sources: readonly ITrackedDependencySource[];
    /**
     * Per-read comparison cells (the raw node read, or the primitive value
     * for untracked reads) with consecutive duplicates collapsed. Two runs
     * with equal cells read the same nodes in the same order.
     */
    comparisonValues: readonly unknown[];
    /**
     * Builds (and memoizes) per-node read summaries keyed by unproxied node.
     * Lazy because summaries are only needed when a dependency emits between
     * selector runs; selector-only runs skip the Map/Set allocations.
     */
    getAccessSummaries: () => Map<TreeNode, ITrackedNodeAccessSummary>;
    /**
     * Validators for reads the run made and then invalidated by writing the
     * same owner+property later in the same run (see
     * {@link DependencyAccessFrame.writtenKeys}). Empty for pure runs.
     * `Retree.effect` re-checks these after a run so its creation run
     * cascades on self-writes exactly like steady-state runs do.
     */
    writeInvalidatedReads: readonly ITrackedAccessValidator[];
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

/**
 * Handler of the node a tracked value entry depends on, if the value is an
 * explicit `{ node }` dependency on a Retree-managed node.
 */
function getValueEntryNodeHandler(
    value: unknown
): ICustomProxyHandler<TreeNode> | undefined {
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
    return getCustomProxyHandlerFromMetadata(dependencyNode);
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
    const entries = frame.entries;
    const sources: ITrackedDependencySource[] = [];
    const sourceRawNodes = new Set<TreeNode>();
    const comparisonValues: unknown[] = [];
    for (const entry of entries) {
        if (entry === undefined) {
            continue;
        }
        let rawNode: TreeNode | undefined;
        let baseProxy: TCustomProxy<TreeNode> | undefined;
        let comparisonValue: unknown;
        if (entry instanceof TrackedNodeRead) {
            const handler = entry.ownerHandler;
            rawNode = handler[unproxiedBaseNodeKey];
            baseProxy = handler.baseProxy;
            comparisonValue = rawNode;
        } else if (entry instanceof ReplayedRead) {
            const handler = getCustomProxyHandlerFromMetadata(entry.node);
            if (handler !== undefined) {
                rawNode = handler[unproxiedBaseNodeKey];
                baseProxy = handler.baseProxy;
            }
            comparisonValue =
                rawNode !== undefined ? rawNode : toDependencyValue(entry);
        } else if (entry.kind === "managed-value") {
            rawNode = entry.unproxiedNode;
            baseProxy = entry.baseProxy;
            comparisonValue = rawNode;
        } else {
            const handler = getValueEntryNodeHandler(entry.value);
            if (handler !== undefined) {
                rawNode = handler[unproxiedBaseNodeKey];
                baseProxy = handler.baseProxy;
            }
            comparisonValue = rawNode !== undefined ? rawNode : entry.value;
        }
        if (
            comparisonValues.length === 0 ||
            !Object.is(
                comparisonValues[comparisonValues.length - 1],
                comparisonValue
            )
        ) {
            comparisonValues.push(comparisonValue);
        }
        if (
            rawNode !== undefined &&
            baseProxy !== undefined &&
            !sourceRawNodes.has(rawNode)
        ) {
            sourceRawNodes.add(rawNode);
            sources.push({ rawNode, baseProxy });
        }
    }
    let memoizedSummaries: Map<TreeNode, ITrackedNodeAccessSummary> | undefined;
    return {
        value: value as T,
        getDependencies: () => collectDependencyValues(entries),
        sources,
        comparisonValues,
        getAccessSummaries: () => {
            memoizedSummaries ??= buildAccessSummaries(entries);
            return memoizedSummaries;
        },
        writeInvalidatedReads: frame.writeInvalidatedReads ?? [],
    };
}

function buildAccessSummaries(
    entries: readonly (DependencyAccessEntry | undefined)[]
): Map<TreeNode, ITrackedNodeAccessSummary> {
    const accessSummaries = new Map<TreeNode, ITrackedNodeAccessSummary>();
    for (const entry of entries) {
        if (entry === undefined) {
            continue;
        }
        if (entry instanceof TrackedNodeRead) {
            const summary = getOrCreateAccessSummary(
                accessSummaries,
                entry.ownerHandler[unproxiedBaseNodeKey]
            );
            summary.validators.push(entry);
            if (entry.propertyKey === undefined) {
                summary.keyScopable = false;
            } else {
                summary.propertyKeys.add(String(entry.propertyKey));
            }
            continue;
        }
        if (entry instanceof ReplayedRead) {
            const handler = getCustomProxyHandlerFromMetadata(entry.node);
            if (handler === undefined) continue;
            const summary = getOrCreateAccessSummary(
                accessSummaries,
                handler[unproxiedBaseNodeKey]
            );
            summary.validators.push(entry);
            summary.keyScopable = false;
            continue;
        }
        if (entry.kind === "managed-value") {
            getOrCreateAccessSummary(
                accessSummaries,
                entry.unproxiedNode
            ).wholeNodeRead = true;
            continue;
        }
        const handler = getValueEntryNodeHandler(entry.value);
        if (handler === undefined) {
            // Primitive read with no owner; nothing subscribes to it.
            continue;
        }
        // Cannot re-check this read; treat the node as broadly observed.
        getOrCreateAccessSummary(
            accessSummaries,
            handler[unproxiedBaseNodeKey]
        ).wholeNodeRead = true;
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
        if (entry instanceof TrackedNodeRead) {
            if (!isWrittenPropertyRead(frame, entry)) comparisons.push(entry);
            continue;
        }
        if (entry instanceof ReplayedRead) {
            comparisons.push(entry.accessor);
            continue;
        }
        if (entry.kind === "managed-value") {
            comparisons.push(
                createManagedValueAccessor(entry.value, entry.unproxiedNode)
            );
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
    // One handler read doubles as the isCustomProxy check; identity lookups
    // dispatch through the proxy get trap, so avoid paying it twice.
    const handler = getCustomProxyHandlerFromMetadata(value);
    pushTrackedValueEntry(currentFrame, value, handler);
    return value;
}

function pushTrackedValueEntry(
    frame: DependencyAccessFrame,
    value: unknown,
    handler: ICustomProxyHandler<TreeNode> | undefined
): void {
    if (handler !== undefined) {
        const unproxiedNode = handler[unproxiedBaseNodeKey];
        const entryIndex = frame.entries.length;
        frame.entries.push({
            kind: "managed-value",
            value: value as TCustomProxy<TreeNode>,
            unproxiedNode,
            baseProxy: handler.baseProxy,
        });
        frame.managedValueIndices = appendIndexEntry(
            frame.managedValueIndices,
            unproxiedNode,
            entryIndex
        );
        return;
    }
    frame.entries.push({ kind: "value", value });
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
    currentFrame.entries.push({ kind: "value", value });
}

/**
 * Record a property read on a tracked frame. Traps pass their own handler so
 * the owner's identity never costs a second trip through the proxy.
 */
export function trackDependencyPropertyAccess<T>(
    ownerHandler: ICustomProxyHandler<TreeNode>,
    owner: TCustomProxy<TreeNode>,
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
    const ownerUnproxiedNode = ownerHandler[unproxiedBaseNodeKey];
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    if (currentFrame.mode === "comparisons") {
        removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
    }
    // Fetch the value's handler once; it answers the unproxied-node lookup,
    // the array-element comparison cell, and the tail value entry below.
    const valueHandler =
        value !== null && typeof value === "object"
            ? getCustomProxyHandlerFromMetadata(value)
            : undefined;
    const valueUnproxiedNode = valueHandler?.[unproxiedBaseNodeKey];
    const arrayElementRead = isArrayElementRead(
        ownerUnproxiedNode,
        propertyKey
    );
    const entryIndex = currentFrame.entries.length;
    // Array slots compare raw identities and never dedupe by value node.
    currentFrame.entries.push(
        arrayElementRead
            ? new TrackedNodeRead(
                  TrackedReadKind.ArrayElement,
                  ownerHandler,
                  owner,
                  propertyKey,
                  [valueUnproxiedNode ?? value],
                  undefined
              )
            : new TrackedNodeRead(
                  TrackedReadKind.Property,
                  ownerHandler,
                  owner,
                  propertyKey,
                  [value],
                  valueUnproxiedNode
              )
    );
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
    pushTrackedValueEntry(currentFrame, value, valueHandler);
    return value;
}

/**
 * Record a key-presence read (`"key" in node`) on a tracked frame.
 *
 * @remarks
 * The entry subscribes to the owner and re-checks `Reflect.has` during
 * validation, and it carries the checked key as its property key so plain
 * objects stay key-scopable: adding or deleting the checked key emits a
 * change record for exactly that key, while unrelated writes are skipped.
 */
export function trackDependencyKeyPresenceAccess(
    ownerHandler: ICustomProxyHandler<TreeNode>,
    owner: TCustomProxy<TreeNode>,
    propertyKey: string | symbol,
    isPresent: boolean
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
    const ownerUnproxiedNode = ownerHandler[unproxiedBaseNodeKey];
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    if (currentFrame.mode === "comparisons") {
        removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
    }
    currentFrame.entries.push(
        new TrackedNodeRead(
            TrackedReadKind.Presence,
            ownerHandler,
            owner,
            propertyKey,
            [isPresent],
            undefined
        )
    );
}

/**
 * Record an iteration-shape read (`Object.keys`, `for...in`, spread,
 * `Reflect.ownKeys`) on a tracked frame.
 *
 * @remarks
 * The entry subscribes to the owner and re-reads the raw node's own keys
 * during validation, so key additions/deletions/renames invalidate while
 * value writes to existing keys validate away. It intentionally has no
 * property key: a keys read cannot be scoped to individual changed keys, so
 * it disables key scoping for the owner and relies on the validator.
 */
export function trackDependencyKeysAccess(
    ownerHandler: ICustomProxyHandler<TreeNode>,
    owner: TCustomProxy<TreeNode>
): void {
    if (pauseDependencyTrackingDepth > 0) {
        return;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return;
    }
    const ownerUnproxiedNode = ownerHandler[unproxiedBaseNodeKey];
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    if (currentFrame.mode === "comparisons") {
        removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
    }
    currentFrame.entries.push(
        new TrackedNodeRead(
            TrackedReadKind.Keys,
            ownerHandler,
            owner,
            undefined,
            Reflect.ownKeys(ownerUnproxiedNode),
            undefined
        )
    );
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
        currentFrame.entries.push(
            new ReplayedRead(dependencyNode, comparison, [
                ...(comparisonValues?.[index] ?? comparison.getValues()),
            ])
        );
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
    // One handler read doubles as the isCustomProxy check.
    const handler = getCustomProxyHandlerFromMetadata(owner);
    if (handler === undefined) {
        return;
    }
    const ownerUnproxiedNode = handler[unproxiedBaseNodeKey];
    if (isDevMode() && trackedWriteWarningSuppressionDepth === 0) {
        warnTrackedWriteOnce(ownerUnproxiedNode, propertyKey);
    }
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

/**
 * Dev-only: nodes (by raw identity) mapped to the property keys a tracked-run
 * write warning has already been printed for, so a hot selector does not spam
 * the console.
 */
const warnedTrackedWriteKeys = new WeakMap<TreeNode, Set<string | symbol>>();

/**
 * Dev-only warning for writes made while a tracked selector/memo runs.
 * Reads of a written property are excluded from dependency comparisons
 * (see {@link DependencyAccessFrame.writtenKeys}), which surprises users who
 * expect the selector to re-run when that property later changes.
 */
function warnTrackedWriteOnce(
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
): void {
    let warnedKeys = warnedTrackedWriteKeys.get(ownerUnproxiedNode);
    if (warnedKeys === undefined) {
        warnedKeys = new Set();
        warnedTrackedWriteKeys.set(ownerUnproxiedNode, warnedKeys);
    }
    if (warnedKeys.has(propertyKey)) {
        return;
    }
    warnedKeys.add(propertyKey);
    console.warn(
        `Retree: property '${String(
            propertyKey
        )}' was written while a tracked selector or memo was running (useSelect/Retree.select selector, @memo, @fnMemo, @select, or keyless memo). Reads of a written property are excluded from dependency comparisons, so later changes to it may not re-run this selector. Selectors should be pure reads. Fix: move the write outside the selector, or wrap intentional bookkeeping writes in Retree.untracked(...).`
    );
}

function isRetreeInternalProperty(propertyKey: string | symbol): boolean {
    if (typeof propertyKey !== "string") {
        return false;
    }
    return propertyKey.startsWith("RETREE_");
}

function createManagedValueAccessor(
    value: TCustomProxy<TreeNode>,
    unproxiedNode: TreeNode
): DependencyComparisonAccessor {
    return {
        kind: "retree-dependency-comparison-accessor",
        dependencyNode: value,
        sourceUnproxiedNode: unproxiedNode,
        getValues: () => [value],
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

function removePendingPropertyAccess(
    frame: DependencyAccessFrame,
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
) {
    // Linear scan is acceptable here: this only runs on writes during
    // tracking, which are rare compared to reads.
    for (let index = frame.entries.length - 1; index >= 0; index--) {
        const entry = frame.entries[index];
        if (!(entry instanceof TrackedNodeRead)) {
            continue;
        }
        if (entry.propertyKey !== propertyKey) {
            continue;
        }
        if (entry.ownerUnproxiedNode !== ownerUnproxiedNode) {
            continue;
        }
        // Keep the retired read re-checkable: after the run, effects
        // compare its captured (pre-write) values against a fresh read to
        // detect that the run wrote a property it had already read.
        frame.writeInvalidatedReads ??= [];
        frame.writeInvalidatedReads.push(entry);
        frame.entries[index] = undefined;
    }
}

function isWrittenPropertyRead(
    frame: DependencyAccessFrame,
    entry: TrackedNodeRead
): boolean {
    if (frame.writtenKeys === null) {
        return false;
    }
    if (entry.propertyKey === undefined) {
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
    if (value === null || typeof value !== "object") {
        return value;
    }
    const handler = getCustomProxyHandlerFromMetadata(value);
    if (handler === undefined) {
        return value;
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
