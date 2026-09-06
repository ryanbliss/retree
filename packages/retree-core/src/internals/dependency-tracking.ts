import { IReactiveDependency, ReactiveNode } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import { isDevMode } from "./dev.js";
import {
    getCustomProxyHandlerFromMetadata,
    ICustomProxyHandler,
    TCustomProxy,
    proxiedParentKey,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";

enum FrameMode {
    /** Tracked selectors, effects and `@select`: one record per node read. */
    Dependencies,
    /** Memo key functions: an ordered accessor log with path dedupe. */
    Comparisons,
}

interface DependencyAccessFrame {
    mode: FrameMode;
    /**
     * Comparisons mode: append-only entry log. Removals tombstone slots to
     * `undefined` instead of splicing so that per-access bookkeeping stays
     * O(1) amortized; collection skips dead slots in one pass.
     */
    entries: (DependencyAccessEntry | undefined)[];
    /**
     * Comparisons mode: live indices of `managed-value` entries keyed by
     * unproxied node, so a later property read on the same owner can retire
     * them without scanning. Allocated on first use so tiny frames (e.g.
     * trapped memos with a couple of reads) skip the Map allocations.
     */
    managedValueIndices: Map<TreeNode, number[]> | null;
    /**
     * Comparisons mode: live indices of property-read entries keyed by the
     * read value's unproxied node, so intermediate path reads are deduped
     * when the same node is read from again as an owner.
     */
    propertyValueIndices: Map<TreeNode, number[]> | null;
    /**
     * Dependencies mode: one record per node read, in first-read order.
     * Allocated on the first read so empty runs allocate nothing.
     */
    reads: Map<TreeNode, NodeReadRecord> | null;
    /** Dependencies mode: the record the previous read landed on. */
    lastRecord: NodeReadRecord | null;
    /**
     * Dependencies mode: records whose parent had no record when they were
     * created. Collection re-checks them once the run is complete, so a
     * child read before its parent still ends up covered.
     */
    uncovered: NodeReadRecord[];
    /**
     * Comparisons mode: property keys written during the frame, keyed by
     * owner. Reads of a written property are excluded from comparisons at
     * collection time.
     */
    writtenKeys: Map<TreeNode, Set<string | symbol>> | null;
    /**
     * Reads that a later write to the same owner+key retired from this frame.
     * `Retree.effect` re-checks them after a run: a retired read whose value
     * changed means the run wrote a property it had already read, so the
     * effect must re-run — during the creation run no subscription exists
     * yet to deliver that write's `nodeChanged`.
     */
    writeInvalidatedReads: RetiredRead[] | null;
}

export interface DependencyComparisonAccessor {
    readonly kind: "retree-dependency-comparison-accessor";
    readonly dependencyNode?: TreeNode;
    readonly sourceUnproxiedNode?: TreeNode;
    /** Managed property values also compare their current view; array slots compare raw identities. */
    readonly valueUnproxiedNode?: TreeNode;
    getValues(): unknown[];
}

enum TrackedReadKind {
    Property,
    ArrayElement,
    Presence,
    Keys,
}

/**
 * One memo-comparison read of a Retree node's property, key presence, or key
 * set. The record is its own comparison accessor, so a comparisons-mode read
 * allocates this object and its captured cells and nothing else.
 */
class TrackedNodeRead implements DependencyComparisonAccessor {
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
                    toComparisonCell(
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
class ReplayedRead {
    constructor(
        public readonly node: TreeNode,
        public readonly accessor: DependencyComparisonAccessor,
        public readonly capturedValues: unknown[]
    ) {}

    public isUnchanged(): boolean {
        const current = this.accessor.getValues();
        const captured = this.capturedValues;
        if (current.length !== captured.length) return false;
        for (let index = 0; index < current.length; index++) {
            if (
                !Object.is(
                    toComparisonCell(current[index]),
                    toComparisonCell(captured[index])
                )
            ) {
                return false;
            }
        }
        return true;
    }
}

/**
 * Comparison cell for a read value: the raw node behind a managed value, the
 * value itself otherwise. Cells compare with `Object.is`, so a node keeps
 * its identity across reproxies while primitives compare by value.
 */
function toComparisonCell(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const handler = getCustomProxyHandlerFromMetadata(value);
    if (handler === undefined) return value;
    return handler[unproxiedBaseNodeKey];
}

/**
 * Read one property's current comparison cell. Plain objects, arrays and
 * collections read the raw node: a proxy round trip cannot change the
 * identity they return. ReactiveNodes read through the base proxy so getters
 * (`@memo`, `@select`, computed values) resolve the way the run saw them.
 */
function readCurrentCell(
    rawNode: TreeNode,
    baseProxy: TCustomProxy<TreeNode>,
    propertyKey: string | symbol
): unknown {
    const source = rawNode instanceof ReactiveNode ? baseProxy : rawNode;
    return toComparisonCell(Reflect.get(source, propertyKey));
}

/**
 * Everything a tracked run read from one node. The record doubles as the
 * node's validation summary: a later `nodeChanged` from the node re-reads
 * the captured keys and compares cells instead of re-running the selector.
 */
export class NodeReadRecord {
    /** Property and element reads, parallel to `cells`. */
    public readonly keys: (string | symbol)[] = [];
    public readonly cells: unknown[] = [];
    /** Own-keys snapshot when the run enumerated the node's keys. */
    public ownKeys: readonly (string | symbol)[] | null = null;
    public presenceKeys: (string | symbol)[] | null = null;
    public presenceCells: boolean[] | null = null;
    /**
     * The run observed this node as a whole value (returned it or passed it
     * on without reading a property), so any change to it may matter.
     */
    public wholeNodeRead = false;
    public replayed: ReplayedRead[] | null = null;
    /** The run also read this node's parent, which subscribes for it. */
    public covered = false;
    /** At least one child record is covered by this one. */
    public coversChildren = false;
    private keySet: Set<string> | null = null;

    constructor(public readonly ownerHandler: ICustomProxyHandler<TreeNode>) {}

    public get rawNode(): TreeNode {
        return this.ownerHandler[unproxiedBaseNodeKey];
    }

    public get baseProxy(): TCustomProxy<TreeNode> {
        return this.ownerHandler.baseProxy;
    }

    /**
     * True when every read is attributable to a property key, so emitted
     * field changes that miss those keys can be skipped outright.
     */
    public get keyScopable(): boolean {
        return this.ownKeys === null && this.replayed === null;
    }

    public hasPropertyKey(key: string): boolean {
        let keySet = this.keySet;
        if (keySet === null) {
            keySet = new Set();
            for (const propertyKey of this.keys)
                keySet.add(String(propertyKey));
            if (this.presenceKeys !== null) {
                for (const propertyKey of this.presenceKeys) {
                    keySet.add(String(propertyKey));
                }
            }
            this.keySet = keySet;
        }
        return keySet.has(key);
    }

    /** Re-read every captured cell; false as soon as one differs. */
    public isUnchanged(): boolean {
        const rawNode = this.rawNode;
        const ownKeys = this.ownKeys;
        if (ownKeys !== null) {
            const current = Reflect.ownKeys(rawNode);
            if (current.length !== ownKeys.length) return false;
            for (let index = 0; index < current.length; index++) {
                if (current[index] !== ownKeys[index]) return false;
            }
        }
        const keys = this.keys;
        const cells = this.cells;
        const source =
            rawNode instanceof ReactiveNode ? this.baseProxy : rawNode;
        for (let index = 0; index < keys.length; index++) {
            const current = toComparisonCell(Reflect.get(source, keys[index]));
            if (!Object.is(current, cells[index])) return false;
        }
        const presenceKeys = this.presenceKeys;
        if (presenceKeys !== null && this.presenceCells !== null) {
            for (let index = 0; index < presenceKeys.length; index++) {
                if (
                    Reflect.has(rawNode, presenceKeys[index]) !==
                    this.presenceCells[index]
                ) {
                    return false;
                }
            }
        }
        const replayed = this.replayed;
        if (replayed !== null) {
            for (const read of replayed) {
                if (!read.isUnchanged()) return false;
            }
        }
        return true;
    }

    /** True when `other` captured the same reads of the same node. */
    public matches(other: NodeReadRecord): boolean {
        if (other.rawNode !== this.rawNode) return false;
        if (other.wholeNodeRead !== this.wholeNodeRead) return false;
        if (!areCellListsEqual(this.keys, other.keys)) return false;
        if (!areCellListsEqual(this.cells, other.cells)) return false;
        if (!areNullableCellListsEqual(this.ownKeys, other.ownKeys)) {
            return false;
        }
        if (!areNullableCellListsEqual(this.presenceKeys, other.presenceKeys)) {
            return false;
        }
        if (
            !areNullableCellListsEqual(this.presenceCells, other.presenceCells)
        ) {
            return false;
        }
        const replayed = this.replayed;
        const otherReplayed = other.replayed;
        if (replayed === null || otherReplayed === null) {
            return replayed === otherReplayed;
        }
        if (replayed.length !== otherReplayed.length) return false;
        for (let index = 0; index < replayed.length; index++) {
            if (
                toComparisonCell(replayed[index].node) !==
                toComparisonCell(otherReplayed[index].node)
            ) {
                return false;
            }
        }
        return true;
    }

    /** Flat comparison cells for `{ node, comparisons }` dependency values. */
    public comparisonCells(): unknown[] {
        const cells = this.cells.slice();
        if (this.presenceCells !== null) {
            for (const cell of this.presenceCells) cells.push(cell);
        }
        if (this.ownKeys !== null) {
            for (const key of this.ownKeys) cells.push(key);
        }
        return cells;
    }

    /** @internal Retire every read of `propertyKey`, keeping them re-checkable. */
    public retireReads(
        propertyKey: string | symbol,
        retired: RetiredRead[]
    ): void {
        const keys = this.keys;
        const cells = this.cells;
        let write = 0;
        for (let read = 0; read < keys.length; read++) {
            if (keys[read] === propertyKey) {
                retired.push(new RetiredRead(this, propertyKey, cells[read]));
                continue;
            }
            keys[write] = keys[read];
            cells[write] = cells[read];
            write++;
        }
        keys.length = write;
        cells.length = write;
        this.keySet = null;
    }
}

/**
 * A property read that a later write in the same run retired from its
 * record. Kept re-checkable so effects can detect that the run changed a
 * value it had already read.
 */
export class RetiredRead {
    constructor(
        private readonly record: NodeReadRecord,
        private readonly propertyKey: string | symbol,
        private readonly cell: unknown
    ) {}

    public isUnchanged(): boolean {
        const record = this.record;
        return Object.is(
            readCurrentCell(record.rawNode, record.baseProxy, this.propertyKey),
            this.cell
        );
    }
}

function areCellListsEqual(
    previous: readonly unknown[],
    next: readonly unknown[]
): boolean {
    if (previous.length !== next.length) return false;
    for (let index = 0; index < previous.length; index++) {
        if (!Object.is(previous[index], next[index])) return false;
    }
    return true;
}

function areNullableCellListsEqual(
    previous: readonly unknown[] | null,
    next: readonly unknown[] | null
): boolean {
    if (previous === null || next === null) return previous === next;
    return areCellListsEqual(previous, next);
}

/**
 * True when two runs read the same nodes in the same order and observed the
 * same cells. Drives the "dependency set changed" notification for tracked
 * selections whose selected value compared equal.
 */
export function areTrackedReadsEqual(
    previous: ReadonlyMap<TreeNode, NodeReadRecord>,
    next: ReadonlyMap<TreeNode, NodeReadRecord>
): boolean {
    if (previous.size !== next.size) return false;
    const nextRecords = next.values();
    for (const previousRecord of previous.values()) {
        const nextRecord = nextRecords.next().value;
        if (nextRecord === undefined) return false;
        if (!previousRecord.matches(nextRecord)) return false;
    }
    return true;
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

/**
 * Dependency values for `@select` collection: one `{ node, comparisons }`
 * per node read, the bare node when it was observed as a whole, plus one
 * entry per replayed memo read.
 */
function toDependencyValues(
    reads: ReadonlyMap<TreeNode, NodeReadRecord>
): unknown[] {
    const dependencies: unknown[] = [];
    for (const record of reads.values()) {
        if (record.wholeNodeRead) {
            dependencies.push(record.baseProxy);
        } else {
            dependencies.push({
                node: record.baseProxy,
                comparisons: record.comparisonCells(),
            } satisfies IReactiveDependency);
        }
        if (record.replayed === null) continue;
        for (const replayed of record.replayed) {
            dependencies.push({
                node: replayed.node,
                comparisons: replayed.capturedValues,
            } satisfies IReactiveDependency);
        }
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

function createDependencyAccessFrame(mode: FrameMode): DependencyAccessFrame {
    return {
        mode,
        entries: [],
        managedValueIndices: null,
        propertyValueIndices: null,
        reads: null,
        lastRecord: null,
        uncovered: [],
        writtenKeys: null,
        writeInvalidatedReads: null,
    };
}

function runDependenciesFrame<T>(callback: () => T): {
    value: T;
    frame: DependencyAccessFrame;
} {
    const frame = createDependencyAccessFrame(FrameMode.Dependencies);
    dependencyAccessStack.push(frame);
    try {
        return { value: callback(), frame };
    } finally {
        dependencyAccessStack.pop();
    }
}

export function collectDependencyAccesses<T>(callback: () => T): unknown[] {
    const { frame } = runDependenciesFrame(callback);
    return toDependencyValues(frame.reads ?? new Map());
}

export enum DependencySubscriptionKind {
    /** `nodeChanged` on the node itself. */
    Node,
    /** The node and every descendant, delivered per changed node. */
    Subtree,
}

/**
 * One node a tracked run must subscribe to: a cover whose subtree holds
 * every other node the run read through it.
 */
export interface ITrackedDependencySource {
    rawNode: TreeNode;
    baseProxy: TCustomProxy<TreeNode>;
    kind: DependencySubscriptionKind;
}

export interface ITrackedSelectionAccesses<T> {
    value: T;
    /**
     * The run's reads as `IReactiveDependency` values, one per node. Built
     * on demand: only `@select` collection consumes them.
     */
    getDependencies: () => unknown[];
    /**
     * The covers of the run's reads: nodes whose parent the run did not
     * read. A cover with covered children subscribes to its subtree; a
     * lone node subscribes to `nodeChanged`.
     */
    sources: readonly ITrackedDependencySource[];
    /** Every node the run read, keyed by raw node, in first-read order. */
    reads: ReadonlyMap<TreeNode, NodeReadRecord>;
    /**
     * Reads the run made and then invalidated by writing the same
     * owner+property later in the same run. Empty for pure runs.
     * `Retree.effect` re-checks these after a run so its creation run
     * cascades on self-writes exactly like steady-state runs do.
     */
    writeInvalidatedReads: readonly RetiredRead[];
}

/**
 * Resolve which records subscribe. A record created before its parent was
 * read is re-checked here; the rest were settled as they were created.
 */
function resolveCovers(
    frame: DependencyAccessFrame,
    reads: ReadonlyMap<TreeNode, NodeReadRecord>
): ITrackedDependencySource[] {
    const uncovered = frame.uncovered;
    for (const record of uncovered) {
        const parentHandler = record.ownerHandler[proxiedParentKey]?.handler;
        if (!parentHandler) continue;
        const parentRecord = reads.get(parentHandler[unproxiedBaseNodeKey]);
        if (parentRecord === undefined) continue;
        parentRecord.coversChildren = true;
        record.covered = true;
    }
    const covers: ITrackedDependencySource[] = [];
    for (const record of uncovered) {
        if (record.covered) continue;
        covers.push({
            rawNode: record.rawNode,
            baseProxy: record.baseProxy,
            kind: record.coversChildren
                ? DependencySubscriptionKind.Subtree
                : DependencySubscriptionKind.Node,
        });
    }
    return covers;
}

/**
 * Run a tracked selector and return its reads grouped per node, so tracked
 * `Retree.select` can subscribe once per cover and validate a dependency's
 * `nodeChanged` without re-running the selector.
 */
export function collectTrackedSelectionAccesses<T>(
    callback: () => T
): ITrackedSelectionAccesses<T> {
    const { value, frame } = runDependenciesFrame(callback);
    const reads = frame.reads ?? new Map<TreeNode, NodeReadRecord>();
    return {
        value,
        getDependencies: () => toDependencyValues(reads),
        sources: resolveCovers(frame, reads),
        reads,
        writeInvalidatedReads: frame.writeInvalidatedReads ?? [],
    };
}

export function collectDependencyComparisonAccesses<T>(callback: () => T): {
    value: T;
    comparisons: unknown[];
} {
    let value: T | undefined;
    const frame = createDependencyAccessFrame(FrameMode.Comparisons);
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

/**
 * Record of the node behind `handler`, created on first read. A new record
 * whose parent already has one is covered by it; otherwise it is queued for
 * the cover check at collection.
 */
function getReadRecord(
    frame: DependencyAccessFrame,
    handler: ICustomProxyHandler<TreeNode>
): NodeReadRecord {
    const lastRecord = frame.lastRecord;
    if (lastRecord !== null && lastRecord.ownerHandler === handler) {
        return lastRecord;
    }
    const reads = (frame.reads ??= new Map());
    const rawNode = handler[unproxiedBaseNodeKey];
    let record = reads.get(rawNode);
    if (record === undefined) {
        record = new NodeReadRecord(handler);
        reads.set(rawNode, record);
        const parentHandler = handler[proxiedParentKey]?.handler;
        const parentRecord = parentHandler
            ? reads.get(parentHandler[unproxiedBaseNodeKey])
            : undefined;
        if (parentRecord !== undefined) {
            parentRecord.coversChildren = true;
            record.covered = true;
        } else {
            frame.uncovered.push(record);
        }
    }
    frame.lastRecord = record;
    return record;
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
    if (currentFrame.mode === FrameMode.Dependencies) {
        if (handler !== undefined) {
            getReadRecord(currentFrame, handler).wholeNodeRead = true;
        }
        return value;
    }
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
    // Fetch the value's handler once; it answers the comparison cell and the
    // whole-value read of a managed child below.
    const valueHandler =
        value !== null && typeof value === "object"
            ? getCustomProxyHandlerFromMetadata(value)
            : undefined;
    const ownerUnproxiedNode = ownerHandler[unproxiedBaseNodeKey];
    const arrayElementRead = isArrayElementRead(
        ownerUnproxiedNode,
        propertyKey
    );
    if (currentFrame.mode === FrameMode.Dependencies) {
        const record = getReadRecord(currentFrame, ownerHandler);
        record.wholeNodeRead = false;
        record.keys.push(propertyKey);
        record.cells.push(
            valueHandler === undefined
                ? value
                : valueHandler[unproxiedBaseNodeKey]
        );
        // A managed child counts as read whole until one of its properties
        // is read. Array slots compare raw identities and never do.
        if (valueHandler !== undefined && !arrayElementRead) {
            getReadRecord(currentFrame, valueHandler).wholeNodeRead = true;
        }
        return value;
    }
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
    const valueUnproxiedNode = valueHandler?.[unproxiedBaseNodeKey];
    const entryIndex = currentFrame.entries.length;
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
    if (valueUnproxiedNode !== undefined && !arrayElementRead) {
        currentFrame.propertyValueIndices = appendIndexEntry(
            currentFrame.propertyValueIndices,
            valueUnproxiedNode,
            entryIndex
        );
    }
    return value;
}

/**
 * Record a key-presence read (`"key" in node`) on a tracked frame.
 *
 * @remarks
 * The read re-checks `Reflect.has` during validation and carries the checked
 * key so plain objects stay key-scopable: adding or deleting the checked key
 * emits a change record for exactly that key, while unrelated writes are
 * skipped.
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
    if (currentFrame.mode === FrameMode.Dependencies) {
        const record = getReadRecord(currentFrame, ownerHandler);
        record.wholeNodeRead = false;
        (record.presenceKeys ??= []).push(propertyKey);
        (record.presenceCells ??= []).push(isPresent);
        return;
    }
    const ownerUnproxiedNode = ownerHandler[unproxiedBaseNodeKey];
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
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
 * The read re-reads the raw node's own keys during validation, so key
 * additions/deletions/renames invalidate while value writes to existing keys
 * validate away. It has no property key: a keys read cannot be scoped to
 * individual changed keys, so it disables key scoping for the owner.
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
    if (currentFrame.mode === FrameMode.Dependencies) {
        const record = getReadRecord(currentFrame, ownerHandler);
        record.wholeNodeRead = false;
        record.ownKeys = Reflect.ownKeys(ownerUnproxiedNode);
        return;
    }
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
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
    if (
        currentFrame === undefined ||
        currentFrame.mode !== FrameMode.Dependencies
    ) {
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
        const handler = getCustomProxyHandlerFromMetadata(dependencyNode);
        if (handler === undefined) {
            continue;
        }
        // Cached trapped memos can already know the current comparison cells
        // from their validation pass. Reusing those cells keeps nested @select
        // collection from re-running expensive property accessors a second time.
        const record = getReadRecord(currentFrame, handler);
        (record.replayed ??= []).push(
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
    if (currentFrame.mode === FrameMode.Dependencies) {
        const record = currentFrame.reads?.get(ownerUnproxiedNode);
        if (record === undefined) {
            return;
        }
        record.retireReads(
            propertyKey,
            (currentFrame.writeInvalidatedReads ??= [])
        );
        return;
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
