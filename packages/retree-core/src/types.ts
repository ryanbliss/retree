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
 * Field-level change metadata passed to Retree change listeners.
 *
 * @remarks
 * `previous` and `new` are **raw values, always** — change records are
 * descriptions of the past, not live handles. Listeners that need the
 * managed node for an object value opt in with `Retree.source(value)`.
 * Identity comparisons against payload values should be raw-to-raw:
 * `change.previous === Retree.raw(candidate)`.
 */
export interface INodeFieldChanges<TValue = unknown> {
    key: string;
    previous: TValue;
    new: TValue;
}

/**
 * Listener callback function types for {@link Retree.on}.
 */
export type TRetreeListeners = TNodeChangedListener | (() => void);

/**
 * Listener callback function type for {@link Retree.on} which returns a reproxied node.
 * See {@link TRetreeChangedEvents} for corresponding listener type.
 */
export type TNodeChangedListener<TNode extends TreeNode = TreeNode> = (
    reproxiedNode: TNode,
    changes: INodeFieldChanges[]
) => void;
