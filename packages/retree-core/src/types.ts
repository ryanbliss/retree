/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

export type TreeNode<T extends object = object> = T;

export type OptionalNode<T extends TreeNode = TreeNode> =
    | (undefined | null | T)
    | (undefined | T)
    | (null | T);

export type RetreeObjectMoveKey<
    TDestination extends TreeNode,
    TNode extends TreeNode
> = {
    [K in keyof TDestination]-?: TNode extends TDestination[K] ? K : never;
}[keyof TDestination];

/**
 * Listener types for {@link Retree.on} that return a reproxied node.
 */
export type TRetreeChangedEvents = "nodeChanged" | "treeChanged";

/**
 * All listener types for {@link Retree.on}.
 */
export type TRetreeEvents = TRetreeChangedEvents | "nodeRemoved";

/**
 * Listener callback function types for {@link Retree.on}.
 */
export type TRetreeListeners = (reproxiedNode: TreeNode) => void | (() => void);

/**
 * Listener callback function type for {@link Retree.on} which returns a reproxied node.
 * See {@link TRetreeChangedEvents} for corresponding listener type.
 */
export type TNodeChangedListener = (reproxiedNode: TreeNode) => void;
