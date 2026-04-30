/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ReactiveNode } from "../ReactiveNode";
import { TreeNode } from "../types";
import { getUnproxiedNode } from "./proxy";
import { getReproxyNodeForUnproxiedNode } from "./reproxy";

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
     * Reproxy reference at the time of caching. Used to detect "the ReactiveNode
     * has reproxied since this entry was made" for the `undefined` comparisons case.
     */
    reproxy: TreeNode | undefined;
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
    const currentReproxy = getReproxyNodeForUnproxiedNode(unproxied);
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
        reproxy: getReproxyNodeForUnproxiedNode(unproxied) ?? currentReproxy,
    });
    return value;
}

/**
 * Replace each tree-node cell with its latest reproxy reference. This makes shallow
 * comparison detect mutations: the stable "base proxy" returned by `this.list` would
 * never change identity, but the reproxy bumps every time the node mutates.
 */
function normalizeComparisons(comparisons: unknown[]): unknown[] {
    const out = new Array(comparisons.length);
    for (let i = 0; i < comparisons.length; i++) {
        const cell = comparisons[i];
        if (cell !== null && typeof cell === "object") {
            const unproxy = getUnproxiedNode(cell as TreeNode);
            if (unproxy) {
                const reproxy = getReproxyNodeForUnproxiedNode(unproxy);
                if (reproxy) {
                    out[i] = reproxy;
                    continue;
                }
            }
        }
        out[i] = cell;
    }
    return out;
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
        throw new Error(
            "memo() was called without a key outside of a ReactiveNode getter. " +
                "Either call memo from a getter, or pass an explicit key as the first " +
                "argument: `this.memo('myKey', fn, deps)`."
        );
    }
    if (top.memoCalled) {
        throw new Error(
            `memo() was called more than once in getter '${String(
                top.getterName
            )}' without an explicit key. Pass a unique string key as the first ` +
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
