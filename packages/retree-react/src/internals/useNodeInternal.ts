/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { TreeNode } from "@retreejs/core";
import { getBaseProxy, getReproxyNode } from "@retreejs/core/internal";
import { NodeFactory } from "../types";
import { subscribeToNode } from "./subscriptionHub";
import {
    useNodeInternalCore,
    UseNodeInternalListenerType,
    UseNodeInternalOperations,
} from "./useNodeInternalCore";

const operations: UseNodeInternalOperations = {
    cleanupSubscription(_listenerType, unsubscribe) {
        unsubscribe();
    },
    getInitialReproxyNode(_listenerType, node) {
        return getReproxyNode(node);
    },
    getRenderBaseProxy(_listenerType, node) {
        return getBaseProxy(node);
    },
    getResetReproxyNode(_listenerType, node) {
        return getReproxyNode(node);
    },
    getStateBaseProxy(_listenerType, node) {
        return getBaseProxy(node);
    },
    subscribeToNode(listenerType, node, listener) {
        return subscribeToNode(node, listenerType, listener);
    },
};

/**
 * Stateful version of an object and its leafs.
 */
export function useNodeInternal<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>,
    listenerType: UseNodeInternalListenerType
): T {
    return useNodeInternalCore(node, listenerType, operations);
}
