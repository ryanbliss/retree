/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { TRetreeChangedEvents, TreeNode } from "@retreejs/core";
import {
    getNodeSnapshotVersion,
    getTreeSnapshotVersion,
} from "@retreejs/core/internal";
import { useMemo, useRef } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import { subscribeToNode } from "./subscriptionHub";

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
        let changed = false;
        const nextVersions = sources.map((source, index) => {
            const version = source.getVersion();
            if (!Object.is(version, versions[index])) {
                changed = true;
            }
            return version;
        });
        if (changed) {
            versions = nextVersions;
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

function useStableRetreeExternalStoreSources(
    sources: readonly RetreeExternalStoreSource[]
): readonly RetreeExternalStoreSource[] {
    const stableSourcesRef = useRef<readonly RetreeExternalStoreSource[]>([]);
    if (
        !areRetreeExternalStoreSourcesEqual(stableSourcesRef.current, sources)
    ) {
        stableSourcesRef.current = sources;
    }
    return stableSourcesRef.current;
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
