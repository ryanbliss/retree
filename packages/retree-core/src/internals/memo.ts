/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ReactiveNode } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import {
    DependencyComparisonAccessor,
    collectDependencyComparisonAccesses,
    replayDependencyComparisonAccesses,
} from "./dependency-tracking.js";
import { getDependencyComparisonValues } from "./dependencies.js";
import { getUnproxiedNode } from "./proxy.js";
import { getManagedProxyForUnproxiedNode } from "./reproxy.js";

/**
 * @internal
 * One memoized result for a {@link ReactiveNode}, keyed by getter name (decorator form)
 * or explicit string key (method form).
 */
interface IMemoCacheEntry {
    value: unknown;
    /**
     * Comparisons array captured the last time the memo computed.
     * `undefined` means "no comparisons; invalidate when the ReactiveNode reproxies."
     */
    comparisons: unknown[] | undefined;
    /**
     * Original comparison cells used for automatic dependency trapping. These
     * cells can refresh their current comparison values without recomputing the
     * memoized getter or method body.
     */
    comparisonAccessors: unknown[] | undefined;
    comparisonSnapshots: IComparisonSnapshot[] | undefined;
    /**
     * Reproxy reference at the time of caching. Used to detect "the ReactiveNode
     * has reproxied since this entry was made" for the `undefined` comparisons case.
     */
    reproxy: TreeNode | undefined;
    /**
     * Arguments captured the last time a function memo computed.
     * `undefined` means this entry belongs to regular getter memoization.
     */
    args: unknown[] | undefined;
}

interface IComparisonSnapshot {
    comparison: unknown;
    sourceReproxy: TreeNode | undefined;
    normalizedValues: unknown[];
}

const memoCacheMap = new WeakMap<
    ReactiveNode,
    Map<string | symbol, IMemoCacheEntry>
>();

function getOrCreateMemoCache(
    unproxied: ReactiveNode
): Map<string | symbol, IMemoCacheEntry> {
    let cache = memoCacheMap.get(unproxied);
    if (!cache) {
        cache = new Map();
        memoCacheMap.set(unproxied, cache);
    }
    return cache;
}

function shallowEqualArrays(a: unknown[], b: unknown[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false;
    }
    return true;
}

/**
 * @internal
 * Shared memo runner used by both `ReactiveNode.memo(...)` (method form) and the
 * `@memo` decorator. Keys are unique per ReactiveNode instance.
 *
 * Cache semantics:
 * - `comparisons === undefined`: hit when the current reproxy of the instance is the same
 *   object as the one captured at compute time. (Recompute once per reproxy.)
 * - `comparisons === []`: hit always (two empty arrays are shallow-equal).
 * - `comparisons` populated: hit when shallow-equal to the stored array.
 */
export function runMemo<T>(
    instance: ReactiveNode,
    key: string | symbol,
    fn: () => T,
    comparisons: unknown[] | undefined
): T {
    // Cache by the unproxied instance so reproxy churn doesn't lose entries.
    const unproxied = getUnproxiedNode(instance) as ReactiveNode | undefined;
    if (!unproxied) {
        // Defensive: ReactiveNode without a stable identity can't be cached safely.
        return fn();
    }
    const cache = getOrCreateMemoCache(unproxied);
    const currentReproxy = getManagedProxyForUnproxiedNode(unproxied);
    // Tree nodes are compared by their latest reproxy identity. The buildProxy a user
    // gets via `this.list` is stable across the lifetime of the tree, so it would never
    // appear "changed". The reproxy ref is what bumps on every mutation.
    const normalized =
        comparisons === undefined
            ? undefined
            : normalizeComparisons(comparisons);
    const prev = cache.get(key);
    if (prev) {
        if (normalized === undefined) {
            if (
                prev.comparisons === undefined &&
                prev.reproxy === currentReproxy
            ) {
                return prev.value as T;
            }
        } else if (
            prev.comparisons !== undefined &&
            shallowEqualArrays(prev.comparisons, normalized)
        ) {
            return prev.value as T;
        }
    }
    const value = fn();
    // Capture the reproxy AFTER fn so any mutations the computation performed on
    // `this` (e.g. an internal counter) are folded into the cached snapshot. Otherwise
    // the very first read would reproxy mid-compute and every subsequent read would
    // be a cache miss.
    cache.set(key, {
        value,
        comparisons: normalized,
        comparisonAccessors: undefined,
        comparisonSnapshots: undefined,
        reproxy: getManagedProxyForUnproxiedNode(unproxied) ?? currentReproxy,
        args: undefined,
    });
    return value;
}

export function runTrappedMemo<T>(
    instance: ReactiveNode,
    key: string | symbol,
    fn: () => T
): T {
    const unproxied = getUnproxiedNode(instance) as ReactiveNode | undefined;
    if (!unproxied) {
        return fn();
    }
    const cache = getOrCreateMemoCache(unproxied);
    const prev = cache.get(key);
    if (
        prev !== undefined &&
        prev.args === undefined &&
        prev.comparisonAccessors !== undefined
    ) {
        const latest = normalizeComparisonsWithSnapshots(
            prev.comparisonAccessors,
            prev.comparisonSnapshots
        );
        if (shallowEqualArrays(prev.comparisons ?? [], latest.values)) {
            prev.comparisons = latest.values;
            prev.comparisonSnapshots = latest.snapshots;
            replayDependencyComparisonAccesses(
                prev.comparisonAccessors,
                latest.snapshots.map((snapshot) => snapshot.normalizedValues)
            );
            return prev.value as T;
        }
    }

    const result = collectDependencyComparisonAccesses(fn);
    const normalized = normalizeComparisonsWithSnapshots(result.comparisons);
    cache.set(key, {
        value: result.value,
        comparisons: normalized.values,
        comparisonAccessors: result.comparisons,
        comparisonSnapshots: normalized.snapshots,
        reproxy: getManagedProxyForUnproxiedNode(unproxied),
        args: undefined,
    });
    return result.value;
}

/**
 * @internal
 * Shared memo runner used by the `@fnMemo` decorator. It follows the same
 * dependency semantics as {@link runMemo}, but also shallow-compares the
 * arguments passed to the function every time.
 */
export function runFnMemo<T>(
    instance: ReactiveNode,
    key: string | symbol,
    fn: () => T,
    args: unknown[],
    comparisons: unknown[] | undefined
): T {
    const unproxied = getUnproxiedNode(instance) as ReactiveNode | undefined;
    if (!unproxied) {
        return fn();
    }
    const cache = getOrCreateMemoCache(unproxied);
    const currentReproxy = getManagedProxyForUnproxiedNode(unproxied);
    const normalizedArgs = normalizeComparisons(args);
    const normalizedComparisons =
        comparisons === undefined
            ? undefined
            : normalizeComparisons(comparisons);
    const prev = cache.get(key);
    if (prev && prev.args !== undefined) {
        const argsMatch = shallowEqualArrays(prev.args, normalizedArgs);
        if (argsMatch && normalizedComparisons === undefined) {
            if (
                prev.comparisons === undefined &&
                prev.reproxy === currentReproxy
            ) {
                return prev.value as T;
            }
        }
        if (
            argsMatch &&
            normalizedComparisons !== undefined &&
            prev.comparisons !== undefined &&
            shallowEqualArrays(prev.comparisons, normalizedComparisons)
        ) {
            return prev.value as T;
        }
    }
    const value = fn();
    cache.set(key, {
        value,
        comparisons: normalizedComparisons,
        comparisonAccessors: undefined,
        comparisonSnapshots: undefined,
        reproxy: getManagedProxyForUnproxiedNode(unproxied) ?? currentReproxy,
        args: normalizedArgs,
    });
    return value;
}

export function runTrappedFnMemo<T>(
    instance: ReactiveNode,
    key: string | symbol,
    fn: () => T,
    args: unknown[]
): T {
    const unproxied = getUnproxiedNode(instance) as ReactiveNode | undefined;
    if (!unproxied) {
        return fn();
    }
    const cache = getOrCreateMemoCache(unproxied);
    const normalizedArgs = normalizeComparisons(args);
    const prev = cache.get(key);
    if (
        prev !== undefined &&
        prev.args !== undefined &&
        prev.comparisonAccessors !== undefined &&
        shallowEqualArrays(prev.args, normalizedArgs)
    ) {
        const latest = normalizeComparisonsWithSnapshots(
            prev.comparisonAccessors,
            prev.comparisonSnapshots
        );
        if (shallowEqualArrays(prev.comparisons ?? [], latest.values)) {
            prev.comparisons = latest.values;
            prev.comparisonSnapshots = latest.snapshots;
            replayDependencyComparisonAccesses(
                prev.comparisonAccessors,
                latest.snapshots.map((snapshot) => snapshot.normalizedValues)
            );
            return prev.value as T;
        }
    }

    const result = collectDependencyComparisonAccesses(fn);
    const normalized = normalizeComparisonsWithSnapshots(result.comparisons);
    cache.set(key, {
        value: result.value,
        comparisons: normalized.values,
        comparisonAccessors: result.comparisons,
        comparisonSnapshots: normalized.snapshots,
        reproxy: getManagedProxyForUnproxiedNode(unproxied),
        args: normalizedArgs,
    });
    return result.value;
}

/**
 * Replace each tree-node cell with its latest reproxy reference. This makes shallow
 * comparison detect mutations: the stable "base proxy" returned by `this.list` would
 * never change identity, but the reproxy bumps every time the node mutates.
 */
function normalizeComparisons(comparisons: unknown[]): unknown[] {
    return normalizeComparisonsWithSnapshots(comparisons).values;
}

function normalizeComparisonsWithSnapshots(
    comparisons: unknown[],
    previousSnapshots?: IComparisonSnapshot[]
): {
    values: unknown[];
    snapshots: IComparisonSnapshot[];
} {
    const values: unknown[] = [];
    const snapshots: IComparisonSnapshot[] = [];
    for (let i = 0; i < comparisons.length; i++) {
        const comparison = comparisons[i];
        const snapshot = normalizeComparisonWithSnapshot(
            comparison,
            previousSnapshots?.[i]
        );
        values.push(...snapshot.normalizedValues);
        snapshots.push(snapshot);
    }
    return { values, snapshots };
}

function normalizeComparisonWithSnapshot(
    comparison: unknown,
    previousSnapshot?: IComparisonSnapshot
): IComparisonSnapshot {
    const sourceReproxy = getComparisonSourceReproxy(comparison);
    if (
        sourceReproxy !== undefined &&
        previousSnapshot !== undefined &&
        previousSnapshot.comparison === comparison &&
        previousSnapshot.sourceReproxy === sourceReproxy
    ) {
        return previousSnapshot;
    }
    const normalizedValues = getComparisonCells(comparison).map((cell) =>
        normalizeComparisonCell(cell)
    );
    return {
        comparison,
        sourceReproxy,
        normalizedValues,
    };
}

function getComparisonCells(comparison: unknown): unknown[] {
    if (!isDependencyComparisonAccessor(comparison)) {
        return [comparison];
    }
    return getDependencyComparisonValues(comparison.getValues());
}

function getComparisonSourceReproxy(comparison: unknown): TreeNode | undefined {
    if (!isDependencyComparisonAccessor(comparison)) {
        return undefined;
    }
    const sourceUnproxiedNode = comparison.sourceUnproxiedNode;
    if (sourceUnproxiedNode === undefined) {
        return undefined;
    }
    return getManagedProxyForUnproxiedNode(sourceUnproxiedNode);
}

function normalizeComparisonCell(cell: unknown): unknown {
    if (cell !== null && typeof cell === "object") {
        const unproxy = getUnproxiedNode(cell as TreeNode);
        if (unproxy) {
            const reproxy = getManagedProxyForUnproxiedNode(unproxy);
            if (reproxy) {
                return reproxy;
            }
        }
    }
    return cell;
}

function isDependencyComparisonAccessor(
    value: unknown
): value is DependencyComparisonAccessor {
    if (value === null || typeof value !== "object") {
        return false;
    }
    return (
        Reflect.get(value, "kind") === "retree-dependency-comparison-accessor"
    );
}

/**
 * @internal
 * One frame of the "currently-evaluating getter" stack used by the keyless
 * `this.memo(fn, deps)` form to derive the cache key from the active getter.
 */
interface IMemoGetterFrame {
    getterName: string | symbol;
    memoCalled: boolean;
}

const memoGetterStackMap = new WeakMap<ReactiveNode, IMemoGetterFrame[]>();
const reactiveNodePrototypeGetterNamesCache = new WeakMap<
    object,
    Set<string | symbol>
>();

/**
 * Prototypes whose getters are known to call the keyless `this.memo(fn, deps)`
 * form. Getter reads on any other prototype skip memo-frame bookkeeping
 * entirely (the common case); membership is established lazily on the first
 * keyless memo call via {@link KeylessMemoFrameRequest}.
 */
const keylessMemoPrototypes = new WeakSet<object>();

/**
 * Test probe: total {@link pushMemoGetter} frames ever pushed. Lets specs
 * assert that getter reads on classes without keyless memo skip frame
 * bookkeeping.
 *
 * @internal
 */
export function getMemoGetterFramePushCount(): number {
    return memoGetterFramePushCount;
}
let memoGetterFramePushCount = 0;

const KEYLESS_MEMO_GUIDANCE =
    "memo() was called without a key outside of a ReactiveNode getter. " +
    "This is expected when keyless memo is used from a method, callback, constructor, or async continuation after the getter has returned. " +
    "Fix: call keyless memo directly inside a ReactiveNode getter, or pass an explicit key as the first argument: `this.memo('myKey', fn, deps)`.";

/**
 * Control-flow signal thrown by the first-ever keyless memo call on a class
 * whose getter reads took the frame-free fast path. The proxy get trap that
 * invoked the getter catches it (instance-matched) and re-runs the getter
 * with a memo-getter frame pushed; the prototype is marked before throwing so
 * every later getter read takes the frame-pushing slow path directly.
 *
 * Consequences for keyless-memo users:
 *
 * - The first-ever keyless call on a class RE-RUNS the getter body from the
 *   top (once). Getters are assumed pure, so the re-run is unobservable for
 *   idiomatic getters; a getter with side effects (counters, logging,
 *   mutations) would observe its body running twice on that first read.
 * - A user `try`/`catch` inside the getter that wraps the `this.memo(...)`
 *   call can swallow this control-flow request before the proxy trap sees
 *   it, leaving the getter to complete without a memo cell (or to surface a
 *   confusing outside-a-getter message on a later call). If you must wrap
 *   keyless memo in a `try`/`catch`, rethrow errors whose constructor is
 *   `KeylessMemoFrameRequest` (matched by `error.name ===
 *   "KeylessMemoFrameRequest"`), or avoid the problem entirely by passing an
 *   explicit key: `this.memo('myKey', fn, deps)`.
 *
 * If this error ever reaches user code outside a getter, no getter read was
 * on the stack, so the call really was made outside a getter — the message
 * carries the same guidance as the regular outside-a-getter error for that
 * case.
 */
class KeylessMemoFrameRequest extends Error {
    public readonly retreeKeylessMemoOwner: ReactiveNode;
    constructor(owner: ReactiveNode) {
        super(KEYLESS_MEMO_GUIDANCE);
        this.name = "KeylessMemoFrameRequest";
        this.retreeKeylessMemoOwner = owner;
    }
}

function isKeylessMemoFrameRequestFor(
    error: unknown,
    owner: ReactiveNode
): error is KeylessMemoFrameRequest {
    if (!(error instanceof KeylessMemoFrameRequest)) {
        return false;
    }
    return error.retreeKeylessMemoOwner === owner;
}

/**
 * @internal
 * Read a property of a raw ReactiveNode on behalf of a proxy get trap,
 * pushing a memo-getter frame around getter invocations only when the
 * instance's class is known to use the keyless `this.memo(...)` form.
 *
 * Fast path (class never marked): one WeakSet lookup, no getter detection,
 * no frame allocation. The first keyless memo call on such a class throws
 * {@link KeylessMemoFrameRequest} from `consumeCurrentMemoGetter`, which is
 * caught here and answered by re-running the getter with a frame — so keyless
 * memo still works on its first-ever call.
 */
export function readReactiveNodeProperty(
    instance: ReactiveNode,
    prop: string | symbol,
    receiver: unknown
): unknown {
    const owner = resolveStackOwner(instance);
    const prototype = Object.getPrototypeOf(owner);
    if (prototype !== null && keylessMemoPrototypes.has(prototype)) {
        if (getReactiveNodeGetter(instance, prop)) {
            pushMemoGetter(instance, prop);
            try {
                return Reflect.get(instance, prop, receiver);
            } finally {
                popMemoGetter(instance);
            }
        }
        return Reflect.get(instance, prop, receiver);
    }
    try {
        return Reflect.get(instance, prop, receiver);
    } catch (error) {
        if (!isKeylessMemoFrameRequestFor(error, owner)) {
            throw error;
        }
        // consumeCurrentMemoGetter marked the prototype before throwing;
        // re-run the getter with a frame so this first call succeeds.
        pushMemoGetter(instance, prop);
        try {
            return Reflect.get(instance, prop, receiver);
        } finally {
            popMemoGetter(instance);
        }
    }
}

function resolveStackOwner(target: object): ReactiveNode {
    // The stack must always be keyed by the unproxied instance so that pushes from
    // proxy.ts (which sees the raw target) and reads from `this.memo(...)` (which
    // sees a proxy) end up at the same map entry.
    const unproxied = getUnproxiedNode(target as TreeNode) as
        | ReactiveNode
        | undefined;
    return unproxied ?? (target as ReactiveNode);
}

/**
 * @internal
 * Push a frame onto the memo-getter stack. Called by `proxy.ts` / `reproxy.ts`
 * immediately before invoking a `ReactiveNode` getter via `Reflect.get`.
 */
export function pushMemoGetter(
    target: ReactiveNode,
    getterName: string | symbol
): void {
    const owner = resolveStackOwner(target);
    let stack = memoGetterStackMap.get(owner);
    if (!stack) {
        stack = [];
        memoGetterStackMap.set(owner, stack);
    }
    stack.push({ getterName, memoCalled: false });
    memoGetterFramePushCount += 1;
}

/**
 * @internal
 * Pop the most recent frame; paired with {@link pushMemoGetter} in a try/finally.
 */
export function popMemoGetter(target: ReactiveNode): void {
    const owner = resolveStackOwner(target);
    const stack = memoGetterStackMap.get(owner);
    if (stack) stack.pop();
}

/**
 * @internal
 * Read the active getter name for a keyless `this.memo(fn, deps)` call and mark
 * the frame as having consumed its memo cell. Throws if invoked outside a getter,
 * or more than once within the same getter invocation (which would silently
 * collide on the same cache cell).
 */
export function consumeCurrentMemoGetter(
    instance: ReactiveNode
): string | symbol {
    const owner = resolveStackOwner(instance);
    const stack = memoGetterStackMap.get(owner);
    const top = stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
    if (!top) {
        const prototype = Object.getPrototypeOf(owner);
        if (prototype !== null && !keylessMemoPrototypes.has(prototype)) {
            // First keyless memo call for this class: getter reads have been
            // taking the frame-free fast path, so no frame exists even if we
            // are inside a getter right now. Mark the prototype and ask the
            // invoking proxy trap (if any) to re-run the getter with a frame.
            keylessMemoPrototypes.add(prototype);
            // @retree-throws
            throw new KeylessMemoFrameRequest(owner);
        }
        // @retree-throws
        throw new Error(KEYLESS_MEMO_GUIDANCE);
    }
    if (top.memoCalled) {
        // @retree-throws
        throw new Error(
            `memo() was called more than once in getter '${String(
                top.getterName
            )}' without an explicit key. This is expected when one getter needs multiple memo cells. Pass a unique string key as the first ` +
                "argument: `this.memo('myKey', fn, deps)`."
        );
    }
    top.memoCalled = true;
    return top.getterName;
}

/**
 * @internal
 * Walk the prototype chain looking for `prop`. Returns the getter function if the
 * first descriptor found is an accessor with a `get`; returns `undefined`
 * otherwise (data prop, method, or missing). Used to decide whether a `Reflect.get`
 * call needs to be wrapped with push/pop for memo-getter tracking.
 */
export function getReactiveNodeGetter(
    target: object,
    prop: string | symbol
): (() => unknown) | undefined {
    if (!reactiveNodePrototypeHasGetter(target, prop)) {
        return undefined;
    }
    let current: object | null = target;
    while (current && current !== Object.prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(current, prop);
        if (descriptor) {
            // Own descriptors shadow prototype descriptors. If the first one we find
            // isn't a getter (e.g. it's a data property), there's nothing to wrap.
            return descriptor.get;
        }
        current = Object.getPrototypeOf(current);
    }
    return undefined;
}

function reactiveNodePrototypeHasGetter(
    target: object,
    prop: string | symbol
): boolean {
    const prototype = Object.getPrototypeOf(target);
    if (prototype === null) {
        return false;
    }
    const getterNames = getReactiveNodePrototypeGetterNames(prototype);
    return getterNames.has(prop);
}

function getReactiveNodePrototypeGetterNames(
    prototype: object
): Set<string | symbol> {
    const cached = reactiveNodePrototypeGetterNamesCache.get(prototype);
    if (cached !== undefined) {
        return cached;
    }
    const getterNames = new Set<string | symbol>();
    let current: object | null = prototype;
    while (current && current !== Object.prototype) {
        for (const key of Reflect.ownKeys(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor?.get !== undefined) {
                getterNames.add(key);
            }
        }
        current = Object.getPrototypeOf(current);
    }
    reactiveNodePrototypeGetterNamesCache.set(prototype, getterNames);
    return getterNames;
}
