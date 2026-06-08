/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { TreeNode } from "@retreejs/core";
import { useEffect, useMemo, useState } from "react";
import { NodeFactory } from "../types";

export type UseNodeInternalListenerType = "nodeChanged" | "treeChanged";

export interface UseNodeInternalOperations {
    cleanupSubscription(
        listenerType: UseNodeInternalListenerType,
        unsubscribe: () => void
    ): void;
    getInitialReproxyNode<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    getRenderBaseProxy<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    getResetReproxyNode<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    getStateBaseProxy<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    subscribeToNode<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T,
        listener: (proxy: T) => void
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

    const [nodeState, setNodeState] = useState<{ node: T }>(() => ({
        node: operations.getInitialReproxyNode(listenerType, memoNode),
    }));

    // We can listen to a reproxied or base proxy node, but base proxies change less frequently.
    // Listen to the baseProxy changes. This is cheap so it's okay to do it unmemoized.
    const baseProxy = operations.getRenderBaseProxy<T>(listenerType, memoNode);
    useEffect(() => {
        const unsubscribe = operations.subscribeToNode<T>(
            listenerType,
            baseProxy,
            (proxy) => {
                setNodeState({ node: proxy });
            }
        );
        // Unsubscribe on unmount
        return () => {
            operations.cleanupSubscription(listenerType, unsubscribe);
        };
    }, [baseProxy, listenerType, operations]);

    // We want to reset our state when our prop changes to a new node without causing a re-render via `useEffect`.
    // Fortunately our base proxies never change for a given node, so we compare old and new values.
    // If the values differ, we set `nodeState.node` to the latest reproxied value.
    const currentStateBaseProxy = operations.getStateBaseProxy<T>(
        listenerType,
        nodeState.node
    );
    if (currentStateBaseProxy !== baseProxy) {
        nodeState.node = operations.getResetReproxyNode<T>(
            listenerType,
            baseProxy
        );
    }

    return nodeState.node;
}
