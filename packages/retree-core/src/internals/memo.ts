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
