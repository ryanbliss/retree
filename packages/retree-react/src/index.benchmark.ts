/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

"use client";

import { TreeNode } from "@retreejs/core";
import { NodeFactory } from "./types.js";
import { useNodeInternal } from "./internals/useNodeInternal.benchmark.js";

const NODE_CHANGED_LISTENER_TYPE = "nodeChanged";
const TREE_CHANGED_LISTENER_TYPE = "treeChanged";

export * from "./useSelect.js";
export * from "./useRoot.js";
export * from "./types.js";
export {
    __unstable_setUseNodeInternalBenchmarkRecorder,
    type UseNodeInternalBenchmarkMeasurement,
    type UseNodeInternalBenchmarkOperation,
    type UseNodeInternalBenchmarkRecorder,
} from "./internals/useNodeInternalBenchmark.js";

export function useNode<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>
): T {
    return useNodeInternal(node, NODE_CHANGED_LISTENER_TYPE, "useNode");
}

export function useTree<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>
): T {
    return useNodeInternal(node, TREE_CHANGED_LISTENER_TYPE, "useTree");
}
