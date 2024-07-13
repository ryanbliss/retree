/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Retree, TreeNode } from "@retreejs/core";
import { getReproxyNode, getBaseProxy } from "@retreejs/core/internal";
import { useEffect, useState } from "react";

/**
 * Stateful version of an object and its leafs.
 */
export function useNodeInternal<T extends TreeNode = TreeNode>(
    node: T,
    listenerType: "nodeChanged" | "treeChanged"
): T {
    const [nodeState, setNodeState] = useState<{ node: T }>({
        node: getReproxyNode<T>(node),
    });

    // We can listen to a reproxied or base proxy node, but base proxies change less frequently.
    // Listen to the baseProxy changes. This is cheap so it's okay to do it unmemoized.
    const baseProxy = getBaseProxy<T>(node);
    useEffect(() => {
        // Listen to changes to the node
        const unsubscribe = Retree.on<T>(baseProxy, listenerType, (proxy) => {
            setNodeState({ node: proxy });
        });
        // Unsubscribe on unmount
        return unsubscribe;
    }, [baseProxy, listenerType]);

    // We want to reset our state when our prop changes to a new node without causing a re-render via `useEffect`.
    // Fortunately our base proxies never change for a given node, so we compare old and new values.
    // If the values differ, we set `nodeState.node` to the latest reproxied value.
    const currentStateBaseProxy = getBaseProxy<T>(nodeState.node);
    if (currentStateBaseProxy !== baseProxy) {
        nodeState.node = getReproxyNode<T>(baseProxy);
    }

    return nodeState.node;
}
