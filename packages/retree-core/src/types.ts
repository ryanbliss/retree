/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * An object value that can live in a Retree tree.
 *
 * @remarks
 * This is deliberately an identity alias rather than a branded type. Retree
 * accepts plain objects everywhere (`Retree.root({...})`, children read from
 * a tree, values assigned into a tree), so a brand would force casts at every
 * public entry point without preventing any real misuse — runtime guards
 * (`Retree.isNode`, managed-node assertions) are the actual enforcement
 * layer. The alias stays for signature readability: `TreeNode` marks "this
 * parameter is tree data" in a way `object` does not.
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
 * The key of a field-level change record.
 *
 * @remarks
 * Property writes carry the property key (`string` for data fields and array
 * indices, `symbol` for symbol-keyed fields). Map mutations carry the
 * original Map key value — including object keys — instead of a stringified
 * form. Collection-level operations use operation names (`"add"`,
 * `"delete"`, `"clear"`) or method names (Date setters).
 */
export type TNodeFieldChangeKey = PropertyKey | object;

/**
 * Structural operation marker on a field-level change record.
 *
 * @remarks
 * `previous`/`new` values alone cannot always describe a mutation exactly:
 * assigning `undefined` to a property and deleting that property produce the
 * same value pair, and array structural methods shift elements without
 * emitting a record per shifted index. The marker carries the missing fact so
 * {@link Retree.applyInverse} and {@link Retree.applyChanges} can restore
 * state exactly.
 *
 * - `"add"` — the key/entry did not exist before this change (object
 *   property creation, `Map.set` of a new key). Inverse: delete the key.
 * - `"delete"` — the key/entry was removed (property `delete`, `Map.delete`,
 *   and the per-entry records emitted by `Map.clear`). Inverse: restore
 *   `previous` at the key.
 * - `"insert"` — an element was inserted by an array structural method
 *   (`push`, `unshift`, `splice`); `key` is the element's index in the
 *   post-mutation array. Inverse: `splice(index, 1)`.
 * - `"remove"` — an element was removed by an array structural method
 *   (`pop`, `shift`, `splice`); `key` is the element's index in the
 *   pre-mutation array. Inverse: `splice(index, 0, previous)`.
 * - `"length"` — the length adjustment accompanying an array structural
 *   method. It is bookkeeping for the `insert`/`remove` records in the same
 *   set; applying those already restores the length, so inversion skips it.
 * - `"clear"` — the summary record emitted by `Map.clear`/`Set.clear`
 *   alongside the per-entry `"delete"` records. The marker separates it from
 *   a plain write to a literal `"clear"` Map key; inversion skips it because
 *   the per-entry records restore the contents.
 *
 * Records without a marker are plain value rewrites (`previous` -> `new` at
 * `key`) and invert by writing `previous` back. A direct `array.length = n`
 * assignment emits an unmarked `length` record; the elements a shrinking
 * assignment discards emit no records, so only the length itself can be
 * restored.
 */
export type TNodeFieldChangeOp =
    | "add"
    | "delete"
    | "insert"
    | "remove"
    | "length"
    | "clear";

/**
 * Field-level change metadata passed to Retree change listeners.
 *
 * @remarks
 * `previous` and `new` are **raw values, always** — change records are
 * descriptions of the past, not live handles. Listeners that need the
 * managed node for an object value opt in with `Retree.managed(value)`.
 * Identity comparisons against payload values should be raw-to-raw:
 * `change.previous === Retree.raw(candidate)`.
 *
 * `node` is the **raw node whose field changed, always** — like the payload
 * values, it is a description, not a live handle; resolve it with
 * `Retree.managed(change.node)` when a managed node is needed. Because
 * dependency-driven `ReactiveNode` emissions forward the dependency's change
 * records, `node` is how a listener tells records describing the listened-to
 * node's own fields apart from forwarded records describing a dependency.
 */
export interface INodeFieldChanges<TValue = unknown> {
    node: TreeNode;
    key: TNodeFieldChangeKey;
    previous: TValue;
    new: TValue;
    /**
     * Structural operation marker, present only when `previous`/`new` alone
     * cannot describe the mutation exactly. See {@link TNodeFieldChangeOp}.
     */
    op?: TNodeFieldChangeOp;
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
