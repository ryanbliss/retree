/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

export type TreeNode<T extends object = object> = T;

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
