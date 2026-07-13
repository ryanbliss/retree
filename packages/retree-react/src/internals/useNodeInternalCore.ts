/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { TreeNode } from "@retreejs/core";
import { useMemo } from "react";
import { NodeFactory } from "../types";
import {
    RetreeExternalStoreSource,
    useRetreeExternalStore,
} from "./externalStore";

export type UseNodeInternalListenerType = "nodeChanged" | "treeChanged";

export interface UseNodeInternalOperations {
    cleanupSubscription(
        listenerType: UseNodeInternalListenerType,
        unsubscribe: () => void
    ): void;
    getRenderBaseProxy<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    getRenderReproxyNode<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    getSnapshotVersion<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): number;
    subscribeToNode<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T,
        listener: () => void
    ): () => void;
}

function getNode<T extends TreeNode = TreeNode>(node: T | (() => T)) {
    if (typeof node === "function") {
        return node();
    }
    return node;
}

/**
 * Shared hook mechanics for useNode/useTree.
 */
export function useNodeInternalCore<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>,
    listenerType: UseNodeInternalListenerType,
    operations: UseNodeInternalOperations
): T {
    const memoNode = useMemo(() => {
        return getNode(node);
    }, [node]);

    // We can listen to a reproxied or base proxy node, but base proxies change less frequently.
    // Listen to the baseProxy changes. This is cheap so it's okay to do it unmemoized.
    const baseProxy = operations.getRenderBaseProxy<T>(listenerType, memoNode);
    const source = useMemo<RetreeExternalStoreSource>(
        () => ({
            baseProxy,
            listenerType,
            getVersion: () =>
                operations.getSnapshotVersion(listenerType, baseProxy),
            subscribe: (onStoreChange) => {
                const unsubscribe = operations.subscribeToNode(
                    listenerType,
                    baseProxy,
                    onStoreChange
                );
                return () => {
                    operations.cleanupSubscription(listenerType, unsubscribe);
                };
            },
        }),
        [baseProxy, listenerType, operations]
    );
    useRetreeExternalStore([source]);

    return operations.getRenderReproxyNode(listenerType, baseProxy);
}
