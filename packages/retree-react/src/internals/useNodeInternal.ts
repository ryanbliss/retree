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

import { TreeNode } from "@retreejs/core";
import { getBaseProxy, getReproxyNode } from "@retreejs/core/internal";
import { NodeFactory } from "../types.js";
import { getRetreeExternalStoreSource } from "./externalStore.js";
import { NodeFactoryHookName } from "./factoryWarning.js";
import {
    useNodeInternalCore,
    UseNodeInternalListenerType,
    UseNodeInternalOperations,
} from "./useNodeInternalCore.js";

const operations: UseNodeInternalOperations = {
    getRenderBaseProxy(_listenerType, node) {
        return getBaseProxy(node);
    },
    getRenderReproxyNode(_listenerType, node) {
        return getReproxyNode(node);
    },
    getSource(listenerType, baseProxy) {
        return getRetreeExternalStoreSource(baseProxy, listenerType);
    },
};

/**
 * Stateful version of an object and its leafs.
 */
export function useNodeInternal<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>,
    listenerType: UseNodeInternalListenerType,
    hookName: NodeFactoryHookName
): T {
    return useNodeInternalCore(node, listenerType, hookName, operations);
}
