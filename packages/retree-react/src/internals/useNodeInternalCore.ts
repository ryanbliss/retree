/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo": the React Compiler must not compile this file. Retree hooks
// read mutable module state during render on purpose —
// operations.getRenderReproxyNode(baseProxy) returns the *latest* reproxy for
// a base proxy whose identity is intentionally stable across writes. Compiled,
// that call is memoized on the stable base proxy and keeps returning the
// pre-write reproxy, breaking the hooks' identity contract ("a changed node is
// a new reference") for React.memo, useMemo deps, and compiler-memoized
// consumers. react-compiler.spec.tsx proves the failure with the directive
// stripped and that the directive is respected as-is. The directive only
// matters when this *source* is compiled (monorepo/source-inclusion setups);
// consumers' compilers skip the published bin/ output in node_modules.
"use no memo";
"use client";

import { TreeNode } from "@retreejs/core";
import { useMemo } from "react";
import { NodeFactory } from "../types.js";
import {
    RetreeExternalStoreSource,
    useRetreeExternalStore,
} from "./externalStore.js";
import {
    NodeFactoryHookName,
    useNodeFactoryResetWarning,
} from "./factoryWarning.js";

export type UseNodeInternalListenerType = "nodeChanged" | "treeChanged";

export interface UseNodeInternalOperations {
    getRenderBaseProxy<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    getRenderReproxyNode<T extends TreeNode>(
        listenerType: UseNodeInternalListenerType,
        node: T
    ): T;
    /**
     * Resolve the external-store source for a base proxy. Must return the
     * same source instance for the same `(baseProxy, listenerType)` pair so
     * the composite store (and its subscription) is reused across renders.
     */
    getSource(
        listenerType: UseNodeInternalListenerType,
        baseProxy: TreeNode
    ): RetreeExternalStoreSource;
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
    hookName: NodeFactoryHookName,
    operations: UseNodeInternalOperations
): T {
    const memoNode = useMemo(() => {
        return getNode(node);
    }, [node]);

    // We can listen to a reproxied or base proxy node, but base proxies change less frequently.
    // Listen to the baseProxy changes. This is cheap so it's okay to do it unmemoized.
    const baseProxy = operations.getRenderBaseProxy<T>(listenerType, memoNode);
    useNodeFactoryResetWarning(hookName, node, baseProxy);
    const source = operations.getSource(listenerType, baseProxy);
    useRetreeExternalStore([source]);

    return operations.getRenderReproxyNode(listenerType, baseProxy);
}
