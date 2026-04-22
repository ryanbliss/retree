import { TreeNode } from "@retreejs/core";

export type NodeFactory<T extends TreeNode = TreeNode> = () => T;