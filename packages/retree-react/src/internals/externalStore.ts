/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo" is load-bearing when this source is compiled by the React
// Compiler (source-inclusion setups only; consumers' compilers skip the
// published bin/ output in node_modules). See useNodeInternalCore.ts and
// react-compiler.spec.tsx for the failure mode and proof.
"use no memo";
"use client";

import { TRetreeChangedEvents, TreeNode } from "@retreejs/core";
import {
    getNodeSnapshotVersion,
    getTreeSnapshotVersion,
} from "@retreejs/core/internal";
import { useEffect, useMemo, useRef } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import { registerReactBatchedListenerFlushWrapper } from "./reactBatch.js";
import { subscribeToNode } from "./subscriptionHub.js";

// Every subscribing hook (useNode/useTree/useRaw/useSelect) flows through
// this module, so registering here guarantees the React batching wrapper is
// installed before any Retree listener a hook creates can flush.
registerReactBatchedListenerFlushWrapper();

export interface RetreeExternalStoreSource {
    readonly baseProxy: TreeNode;
    readonly listenerType: TRetreeChangedEvents;
    getVersion(): number;
    subscribe(onStoreChange: () => void): () => void;
}

export interface RetreeCompositeSnapshot {
    readonly kind: "retree-external-store-snapshot";
    readonly sources: readonly RetreeExternalStoreSource[];
    readonly versions: readonly number[];
}

export interface RetreeCompositeExternalStore {
    getServerSnapshot(): RetreeCompositeSnapshot;
    getSnapshot(): RetreeCompositeSnapshot;
    subscribe(onStoreChange: () => void): () => void;
}

const sourceCache = new WeakMap<
    TreeNode,
    Map<TRetreeChangedEvents, RetreeExternalStoreSource>
>();

function createSnapshot(
    sources: readonly RetreeExternalStoreSource[],
    versions: readonly number[]
): RetreeCompositeSnapshot {
    const snapshot: RetreeCompositeSnapshot = {
        kind: "retree-external-store-snapshot",
        sources,
        versions: Object.freeze([...versions]),
    };
    return Object.freeze(snapshot);
}

export function getRetreeExternalStoreSource(
    baseProxy: TreeNode,
    listenerType: TRetreeChangedEvents
): RetreeExternalStoreSource {
    let nodeSources = sourceCache.get(baseProxy);
    if (nodeSources === undefined) {
        nodeSources = new Map();
        sourceCache.set(baseProxy, nodeSources);
    }

    const cached = nodeSources.get(listenerType);
    if (cached !== undefined) {
        return cached;
    }

    const source: RetreeExternalStoreSource = {
        baseProxy,
        listenerType,
        getVersion() {
            if (listenerType === "treeChanged") {
                return getTreeSnapshotVersion(baseProxy);
            }
            return getNodeSnapshotVersion(baseProxy);
        },
        subscribe(onStoreChange) {
            return subscribeToNode(baseProxy, listenerType, onStoreChange);
        },
    };
    nodeSources.set(listenerType, source);
    return source;
}

export function areRetreeExternalStoreSourcesEqual(
    previous: readonly RetreeExternalStoreSource[],
    next: readonly RetreeExternalStoreSource[]
): boolean {
    if (previous.length !== next.length) {
        return false;
    }
    for (let index = 0; index < previous.length; index++) {
        if (previous[index] !== next[index]) {
            return false;
        }
    }
    return true;
}

export function dedupeRetreeExternalStoreSources(
    sources: readonly RetreeExternalStoreSource[]
): RetreeExternalStoreSource[] {
    const seen = new Set<RetreeExternalStoreSource>();
    const deduped: RetreeExternalStoreSource[] = [];
    for (const source of sources) {
        if (seen.has(source)) {
            continue;
        }
        seen.add(source);
        deduped.push(source);
    }
    return deduped;
}

export function createRetreeCompositeExternalStore(
    inputSources: readonly RetreeExternalStoreSource[]
): RetreeCompositeExternalStore {
    const sources = Object.freeze(
        dedupeRetreeExternalStoreSources(inputSources)
    );
    let versions = sources.map((source) => source.getVersion());
    let snapshot = createSnapshot(sources, versions);

    const getSnapshot = () => {
        // Compare in a plain loop first so the unchanged path (the common
        // case: getSnapshot runs on every render) allocates nothing and
        // returns the previous snapshot by reference.
        let changed = false;
        for (let index = 0; index < sources.length; index++) {
            if (!Object.is(sources[index].getVersion(), versions[index])) {
                changed = true;
                break;
            }
        }
        if (changed) {
            versions = sources.map((source) => source.getVersion());
            snapshot = createSnapshot(sources, versions);
        }
        return snapshot;
    };

    return {
        getSnapshot,
        getServerSnapshot: getSnapshot,
        subscribe(onStoreChange) {
            const unsubscribes = sources.map((source) =>
                source.subscribe(onStoreChange)
            );
            return () => {
                for (const unsubscribe of unsubscribes) {
                    unsubscribe();
                }
            };
        },
    };
}

export interface RetreeSwappableCompositeExternalStore
    extends RetreeCompositeExternalStore {
    /**
     * Replace the underlying composite store with one built from
     * `nextSources`, rewiring every live subscription in place: each active
     * `onStoreChange` is unsubscribed from the old sources and subscribed to
     * the new ones synchronously, so no write to the new sources can fall in
     * an unwired gap.
     */
    swapSources(nextSources: readonly RetreeExternalStoreSource[]): void;
}

interface SwappableStoreWiring {
    readonly onStoreChange: () => void;
    unsubscribe: () => void;
}

/**
 * A composite external store whose `subscribe` identity stays stable while
 * its source list can be swapped.
 *
 * @remarks
 * `useSyncExternalStore(subscribe, getSnapshot)` captures `subscribe` before
 * it calls `getSnapshot` during render. When a render-phase `getSnapshot`
 * recomputes dependencies and they moved (for example a selector's branch
 * flipped), replacing the store object would strand the already-committed
 * subscription on the old sources: the commit keeps the old `subscribe`, the
 * post-commit snapshot check sees no change, and writes to the newly-depended
 * sources never notify. This wrapper keeps `subscribe` stable and instead
 * rewires live subscriptions synchronously inside {@link
 * RetreeSwappableCompositeExternalStore.swapSources}. Because
 * `useSyncExternalStore` only resubscribes when the `subscribe` identity
 * changes, the wrapper owns rewiring for the lifetime of one store handle.
 */
export function createRetreeSwappableCompositeExternalStore(
    initialSources: readonly RetreeExternalStoreSource[]
): RetreeSwappableCompositeExternalStore {
    let current = createRetreeCompositeExternalStore(initialSources);
    const wirings = new Set<SwappableStoreWiring>();
    return {
        getSnapshot: () => current.getSnapshot(),
        getServerSnapshot: () => current.getServerSnapshot(),
        subscribe: (onStoreChange) => {
            const wiring: SwappableStoreWiring = {
                onStoreChange,
                unsubscribe: current.subscribe(onStoreChange),
            };
            wirings.add(wiring);
            return () => {
                if (!wirings.delete(wiring)) {
                    return;
                }
                wiring.unsubscribe();
            };
        },
        swapSources: (nextSources) => {
            current = createRetreeCompositeExternalStore(nextSources);
            // Rewire synchronously: no other code runs between the old
            // unsubscribe and the new subscribe, so the swap cannot miss a
            // write. A swap with no live wirings (before mount, after
            // unmount) only replaces the inner store; `subscribe` reads
            // `current` at call time.
            for (const wiring of wirings) {
                wiring.unsubscribe();
                wiring.unsubscribe = current.subscribe(wiring.onStoreChange);
            }
        },
    };
}

function useStableRetreeExternalStoreSources(
    sources: readonly RetreeExternalStoreSource[]
): readonly RetreeExternalStoreSource[] {
    // Only committed renders write the ref (render-phase ref writes are unsafe
    // under concurrent rendering). During render we compare against the last
    // committed list and reuse its identity when the entries are equal, so
    // downstream memoization keys stay stable across re-renders.
    const committedSourcesRef = useRef<
        readonly RetreeExternalStoreSource[] | undefined
    >(undefined);
    const committedSources = committedSourcesRef.current;
    let stableSources = sources;
    if (
        committedSources !== undefined &&
        areRetreeExternalStoreSourcesEqual(committedSources, sources)
    ) {
        stableSources = committedSources;
    }
    useEffect(() => {
        committedSourcesRef.current = stableSources;
    });
    return stableSources;
}

export function useRetreeCompositeExternalStore(
    sources: readonly RetreeExternalStoreSource[]
): RetreeCompositeExternalStore {
    const stableSources = useStableRetreeExternalStoreSources(sources);
    return useMemo(
        () => createRetreeCompositeExternalStore(stableSources),
        [stableSources]
    );
}

export function useRetreeExternalStore(
    sources: readonly RetreeExternalStoreSource[]
): void {
    const store = useRetreeCompositeExternalStore(sources);
    useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot
    );
}
