/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "@retreejs/core";
import { NodeFactory } from "./types";
import { useNodeInternal } from "./internals/useNodeInternal.benchmark";

const NODE_CHANGED_LISTENER_TYPE = "nodeChanged";
const TREE_CHANGED_LISTENER_TYPE = "treeChanged";

export * from "./useSelect";
export * from "./useRoot";
export * from "./types";
export {
    __unstable_setUseNodeInternalBenchmarkRecorder,
    type UseNodeInternalBenchmarkMeasurement,
    type UseNodeInternalBenchmarkOperation,
    type UseNodeInternalBenchmarkRecorder,
} from "./internals/useNodeInternalBenchmark";

export function useNode<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>
): T {
    return useNodeInternal(node, NODE_CHANGED_LISTENER_TYPE);
}

export function useTree<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>
): T {
    return useNodeInternal(node, TREE_CHANGED_LISTENER_TYPE);
}
