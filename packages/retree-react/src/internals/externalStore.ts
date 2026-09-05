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

import { INodeFieldChanges, TreeNode } from "@retreejs/core";
import {
    getNodeSnapshotVersion,
    getTreeSnapshotVersion,
    getUnproxiedNode,
} from "@retreejs/core/internal";
import { useEffect, useMemo, useRef } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import { registerReactBatchedListenerFlushWrapper } from "./reactBatch.js";
import { RetreeStoreListenerType, subscribeToNode } from "./subscriptionHub.js";

// Every subscribing hook (useNode/useTree/useRaw/useSelect) flows through
// this module, so registering here guarantees the React batching wrapper is
// installed before any Retree listener a hook creates can flush.
registerReactBatchedListenerFlushWrapper();

export type RetreeStoreChangeListener = (
    node: TreeNode,
    changes?: INodeFieldChanges[]
) => void;

export interface RetreeExternalStoreSource {
    readonly baseProxy: TreeNode;
    readonly listenerType: RetreeStoreListenerType;
    getVersion(): number;
    subscribe(onStoreChange: RetreeStoreChangeListener): () => void;
}

export interface RetreeSnapshotChange {
    readonly rawNode: TreeNode;
    readonly changes: INodeFieldChanges[] | undefined;
}

export interface RetreeCompositeSnapshot {
    readonly kind: "retree-external-store-snapshot";
    readonly sources: readonly RetreeExternalStoreSource[];
    readonly versions: readonly number[];
    /**
     * Changes delivered to a live subscription since the previous snapshot.
     * `undefined` when a version moved without one, so the consumer cannot
     * scope its work to the changed nodes.
     */
    readonly changes: readonly RetreeSnapshotChange[] | undefined;
}

export interface RetreeCompositeExternalStore {
    getServerSnapshot(): RetreeCompositeSnapshot;
    getSnapshot(): RetreeCompositeSnapshot;
    subscribe(onStoreChange: RetreeStoreChangeListener): () => void;
}

const sourceCache = new WeakMap<
    TreeNode,
    Map<RetreeStoreListenerType, RetreeExternalStoreSource>
>();

function createSnapshot(
    sources: readonly RetreeExternalStoreSource[],
    versions: readonly number[],
    changes: readonly RetreeSnapshotChange[] | undefined
): RetreeCompositeSnapshot {
    const snapshot: RetreeCompositeSnapshot = {
        kind: "retree-external-store-snapshot",
        sources,
        versions: Object.freeze([...versions]),
        changes,
    };
    return Object.freeze(snapshot);
}

export function getRetreeExternalStoreSource(
    baseProxy: TreeNode,
    listenerType: RetreeStoreListenerType
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
            // A subtree source moves with any descendant, like a tree source.
            if (listenerType === "nodeChanged") {
                return getNodeSnapshotVersion(baseProxy);
            }
            return getTreeSnapshotVersion(baseProxy);
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
    let snapshot = createSnapshot(sources, versions, undefined);
    // Changes seen by the live subscription since `snapshot` was taken. They
    // describe every version move only while a subscriber was wired the whole
    // time, so a gap resets them to unknown.
    let pendingChanges: RetreeSnapshotChange[] = [];
    let pendingChangesKnown = false;
    let subscriberCount = 0;

    const hasMovedSinceSnapshot = () => {
        for (let index = 0; index < sources.length; index++) {
            if (!Object.is(sources[index].getVersion(), versions[index])) {
                return true;
            }
        }
        return false;
    };

    const getSnapshot = () => {
        // Compare in a plain loop first so the unchanged path (the common
        // case: getSnapshot runs on every render) allocates nothing and
        // returns the previous snapshot by reference. A flush emits one
        // notification per changed node under one version move, so changes
        // delivered since the snapshot also make it stale.
        let changed = pendingChanges.length > 0;
        for (let index = 0; !changed && index < sources.length; index++) {
            changed = !Object.is(sources[index].getVersion(), versions[index]);
        }
        if (changed) {
            versions = sources.map((source) => source.getVersion());
            const changes =
                pendingChangesKnown && pendingChanges.length > 0
                    ? pendingChanges
                    : undefined;
            snapshot = createSnapshot(sources, versions, changes);
            pendingChanges = [];
            pendingChangesKnown = subscriberCount > 0;
        }
        return snapshot;
    };

    return {
        getSnapshot,
        getServerSnapshot: getSnapshot,
        subscribe(onStoreChange) {
            const onSourceChange: RetreeStoreChangeListener = (
                node,
                changes
            ) => {
                const rawNode = getUnproxiedNode(node);
                if (rawNode !== undefined) {
                    pendingChanges.push({ rawNode, changes });
                }
                onStoreChange(node, changes);
            };
            const unsubscribes = sources.map((source) =>
                source.subscribe(onSourceChange)
            );
            if (subscriberCount === 0) {
                pendingChangesKnown = !hasMovedSinceSnapshot();
            }
            subscriberCount += 1;
            let unsubscribed = false;
            return () => {
                if (unsubscribed) {
                    return;
                }
                unsubscribed = true;
                for (const unsubscribe of unsubscribes) {
                    unsubscribe();
                }
                subscriberCount -= 1;
                if (subscriberCount === 0) {
                    pendingChangesKnown = false;
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
    readonly onStoreChange: RetreeStoreChangeListener;
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
