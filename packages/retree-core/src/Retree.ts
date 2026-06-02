/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    buildProxy,
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
    getUnproxiedNodeFromProxy,
} from "./internals";
import { TreeChangeEmitter } from "./internals/NodeChangeEmitter";
import { proxiedParentKey, TCustomProxy } from "./internals/proxy-types";
import {
    deleteReactiveDependencies,
    deleteReactiveDependent,
    getReactiveDependencies,
    getReactiveDependents,
    IActiveReactiveDependency,
    IPreviousReactiveDependent,
    retainReactiveDependencySubscription,
    setReactiveDependencies,
    setReactiveDependents,
} from "./internals/reactive-node-utils";
import {
    getReproxyNode,
    getReproxyNodeForUnproxiedNode,
    updateReproxyNode,
} from "./internals/reproxy";
import {
    createRetreeSelectionObserver,
    createRetreeTrackedSelectionObserver,
    defaultSelectEquals,
    normalizeSelectDependencies,
    RetreeSelectEquals,
    RetreeSelectSelector,
    RetreeTrackedSelectSelector,
} from "./internals/select";
import { runWithIsolatedDependencyTracking } from "./internals/dependency-tracking";
import {
    areDependencyValuesEqual,
    getDependencyComparisonValues,
    normalizeDependencyEntry,
} from "./internals/dependencies";
import { Transactions } from "./internals/transactions";
import {
    LINKED_KEYS_SYMBOL,
    IReactiveDependency,
    ReactiveNode,
    RUN_CHANGED_EFFECT_SYMBOL,
    RUN_OBSERVED_EFFECT_SYMBOL,
    RUN_UNOBSERVED_EFFECT_SYMBOL,
    SELECT_GETTERS_SYMBOL,
    setReactiveNodeLinkImplementation,
    setReactiveNodeMoveImplementation,
} from "./ReactiveNode";
import {
    RetreeObjectMoveKey,
    TRetreeEvents,
    TNodeChangedListener,
    TRetreeListeners,
    TreeNode,
    TRetreeChangedEvents,
} from "./types";

export interface RetreeSelectOptions<TSelected = unknown> {
    equals?: RetreeSelectEquals<TSelected>;
    listenerType?: TRetreeChangedEvents;
}

type TInternalNodeChangedListener = (
    node: TreeNode,
    proxyNode: TCustomProxy<TreeNode>,
    reproxiedNode: TreeNode
) => void;

/**
 * Reactive pointer to a Retree-managed node owned somewhere else.
 *
 * @remarks
 * `RetreeLink` is created by {@link Retree.link}. Store it in a Retree tree
 * when one part of state needs to point at another node without becoming that
 * node's structural parent. Replacing {@link RetreeLink.current} emits for the
 * link. Mutating `current` emits from the target's structural location.
 *
 * Most code should call {@link Retree.link} instead of constructing this class
 * directly.
 *
 * @example
 * ```ts
 * const root = Retree.root({
 *     tasks: [{ title: "Docs" }],
 *     selected: null as RetreeLink<{ title: string }> | null,
 * });
 *
 * root.selected = Retree.link(root.tasks[0]);
 * root.selected.current.title = "Better docs";
 * ```
 */
export class RetreeLink<
    TNode extends TreeNode = TreeNode
> extends ReactiveNode {
    /**
     * The linked Retree-managed node.
     *
     * @remarks
     * Replacing `current` emits for the link node. Mutating the target emits
     * where that target is structurally owned.
     */
    public current: TNode;

    constructor(node: TNode) {
        super();
        this[LINKED_KEYS_SYMBOL].add("current");
        this.current = node;
    }

    get dependencies() {
        return [];
    }
}

/**
 * Main entry point for use with Retree package.
 * Exposes utility functions for observing to changes to an object and its children.
 */
export class Retree {
    static {
        setReactiveNodeLinkImplementation((node) => Retree.link(node));
        setReactiveNodeMoveImplementation((node, destination, key) =>
            Retree.moveInternal(node, destination, key)
        );
    }

    private static nodeChangeListener: TInternalNodeChangedListener | null =
        null;
    private static nodeRemovedListener: TInternalNodeChangedListener | null =
        null;

    private static treeChangedListeners: Map<TreeNode, TNodeChangedListener[]> =
        new Map();
    private static nodeChangedListeners: Map<TreeNode, TNodeChangedListener[]> =
        new Map();
    private static nodeRemovedListeners: Map<TreeNode, (() => void)[]> =
        new Map();
    private static nodeChangeEmitter = new TreeChangeEmitter();
    private static reactiveDependentNodeChangedListener = (
        reproxy: TreeNode
    ) => {
        this.handleReactiveDependentNodeChanged(reproxy);
    };

    /**
     * @deprecated
     * Use {@link root} instead.
     *
     * @example
     * ```ts
     * const state = Retree.use({ count: 0 }); // deprecated
     * const state = Retree.root({ count: 0 }); // preferred
     * ```
     */
    static use<T extends TreeNode = TreeNode>(object: T): T {
        return this.root(object);
    }

    /**
     * Builds a Retree compatible root node for the root object of your tree.
     * @remarks
     * Use this once where plain state enters Retree. The returned proxy is
     * compatible with {@link Retree.on}, {@link Retree.parent},
     * {@link Retree.move}, {@link Retree.link}, and React hooks from
     * `@retreejs/react`.
     *
     * Do mutate the returned tree directly with normal JavaScript assignment
     * and collection methods. Do not call `Retree.root(...)` on every child
     * you assign into the tree; Retree prepares children as they are attached
     * or read.
     *
     * @param object a root TreeNode for your tree
     * @returns a Retree compatible object of type T
     * 
     * @example
     * ```ts
     const counter = Retree.root({ count: 0 });
     Retree.on(counter, "nodeChanged", () => console.log(counter.count));
     counter.count = counter.count + 1;
     ```
     */
    static root<T extends TreeNode = TreeNode>(object: T): T {
        return buildProxy<T>(object, this.nodeChangeEmitter);
    }

    /**
     * Create a reactive pointer to an existing Retree-managed node.
     *
     * @remarks
     * The returned link can be stored in a Retree tree without reparenting the
     * linked target. Replacing `link.current` emits for the link; mutating the
     * linked target emits from its structural location.
     *
     * Use this for selected items, cross-references, and pointers into another
     * part of the same tree. Do not use a link when ownership should move; use
     * {@link Retree.move} instead. Do not use a link when the two locations
     * should diverge independently; use {@link Retree.clone} instead.
     *
     * @param node Existing Retree-managed node to point at.
     * @returns A Retree-managed link object whose `current` points at `node`.
     *
     * @example
     * ```ts
     * const root = Retree.root({
     *     tasks: [{ title: "Docs" }],
     *     selected: null as RetreeLink<{ title: string }> | null,
     * });
     *
     * root.selected = Retree.link(root.tasks[0]); // ✅ emits on root
     * root.selected.current.title = "Better docs"; // ✅ emits where task is owned
     * Retree.parent(root.selected.current) === root.tasks; // true
     * ```
     */
    static link<TNode extends TreeNode>(node: TNode): RetreeLink<TNode> {
        this.assertRetreeManagedNode(node, "Retree.link");
        return this.root(new RetreeLink(node));
    }

    /**
     * Clone a Retree-managed node into a detached object that can be assigned
     * somewhere else as a new structural child.
     *
     * @remarks
     * Use this when two places need independent state initialized from the
     * same current data. The clone is detached until you assign it into a
     * Retree tree. Mutating the clone after assignment emits for the clone's
     * new structural location, not the source node.
     *
     * Do not use `clone` when the original object should simply move; use
     * {@link Retree.move}. Do not use `clone` for a selected-item pointer; use
     * {@link Retree.link} or `@link`.
     *
     * @param node Existing Retree-managed node to copy.
     * @returns A detached copy of the node's current raw data.
     *
     * @example
     * ```ts
     * const project = Retree.root({ tasks: [{ title: "Draft" }] });
     * const copy = Retree.clone(project.tasks[0]);
     *
     * project.tasks.push(copy); // ✅ copy becomes a new child
     * project.tasks[1].title = "Published"; // source task is unchanged
     * ```
     */
    static clone<TNode extends TreeNode>(node: TNode): TNode {
        this.assertRetreeManagedNode(node, "Retree.clone");
        return this.cloneValue(getUnproxiedNode(node), new WeakMap()) as TNode;
    }

    /**
     * Move an existing Retree-managed node from its current parent to a new parent.
     *
     * @remarks
     * Retree is a pure tree: each node has one structural parent. Use `move`
     * when ownership should transfer from the old parent to the destination.
     * Retree finds the current parent with {@link Retree.parent} and removes
     * the node safely before inserting it into the destination.
     *
     * Arrays accept an optional numeric insertion index. Maps and plain
     * objects require a key. Sets ignore the key. Do not manually delete the
     * node from its old parent before calling `move`.
     *
     * @param node Existing Retree-managed node to move.
     * @param destination Retree-managed array, map, set, or object destination.
     * @param key Insertion index for arrays, map key for maps, or property key
     * for objects.
     * @returns The latest reproxy for the moved node.
     *
     * @example
     * ```ts
     * const workspace = Retree.root({
     *     todo: [{ title: "Docs" }],
     *     done: [] as { title: string }[],
     * });
     *
     * const moved = Retree.move(workspace.todo[0], workspace.done);
     * workspace.todo.length; // 0
     * workspace.done[0] === moved; // true
     * ```
     */
    static move<TNode extends TreeNode, TValue extends TreeNode = TNode>(
        node: TNode extends TValue ? TNode : never,
        destination: TValue[],
        key?: number
    ): TNode;
    static move<
        TNode extends TreeNode,
        TKey = unknown,
        TValue extends TreeNode = TNode
    >(
        node: TNode extends TValue ? TNode : never,
        destination: Map<TKey, TValue>,
        key: TKey
    ): TNode;
    static move<TNode extends TreeNode, TValue extends TreeNode = TNode>(
        node: TNode extends TValue ? TNode : never,
        destination: Set<TValue>
    ): TNode;
    static move<
        TNode extends TreeNode,
        TDestination extends TreeNode = TreeNode
    >(
        node: TNode,
        destination: TDestination,
        key: RetreeObjectMoveKey<TDestination, TNode>
    ): TNode;
    static move<TNode extends TreeNode>(
        node: TNode,
        destination: TreeNode,
        key?: unknown
    ): TNode {
        return this.moveInternal(node, destination, key);
    }

    private static moveInternal<TNode extends TreeNode>(
        node: TNode,
        destination: TreeNode,
        key?: unknown
    ): TNode {
        this.assertRetreeManagedNode(node, "Retree.move");
        this.assertRetreeManagedNode(destination, "Retree.move");

        const parent = this.getParentInternal(node);
        if (!parent) {
            // @retree-throws
            throw new Error(
                "Retree.move: cannot move a root node because it does not have a parent. This is expected when the node was created directly with Retree.root(...). Fix: move one of the root's children, assign the root into another tree as a cloned value with Retree.clone(...), or create the root under the desired parent first."
            );
        }

        const nodeToMove = getBaseProxy(node);
        Retree.runTransaction(() => {
            this.removeNodeFromParent(nodeToMove, parent.proxyNode);
            this.insertNodeIntoDestination(nodeToMove, destination, key);
        });
        return getReproxyNode(nodeToMove) as TNode;
    }

    /**
     * Listen for changes to a node.
     * @remarks
     * Use `nodeChanged` for changes directly owned by the node.
     * Use `treeChanged` for changes to the node or descendants.
     * Use `nodeRemoved` for when this node is removed from its parent.
     *
     * @param node the object to listen for changes to.
     * @param listenerType the type of {@link TRetreeEvents} change events to listen to.
     * @param callback the callback function for your listener.
     * @returns an unsubscribe function to clean up your listeners.
     * 
     * @example
     ```ts
     // Create the root node
     const counter = Retree.root({ count: 0 });
     // Listen for changes to values of the node
     const unsubscribe = Retree.on(counter, "nodeChanged", (reproxy) => {
        console.log(reproxy !== counter); // output: false
        console.log(reproxy.count === counter.count); // output: true
     });
     // Make a change
     counter.count = counter.count + 1;
     // Stop listening for changes
     unsubscribe();
     ```
     */
    static on<
        T extends TreeNode = TreeNode,
        TEvent extends TRetreeEvents = TRetreeEvents
    >(
        node: T,
        listenerType: TEvent,
        callback: TEvent extends TRetreeChangedEvents
            ? (reproxiedNode: T) => void
            : () => void
    ): () => void {
        if (!this.nodeChangeListener) {
            this.startListening();
        }

        const unproxiedNode = getUnproxiedNode(node);
        if (!unproxiedNode) {
            // @retree-throws
            throw new Error(
                "Retree.on: expected a Retree-managed node but received an unproxied value. This is expected when listening to a plain object. Fix: pass the object to Retree.root(...) first, or listen to a child value read from an existing Retree tree."
            );
        }
        const relevantListenerMap =
            listenerType === "nodeChanged"
                ? this.nodeChangedListeners
                : listenerType === "treeChanged"
                ? this.treeChangedListeners
                : this.nodeRemovedListeners;
        const isReactiveChangeListener =
            listenerType === "nodeChanged" || listenerType === "treeChanged";
        const wasObserved =
            node instanceof ReactiveNode &&
            isReactiveChangeListener &&
            this.hasReactiveChangedListeners(unproxiedNode);

        let listeners = relevantListenerMap.get(unproxiedNode);
        if (!listeners) {
            listeners = [callback as TRetreeListeners];
            relevantListenerMap.set(unproxiedNode, listeners);
        } else {
            listeners.push(callback as TRetreeListeners);
        }
        if (node instanceof ReactiveNode && isReactiveChangeListener) {
            if (!wasObserved) {
                ReactiveNode[RUN_OBSERVED_EFFECT_SYMBOL](node);
            }
            this.handleReactiveNode(node, unproxiedNode);
        }
        return this.buildUnsubscribeCallback(
            unproxiedNode,
            node,
            callback as TRetreeListeners,
            relevantListenerMap
        );
    }

    /**
     * Subscribe to a derived value from any Retree-managed node.
     *
     * @remarks
     * `select` recomputes the selected value when the observed node or selected
     * reactive dependencies emit, then calls `callback` only when the selection
     * changes. Selectors may return one value or an ordered dependency list.
     * Reactive entries in a dependency list are subscribed to; primitive and
     * plain entries are compared by identity.
     *
     * Dependency-list subscriptions are observational: if a selected dependency
     * emits, `select` calls your callback when the selection changes, but it
     * does not force the node passed to `select` to receive a fresh reproxy.
     * Use `@select` when a `ReactiveNode` owner should emit `nodeChanged`.
     * This is a subscription primitive, not a memo cache: use `memo` /
     * `fnMemo` to cache computation, and `select` to narrow notifications.
     *
     * By default `select` listens to `nodeChanged`, which is correct when the
     * selector reads fields directly owned by `node`. Pass
     * `listenerType: "treeChanged"` when the selector intentionally reads
     * descendants that are not included as reactive entries in a dependency
     * list.
     *
     * You can also call `Retree.select(() => value, callback)` without a node.
     * That form traps reads automatically. Whole Retree-managed values are
     * subscribed to broadly. Property reads subscribe to the owner node but
     * compare the specific property value, so `task.done` can react to task
     * replacement or `done` changes without reacting to unrelated task fields.
     * Primitive reads are kept as comparison values, so the callback only runs
     * when the trapped reads make the selected value or dependency set change.
     *
     * @param node Retree-managed node to observe.
     * @param selector Function that reads a selected value or dependency list
     * from the latest reproxy.
     * @param callback Called only when the selected value or dependency list
     * changes.
     * @param options Optional listener type and equality comparison for the
     * whole selected value or tuple.
     * @returns Unsubscribe function.
     *
     * @example
     * ```ts
     * const project = Retree.root({
     *     tasks: [{ done: false }, { done: true }],
     * });
     *
     * const unsubscribe = Retree.select(
     *     project.tasks,
     *     (tasks) => tasks.filter((task) => task.done).length,
     *     (next, previous) => console.log({ next, previous }),
     *     { listenerType: "treeChanged" }
     * );
     *
     * project.tasks[0].done = true; // ✅ callback: 1 -> 2
     * project.tasks[0].done = true; // ❌ selected value did not change
     * unsubscribe();
     * ```
     *
     * @example
     * ```ts
     * Retree.select(
     *     row,
     *     (self) => [self.attributes, self.attributeId, self.attribute],
     *     ([, , attribute]) => console.log(attribute)
     * );
     * ```
     *
     * @example
     * ```ts
     * Retree.select(
     *     () => project.tasks.filter((task) => task.done).length,
     *     (doneCount) => console.log(doneCount)
     * );
     * ```
     */
    static select<TNode extends TreeNode, TSelected>(
        node: TNode,
        selector: RetreeSelectSelector<TNode, TSelected>,
        callback: (next: TSelected, previous: TSelected) => void,
        options?: RetreeSelectOptions<TSelected>
    ): () => void;
    static select<TSelector extends RetreeTrackedSelectSelector<unknown>>(
        selector: TSelector,
        callback: (
            next: ReturnType<TSelector>,
            previous: ReturnType<TSelector>
        ) => void,
        options?: RetreeSelectOptions<ReturnType<TSelector>>
    ): () => void;
    static select<TNode extends TreeNode, TSelected>(
        nodeOrSelector: TNode | RetreeTrackedSelectSelector<TSelected>,
        selectorOrCallback:
            | RetreeSelectSelector<TNode, TSelected>
            | ((next: TSelected, previous: TSelected) => void),
        callbackOrOptions?:
            | ((next: TSelected, previous: TSelected) => void)
            | RetreeSelectOptions<TSelected>,
        options: RetreeSelectOptions<TSelected> = {}
    ): () => void {
        if (typeof nodeOrSelector === "function") {
            return createRetreeTrackedSelectionObserver({
                selector: nodeOrSelector,
                equals: (callbackOrOptions as RetreeSelectOptions<TSelected>)
                    ?.equals,
                subscribeToNode: (
                    selectedNode,
                    selectedListenerType,
                    listener
                ) => this.on(selectedNode, selectedListenerType, listener),
                onChange: selectorOrCallback as (
                    next: TSelected,
                    previous: TSelected
                ) => void,
            });
        }
        const node = nodeOrSelector;
        const selector = selectorOrCallback as RetreeSelectSelector<
            TNode,
            TSelected
        >;
        const callback = callbackOrOptions as (
            next: TSelected,
            previous: TSelected
        ) => void;
        const listenerType = options.listenerType ?? "nodeChanged";
        return createRetreeSelectionObserver({
            node,
            selector,
            equals: options.equals,
            listenerType,
            subscribeToNode: (selectedNode, selectedListenerType, listener) =>
                this.on(selectedNode, selectedListenerType, listener),
            onChange: callback,
        });
    }

    /**
     * Get a parent node for a given child node, if it exists
     * @param node a child node to get the parent of
     * @returns the parent node if it exists, otherwise null
     * 
     * @example
     ```js
     const tree = Retree.root({
        count: 0,
        child: {
            count: 0,
            child: {
                count: 0,
            },
        },
     });
     function recursiveLog(node) {
        console.log(node.count);
        // Get the parent of node, if it exists
        const parent = Retree.parent(node);
        if (!parent) return; // at top of tree
        recursiveLog(parent);
     }
     Retree.on(tree.child.child, "nodeChanged", (child) => {
        // Recursively log the count of this node and all its parents
        recursiveLog(child);
     });
     tree.child.child.count = 1;
     ```
     */
    static parent(node: TreeNode): TreeNode | null {
        const response = this.getParentInternal(node);
        return response?.proxyNode ?? null;
    }

    /**
     * Run a synchronous transaction that will not cause `{@link Retree.on} listeners to emit.
     *
     * @remarks
     * Use `runSilent` for non-rendered bookkeeping or integration state that
     * should update without notifying Retree listeners. By default it also
     * skips reproxying, so old and new object identities stay equal for later
     * comparison checks.
     *
     * Pass `skipReproxy = false` when you want to suppress listener emission
     * but still refresh reproxy identities.
     *
     * @param transaction transaction function to run
     * @param skipReproxy skip reproxying nodes such that subsequent comparisons are equal.
     * defaults to true.
     *
     * @example
     * ```ts
     * const state = Retree.root({ rendered: 0, telemetry: 0 });
     * Retree.on(state, "nodeChanged", () => console.log("render"));
     *
     * Retree.runSilent(() => {
     *     state.telemetry += 1;
     * }); // ❌ no listener emit
     *
     * state.rendered += 1; // ✅ emits
     * ```
     */
    static runSilent(transaction: () => void, skipReproxy = true) {
        Transactions.skipEmit = true;
        Transactions.skipReproxy = skipReproxy;
        try {
            transaction();
        } finally {
            // Silent mode uses global flags, so always restore them even when the caller's work fails.
            Transactions.skipEmit = false;
            Transactions.skipReproxy = false;
        }
    }

    /**
     * Run a synchronous transaction that will not cause {@link Retree.on} listeners for changed nodes to emit multiple times.
     * @remarks
     * If multiple nodes changed during the transaction, {@link Retree.on} events will be emitted for each node that changed.
     * If using React, this should still be flattened to a single render, but it is not guaranteed.
     * It may be reasonable to combine this with `React.startTransition` if this is a concern.
     *
     * @param transaction transaction function to run
     * 
     * @example
     ```ts
     const counter = Retree.root({ count: 0 });
     Retree.on(counter, "nodeChanged", () => console.log(counter.count));
     // Will only emit "nodeChanged" once
     Retree.runTransaction(() => {
        counter.count = counter.count + 1;
        counter.count = counter.count * 2;
     });
     ```
     */
    static runTransaction(transaction: () => void) {
        if (Transactions.runningTransaction) {
            transaction();
            return;
        }

        Transactions.runningTransaction = true;
        try {
            transaction();
        } finally {
            try {
                // Node changes made during the transaction will emit up to one nodeChanged, treeChanged, and/or nodeRemoved listener.
                Transactions.runPendingTransactions();
            } finally {
                // Listener callbacks run during the flush can throw; never leave future updates stuck in transaction mode.
                Transactions.runningTransaction = false;
            }
        }
    }

    /**
     * Clear all listeners for a given node.
     * @remarks
     * Equivalent to calling each `unsubscribe` function returned by {@link Retree.on}.
     *
     * Prefer storing and calling the unsubscribe returned from
     * {@link Retree.on} when you own a single subscription. Use
     * `clearListeners` when you own every listener for a node, such as during
     * teardown of a Retree-managed integration.
     *
     * @param node node to clear all listeners for
     * @param shallow when false, will unsubscribe to all child nodes as well.
     *
     * @example
     * ```ts
     * const root = Retree.root({ child: { count: 0 } });
     * Retree.on(root, "nodeChanged", () => {});
     * Retree.on(root.child, "nodeChanged", () => {});
     *
     * Retree.clearListeners(root, false); // clears root and child listeners
     * ```
     */
    public static clearListeners(node: TreeNode, shallow: boolean = true) {
        const rawNode = getUnproxiedNode(node);
        if (!rawNode) {
            // @retree-throws
            throw new Error(
                "Retree.clearListeners: expected a Retree-managed node but received an unproxied value. This is expected when clearing listeners for a plain object. Fix: pass the same Retree.root(...) result or Retree child proxy that was used with Retree.on(...), or call the unsubscribe function returned by Retree.on(...)."
            );
        }
        const shouldStopReactiveNode =
            node instanceof ReactiveNode &&
            this.hasReactiveChangedListeners(rawNode);
        this.nodeChangedListeners.delete(rawNode);
        this.nodeRemovedListeners.delete(rawNode);
        this.treeChangedListeners.delete(rawNode);
        if (shouldStopReactiveNode) {
            this.stopReactiveNode(node, rawNode);
            ReactiveNode[RUN_UNOBSERVED_EFFECT_SYMBOL](node);
        }
        if (
            this.treeChangedListeners.size === 0 &&
            this.nodeChangedListeners.size === 0 &&
            this.nodeRemovedListeners.size === 0
        ) {
            this.stopListening();
        }
        if (shallow) return;
        Object.values(node).forEach((child) => {
            if (child === null || typeof child !== "object") {
                return;
            }

            this.clearListeners(child);
        });
    }

    private static buildUnsubscribeCallback(
        unproxiedNode: TreeNode,
        proxiedNode: TreeNode,
        callback: TRetreeListeners,
        relevantListenerMap: Map<TreeNode, TNodeChangedListener[]>
    ) {
        const unsubscribe = () => {
            const _listeners = relevantListenerMap.get(unproxiedNode);
            if (_listeners) {
                const findIndex = _listeners.findIndex((l) => l === callback);
                _listeners.splice(findIndex, 1);
                if (_listeners.length === 0) {
                    relevantListenerMap.delete(unproxiedNode);
                }
            }
            const isReactiveChangeListenerMap =
                relevantListenerMap === this.nodeChangedListeners ||
                relevantListenerMap === this.treeChangedListeners;
            if (
                proxiedNode instanceof ReactiveNode &&
                isReactiveChangeListenerMap &&
                (_listeners === undefined || _listeners.length === 0)
            ) {
                // Check if listening to this node from other reactive listener type.
                const otherListeners =
                    relevantListenerMap === this.nodeChangedListeners
                        ? this.treeChangedListeners.get(unproxiedNode)
                        : this.nodeChangedListeners.get(unproxiedNode);
                if (
                    otherListeners === undefined ||
                    otherListeners.length === 0
                ) {
                    // Stop listening to reactive dependencies
                    this.stopReactiveNode(proxiedNode, unproxiedNode);
                    ReactiveNode[RUN_UNOBSERVED_EFFECT_SYMBOL](proxiedNode);
                }
            }
            if (
                this.treeChangedListeners.size === 0 &&
                this.nodeChangedListeners.size === 0 &&
                this.nodeRemovedListeners.size === 0
            ) {
                this.stopListening();
            }
        };
        return unsubscribe.bind(this);
    }

    private static hasReactiveChangedListeners(unproxiedNode: TreeNode) {
        const nodeChangedListeners =
            this.nodeChangedListeners.get(unproxiedNode) ?? [];
        const treeChangedListeners =
            this.treeChangedListeners.get(unproxiedNode) ?? [];

        return (
            nodeChangedListeners.length > 0 || treeChangedListeners.length > 0
        );
    }

    private static handleNotifyTreeChanged(
        node: TreeNode,
        proxyNode: TCustomProxy<TreeNode>,
        proxyNodeThatChanged: TCustomProxy<TreeNode>,
        topProxyNodeListenedTo: TreeNode | null = null,
        confirmedCallbacksToNotify: Map<
            TreeNode,
            TNodeChangedListener[]
        > = new Map(),
        checkedParentProxyNodes: TCustomProxy<TreeNode>[] = []
    ) {
        const treeChangedListenersToNotify =
            this.treeChangedListeners.get(node);
        // It's important we only reproxy parents if we know we need to.
        // Otherwise it can come with side effects for apps only using "nodeChanged" listeners.
        let confirmedCallbacks: TRetreeListeners[] = [];
        treeChangedListenersToNotify?.forEach((callback) => {
            confirmedCallbacks.push(callback);
        });
        // If we need to notify any parents, set our callbacks so we can call them later.
        // This will allow us to know with confidence we should reproxy parents.
        if (confirmedCallbacks.length > 0) {
            confirmedCallbacksToNotify.set(proxyNode, confirmedCallbacks);
            topProxyNodeListenedTo = proxyNode;
        }
        const parent = this.getParentInternal(proxyNode);
        if (!parent) {
            if (confirmedCallbacksToNotify.size === 0) return;
            // Skip emitting for proxyNodeThatChanged if in skipEmit transaction
            if (!Transactions.skipEmit) {
                // Handle callbacks for the node that originally changed
                const handleEmitTreeChanged = () => {
                    confirmedCallbacksToNotify
                        .get(proxyNodeThatChanged)
                        ?.forEach((c) =>
                            c(getReproxyNode(proxyNodeThatChanged))
                        );
                };
                // If running a transaction, schedule this to emit later.
                // That way if this same node gets changed later, we can only emit once for that node.
                if (Transactions.runningTransaction) {
                    const unproxiedNode =
                        getUnproxiedNode(proxyNodeThatChanged);
                    if (!unproxiedNode) {
                        // @retree-throws
                        throw new Error(
                            "Retree internal invariant failed in handleNotifyTreeChanged: could not find the raw node for proxyNodeThatChanged while scheduling a treeChanged event. This is unexpected and likely a Retree bug. Please file an issue with the mutation that triggered this and whether it happened inside Retree.runTransaction(...)."
                        );
                    }
                    Transactions.upsertPendingTransaction(unproxiedNode, {
                        emitTreeChanged: handleEmitTreeChanged,
                    });
                } else {
                    // Emit immediately
                    handleEmitTreeChanged();
                }
            }
            // If our "treeChanged" listener was for the node that changed, skip parents
            if (topProxyNodeListenedTo === proxyNodeThatChanged) return;
            // Reproxy each parent
            for (
                let pIndex = 0;
                pIndex < checkedParentProxyNodes.length;
                pIndex++
            ) {
                const pNode = checkedParentProxyNodes[pIndex];
                const pReproxyNode = updateReproxyNode(getBaseProxy(pNode));
                // Skip emitting if in skipEmit transaction
                if (!Transactions.skipEmit) {
                    const handlePNodeEmitTreeChanged = () => {
                        confirmedCallbacksToNotify
                            .get(pNode)
                            ?.forEach((c) => c(pReproxyNode));
                    };
                    // If running a transaction, schedule this to emit later.
                    // That way if this same node gets changed later, we can only emit once for that node.
                    if (Transactions.runningTransaction) {
                        const unproxiedPNode = getUnproxiedNode(pNode);
                        if (!unproxiedPNode) {
                            // @retree-throws
                            throw new Error(
                                "Retree internal invariant failed in handleNotifyTreeChanged: could not find the raw node for a parent proxy while scheduling a treeChanged event. This is unexpected and likely a Retree bug. Please file an issue with the mutation that triggered this and whether it happened inside Retree.runTransaction(...)."
                            );
                        }
                        Transactions.upsertPendingTransaction(unproxiedPNode, {
                            emitTreeChanged: handlePNodeEmitTreeChanged,
                        });
                    } else {
                        // Emit immediately
                        handlePNodeEmitTreeChanged();
                    }
                }
                // If this checked pNode was the top-most node the app is listening to, skip reproxying rest of parents
                if (pNode === topProxyNodeListenedTo) return;
            }
            return;
        }
        checkedParentProxyNodes.push(parent.proxyNode);

        this.handleNotifyTreeChanged(
            parent.rawNode,
            parent.proxyNode,
            proxyNodeThatChanged,
            topProxyNodeListenedTo,
            confirmedCallbacksToNotify,
            checkedParentProxyNodes
        );
    }

    private static startListening() {
        const _nodeChangeListener = (
            unproxiedNode: TreeNode,
            proxyNode: TCustomProxy<TreeNode>,
            reproxyNode: TreeNode
        ) => {
            if (
                proxyNode instanceof ReactiveNode &&
                !Transactions.runningTransaction
            ) {
                this.runTransaction(() => {
                    this.handleNodeChanged(
                        unproxiedNode,
                        proxyNode,
                        reproxyNode
                    );
                });
                return;
            }

            this.handleNodeChanged(unproxiedNode, proxyNode, reproxyNode);
        };
        this.nodeChangeListener = _nodeChangeListener.bind(this);
        this.nodeChangeEmitter.on("nodeChanged", this.nodeChangeListener);

        const _nodeRemovedListener = (node: TreeNode) => {
            // If in a skipEmit transaction state, skip emitting
            if (Transactions.skipEmit) return;
            const emitNodeRemovedListeners = () => {
                const listenersToNotify =
                    this.nodeRemovedListeners.get(node) ?? [];
                // We copy the list because it could get changed if the first callback triggers an unsubscribe
                [...listenersToNotify].forEach((callback) => {
                    callback();
                });
            };
            // If running a transaction, schedule this to emit later.
            // That way if this same node gets changed later, we can only emit once for that node.
            if (Transactions.runningTransaction) {
                Transactions.upsertPendingTransaction(node, {
                    emitNodeRemoved: emitNodeRemovedListeners,
                });
            } else {
                // emit immediately
                emitNodeRemovedListeners();
            }
            // TODO: notify all child nodes as well? or maybe add a treeRemoved listener?
        };
        this.nodeRemovedListener = _nodeRemovedListener.bind(this);
        this.nodeChangeEmitter.on("nodeRemoved", this.nodeRemovedListener);
    }

    private static handleNodeChanged(
        unproxiedNode: TreeNode,
        proxyNode: TCustomProxy<TreeNode>,
        reproxyNode: TreeNode
    ) {
        return runWithIsolatedDependencyTracking(() => {
            const isReactiveNode = proxyNode instanceof ReactiveNode;
            if (isReactiveNode) {
                this.handleReactiveNode(proxyNode, unproxiedNode);
            }

            const emitNodeChangedListeners = () => {
                const nodeChangedListnersToNotify =
                    this.nodeChangedListeners.get(unproxiedNode) ?? [];
                // We copy the list because it could get changed if the first callback triggers an unsubscribe
                [...nodeChangedListnersToNotify].forEach((callback) => {
                    callback(reproxyNode);
                });
            };

            const scheduleNodeChangedListeners = () => {
                // If running a transaction, schedule this to emit later.
                // That way if this same node gets changed later, we can only emit once for that node.
                if (Transactions.runningTransaction) {
                    Transactions.upsertPendingTransaction(unproxiedNode, {
                        emitNodeChanged: emitNodeChangedListeners,
                    });
                    return;
                }

                // emit immediately
                emitNodeChangedListeners();
            };

            if (!Transactions.skipEmit) {
                scheduleNodeChangedListeners();
            }

            // Still handle here so we reproxy parents, despite skipping emit later in biz logic.
            // If no treeChanged listeners exist, no parent can observe this work.
            // Note that we should never have gotten this far if skipReproxy is true, so we skip checking again.
            if (this.treeChangedListeners.size > 0) {
                this.handleNotifyTreeChanged(
                    unproxiedNode,
                    proxyNode,
                    proxyNode
                );
            }

            if (isReactiveNode) {
                ReactiveNode[RUN_CHANGED_EFFECT_SYMBOL](proxyNode);
            }
        });
    }

    private static stopListening() {
        if (this.nodeChangeListener) {
            this.nodeChangeEmitter.off("nodeChanged", this.nodeChangeListener);
        }
        if (this.nodeRemovedListener) {
            this.nodeChangeEmitter.off("nodeRemoved", this.nodeRemovedListener);
        }
        this.nodeChangeListener = null;
        this.nodeRemovedListener = null;
        this.nodeRemovedListeners.clear();
        this.nodeChangedListeners.clear();
        this.treeChangedListeners.clear();
    }

    private static getParentInternal(node: TreeNode): {
        propName: string | symbol | null;
        rawNode: TreeNode;
        proxyNode: TCustomProxy<TreeNode>;
    } | null {
        const oldHandler = getCustomProxyHandler(node);
        if (oldHandler) {
            const parent = oldHandler[proxiedParentKey];
            if (!parent || !parent.proxyNode) return null;
            const rawNode = getUnproxiedNode(parent.proxyNode);
            if (!rawNode) {
                // @retree-throws
                throw new Error(
                    "Retree internal invariant failed in Retree.parent: the child has parent metadata, but the parent is not a Retree-managed proxy. This is unexpected and likely a Retree bug. Please file an issue with how the child was assigned, moved, or deleted."
                );
            }
            return {
                propName: parent.propName,
                proxyNode: getBaseProxy(parent.proxyNode),
                rawNode,
            };
        }
        // @retree-throws
        throw new Error(
            "Retree.parent: expected a Retree-managed node but received a value without Retree proxy metadata. This is expected when calling Retree.parent(...) with a plain object, primitive, or object not read from a Retree tree. Fix: pass an object returned by Retree.root(...) or a child read from that tree."
        );
    }

    private static assertRetreeManagedNode(node: TreeNode, apiName: string) {
        if (!getCustomProxyHandler(node)) {
            // @retree-throws
            throw new Error(
                `${apiName}: expected a Retree-managed node but received a value without Retree proxy metadata. This is expected when passing a plain object. Fix: pass an object returned by Retree.root(...) or read a child from an existing Retree tree.`
            );
        }
    }

    private static removeNodeFromParent(
        node: TreeNode,
        parent: TCustomProxy<TreeNode>
    ) {
        if (Array.isArray(parent)) {
            const index = this.findArrayChildIndex(parent, node);
            if (index === -1) {
                // @retree-throws
                throw new Error(
                    "Retree.move: could not find the node in its array parent while removing it. This is unexpected if the node was not manually deleted or reassigned before Retree.move(...) ran. Fix: call Retree.move(node, destination, key) without first mutating the old parent; if that is already true, file a Retree issue with the source and destination."
                );
            }
            parent.splice(index, 1);
            return;
        }

        if (parent instanceof Map) {
            const key = this.findMapChildKey(parent, node);
            if (!key.found) {
                // @retree-throws
                throw new Error(
                    "Retree.move: could not find the node in its Map parent while removing it. This is unexpected if the node was not manually deleted or reassigned before Retree.move(...) ran. Fix: call Retree.move(node, destination, key) without first mutating the old parent; if that is already true, file a Retree issue with the source and destination."
                );
            }
            parent.delete(key.value);
            return;
        }

        if (parent instanceof Set) {
            if (!parent.delete(node)) {
                // @retree-throws
                throw new Error(
                    "Retree.move: could not find the node in its Set parent while removing it. This is unexpected if the node was not manually deleted or reassigned before Retree.move(...) ran. Fix: call Retree.move(node, destination) without first mutating the old parent; if that is already true, file a Retree issue with the source and destination."
                );
            }
            return;
        }

        const parentInfo = this.getParentInternal(node);
        if (!parentInfo || parentInfo.propName === null) {
            // @retree-throws
            throw new Error(
                "Retree.move: could not determine the object property that currently owns this node. This is unexpected for object parents and can happen if parent metadata was detached before the move. Fix: call Retree.move(...) before manually deleting/reassigning the old property; if that is already true, file a Retree issue with the source and destination."
            );
        }
        if (!this.isSameTreeNode((parent as any)[parentInfo.propName], node)) {
            // @retree-throws
            throw new Error(
                `Retree.move: parent property ${String(
                    parentInfo.propName
                )} no longer points to the node being moved. This is unexpected if the old parent was not manually mutated before Retree.move(...) ran. Fix: call Retree.move(...) before deleting or overwriting the old property; if that is already true, file a Retree issue with the source and destination.`
            );
        }
        delete (parent as any)[parentInfo.propName];
    }

    private static insertNodeIntoDestination(
        node: TreeNode,
        destination: TreeNode,
        key: unknown
    ) {
        if (Array.isArray(destination)) {
            if (key === undefined) {
                destination.push(node);
                return;
            }
            if (typeof key !== "number") {
                // @retree-throws
                throw new Error(
                    "Retree.move: array destinations require a numeric key, or no key to append. This is a caller argument error that TypeScript should usually catch. Fix: pass a number index, or omit the key to append to the array."
                );
            }
            destination.splice(key, 0, node);
            return;
        }

        if (destination instanceof Map) {
            if (key === undefined) {
                // @retree-throws
                throw new Error(
                    "Retree.move: Map destinations require a key. This is a caller argument error that TypeScript should usually catch. Fix: pass the Map key as the third argument."
                );
            }
            destination.set(key, node);
            return;
        }

        if (destination instanceof Set) {
            destination.add(node);
            return;
        }

        if (typeof key !== "string" && typeof key !== "symbol") {
            // @retree-throws
            throw new Error(
                "Retree.move: object destinations require a string or symbol key. This is a caller argument error that TypeScript should usually catch. Fix: pass the destination property name as the third argument."
            );
        }
        (destination as any)[key] = node;
    }

    private static findArrayChildIndex(parent: TreeNode[], node: TreeNode) {
        for (let index = 0; index < parent.length; index++) {
            if (this.isSameTreeNode(parent[index], node)) {
                return index;
            }
        }
        return -1;
    }

    private static findMapChildKey(
        parent: Map<unknown, unknown>,
        node: TreeNode
    ): { found: true; value: unknown } | { found: false } {
        for (const [key, value] of parent.entries()) {
            if (this.isSameTreeNode(value, node)) {
                return { found: true, value: key };
            }
        }
        return { found: false };
    }

    private static isSameTreeNode(value: unknown, node: TreeNode) {
        if (value !== null && typeof value === "object") {
            return getUnproxiedNode(value) === getUnproxiedNode(node);
        }
        return false;
    }

    private static cloneValue(
        value: unknown,
        seen: WeakMap<object, object>
    ): unknown {
        if (value === null || typeof value !== "object") {
            return value;
        }

        const rawValue = getUnproxiedNode(value);
        if (!rawValue) {
            // @retree-throws
            throw new Error(
                "Retree.clone: expected object values to be cloneable Retree nodes while walking the source tree. This is unexpected if the source came from Retree.root(...) and was only mutated through Retree-managed proxies. Fix: avoid storing raw unmanaged objects inside managed nodes except in @ignore fields; if the value is managed, file a Retree issue with the value shape."
            );
        }
        if (seen.has(rawValue)) {
            return seen.get(rawValue);
        }

        if (rawValue instanceof Date) {
            const clonedDate = new Date(rawValue.getTime());
            seen.set(rawValue, clonedDate);
            return clonedDate;
        }

        if (rawValue instanceof Map) {
            const clonedMap = new Map();
            seen.set(rawValue, clonedMap);
            for (const [mapKey, mapValue] of rawValue.entries()) {
                clonedMap.set(mapKey, this.cloneValue(mapValue, seen));
            }
            return clonedMap;
        }

        if (rawValue instanceof Set) {
            const clonedSet = new Set();
            seen.set(rawValue, clonedSet);
            for (const setValue of rawValue.values()) {
                clonedSet.add(this.cloneValue(setValue, seen));
            }
            return clonedSet;
        }

        if (Array.isArray(rawValue)) {
            const clonedArray: unknown[] = [];
            seen.set(rawValue, clonedArray);
            rawValue.forEach((item, index) => {
                clonedArray[index] = this.cloneValue(item, seen);
            });
            return clonedArray;
        }

        const clonedObject = Object.create(Object.getPrototypeOf(rawValue));
        seen.set(rawValue, clonedObject);
        for (const key of Reflect.ownKeys(rawValue)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(rawValue, key);
            if (!descriptor) {
                continue;
            }
            if ("value" in descriptor) {
                Reflect.defineProperty(clonedObject, key, {
                    ...descriptor,
                    value: this.cloneValue(descriptor.value, seen),
                });
                continue;
            }
            Reflect.defineProperty(clonedObject, key, descriptor);
        }
        return clonedObject;
    }

    private static handleReactiveNode(
        proxiedDependentNode: ReactiveNode,
        unproxiedDependentNode: TreeNode
    ) {
        const currentDependencies =
            this.getReactiveNodeDependencies(proxiedDependentNode);
        const previousDependencies = getReactiveDependencies(
            unproxiedDependentNode
        );
        if (currentDependencies.length === 0) {
            if (previousDependencies !== undefined) {
                this.unsubscribeReactiveDependencies(
                    previousDependencies,
                    unproxiedDependentNode
                );
                deleteReactiveDependencies(unproxiedDependentNode);
            }
            return;
        }
        const previousDependenciesByKey = new Map(
            previousDependencies?.map((dependency) => [
                dependency.key,
                dependency,
            ]) ?? []
        );
        const newActiveDependencies: IActiveReactiveDependency[] = [];
        for (
            let depIndex = 0;
            depIndex < currentDependencies.length;
            depIndex++
        ) {
            const currentDependency = currentDependencies[depIndex];
            const previousDependency = previousDependenciesByKey.get(
                currentDependency.key
            );
            const newDependencyNode = currentDependency.node;
            let unsubscribe: (() => void) | undefined;
            const previousUnproxiedDependencyNode =
                previousDependency?.unproxiedNode;
            let currentUnproxiedDependencyNode: TreeNode | undefined;

            if (
                previousDependency?.node !== undefined &&
                previousDependency.node !== null &&
                previousUnproxiedDependencyNode === undefined
            ) {
                // @retree-throws
                throw new Error(
                    "Retree internal invariant failed: a previous ReactiveNode dependency had a node but no cached raw node. This is unexpected and likely a Retree bug. Please file an issue with the ReactiveNode.dependencies implementation and the mutation that triggered this."
                );
            }
            if (
                previousDependency !== undefined &&
                previousDependency.node === newDependencyNode
            ) {
                currentUnproxiedDependencyNode =
                    previousDependency.unproxiedNode;
            } else if (newDependencyNode) {
                const unproxiedDependencyNode =
                    getUnproxiedNode(newDependencyNode);
                if (!unproxiedDependencyNode) {
                    // @retree-throws
                    throw new Error(
                        "ReactiveNode.dependencies returned an object that is not Retree-managed. This is expected when a dependency points at a plain object. Fix: return null/undefined for inactive dependencies, or return a node created by Retree.root(...) or read from an existing Retree tree."
                    );
                }
                currentUnproxiedDependencyNode = unproxiedDependencyNode;
            }

            if (
                previousUnproxiedDependencyNode !== undefined &&
                previousUnproxiedDependencyNode ===
                    currentUnproxiedDependencyNode
            ) {
                setReactiveDependents(previousUnproxiedDependencyNode, {
                    reactiveNode: proxiedDependentNode,
                    unproxiedReactiveNode: unproxiedDependentNode,
                    comparisons: currentDependency.comparisons,
                    key: currentDependency.key,
                    selectGetterName: currentDependency.selectGetterName,
                    selectValue: currentDependency.selectValue,
                    compareSelectValueBeforeNotify:
                        currentDependency.compareSelectValueBeforeNotify,
                });
                unsubscribe = previousDependency?.unsubscribeListener;
            } else {
                previousDependency?.unsubscribeListener?.();
                if (previousUnproxiedDependencyNode !== undefined) {
                    deleteReactiveDependent(
                        previousUnproxiedDependencyNode,
                        unproxiedDependentNode,
                        currentDependency.key
                    );
                }
                if (currentUnproxiedDependencyNode !== undefined) {
                    setReactiveDependents(currentUnproxiedDependencyNode, {
                        reactiveNode: proxiedDependentNode,
                        unproxiedReactiveNode: unproxiedDependentNode,
                        comparisons: currentDependency.comparisons,
                        key: currentDependency.key,
                        selectGetterName: currentDependency.selectGetterName,
                        selectValue: currentDependency.selectValue,
                        compareSelectValueBeforeNotify:
                            currentDependency.compareSelectValueBeforeNotify,
                    });
                    if (newDependencyNode) {
                        unsubscribe = retainReactiveDependencySubscription(
                            currentUnproxiedDependencyNode,
                            () =>
                                this.on(
                                    newDependencyNode,
                                    // TODO: figure out if I should support treeChanged for this...seems expensive
                                    "nodeChanged",
                                    this.reactiveDependentNodeChangedListener
                                )
                        );
                    }
                }
            }

            newActiveDependencies.push({
                key: currentDependency.key,
                node: currentDependency.node,
                comparisons: currentDependency.comparisons,
                selectGetterName: currentDependency.selectGetterName,
                selectValue: currentDependency.selectValue,
                compareSelectValueBeforeNotify:
                    currentDependency.compareSelectValueBeforeNotify,
                unsubscribeListener: unsubscribe,
                unproxiedNode: currentUnproxiedDependencyNode,
            });
        }
        for (const previousDependency of previousDependencies ?? []) {
            if (
                !currentDependencies.some(
                    (dependency) => dependency.key === previousDependency.key
                )
            ) {
                previousDependency.unsubscribeListener?.();
                const previousUnproxiedDependencyNode =
                    previousDependency.unproxiedNode;
                if (previousUnproxiedDependencyNode !== undefined) {
                    deleteReactiveDependent(
                        previousUnproxiedDependencyNode,
                        unproxiedDependentNode,
                        previousDependency.key
                    );
                }
            }
        }
        // Set reactive dependencies
        setReactiveDependencies(unproxiedDependentNode, newActiveDependencies);
    }

    private static getReactiveSelectDependencies(
        proxiedDependentNode: ReactiveNode
    ): IActiveReactiveDependency[] {
        const selectGetters = proxiedDependentNode[SELECT_GETTERS_SYMBOL];
        const dependencies: IActiveReactiveDependency[] = [];
        const unproxiedDependentNode = getUnproxiedNode(proxiedDependentNode);
        for (const [getterName, selectGetter] of selectGetters.entries()) {
            const selected = selectGetter.getDependencies(proxiedDependentNode);
            const selectedValue = selectGetter.getValue(proxiedDependentNode);
            const selectedDependencies = normalizeSelectDependencies(selected);
            if (selectedDependencies.length === 0) {
                continue;
            }
            for (
                let dependencyIndex = 0;
                dependencyIndex < selectedDependencies.length;
                dependencyIndex++
            ) {
                const selectedDependency =
                    selectedDependencies[dependencyIndex];
                const key = `select:${String(getterName)}:${dependencyIndex}`;
                const normalizedDependency =
                    this.normalizeReactiveNodeDependency(
                        selectedDependency,
                        key
                    );
                if (
                    normalizedDependency.node !== undefined &&
                    normalizedDependency.node !== null &&
                    getUnproxiedNode(normalizedDependency.node) ===
                        unproxiedDependentNode
                ) {
                    continue;
                }
                const laterComparisons = getDependencyComparisonValues(
                    selectedDependencies.slice(dependencyIndex + 1)
                );
                dependencies.push({
                    key,
                    node: normalizedDependency.node,
                    comparisons:
                        normalizeDependencyEntry(selectedDependency).explicit ||
                        laterComparisons.length === 0
                            ? normalizedDependency.comparisons
                            : laterComparisons,
                    selectGetterName: getterName,
                    selectValue: selectedValue,
                    compareSelectValueBeforeNotify:
                        selectGetter.compareValueBeforeNotify,
                    unsubscribeListener: undefined,
                    unproxiedNode: undefined,
                });
            }
        }
        return dependencies;
    }

    private static getReactiveNodeDependencies(
        proxiedDependentNode: ReactiveNode
    ) {
        return this.runWithoutEmitting(() => [
            ...proxiedDependentNode.dependencies.map((dependency, index) =>
                this.normalizeReactiveNodeDependency(
                    dependency,
                    `dependencies:${index}`
                )
            ),
            ...this.getReactiveSelectDependencies(proxiedDependentNode),
        ]);
    }

    private static runWithoutEmitting<T>(callback: () => T): T {
        const previousSkipEmit = Transactions.skipEmit;
        const previousSkipReproxy = Transactions.skipReproxy;
        Transactions.skipEmit = true;
        Transactions.skipReproxy = true;
        try {
            return callback();
        } finally {
            Transactions.skipEmit = previousSkipEmit;
            Transactions.skipReproxy = previousSkipReproxy;
        }
    }

    private static normalizeReactiveNodeDependency(
        dependency: unknown,
        key: string
    ): IActiveReactiveDependency {
        const normalizedDependency = normalizeDependencyEntry(dependency);
        return {
            key,
            node: normalizedDependency.node,
            comparisons: normalizedDependency.comparisons,
            unsubscribeListener: undefined,
            unproxiedNode: undefined,
        };
    }

    private static unsubscribeReactiveDependencies(
        dependencies: IActiveReactiveDependency[],
        unproxiedNode: TreeNode
    ) {
        for (const dependency of dependencies) {
            dependency.unsubscribeListener?.();
            const unproxiedDependencyNode = dependency.unproxiedNode;
            if (unproxiedDependencyNode !== undefined) {
                deleteReactiveDependent(
                    unproxiedDependencyNode,
                    unproxiedNode,
                    dependency.key
                );
            }
        }
    }

    private static stopReactiveNode(
        proxiedNode: ReactiveNode,
        unproxiedNode: TreeNode
    ) {
        const previous = getReactiveDependencies(unproxiedNode);
        if (!previous) {
            deleteReactiveDependencies(unproxiedNode);
            return;
        }

        for (let depIndex = 0; depIndex < previous.length; depIndex++) {
            const depPrevious = previous[depIndex];
            depPrevious?.unsubscribeListener?.();
            const prevUnproxiedDependentNode = depPrevious?.unproxiedNode;
            if (prevUnproxiedDependentNode !== undefined) {
                deleteReactiveDependent(
                    prevUnproxiedDependentNode,
                    unproxiedNode,
                    depPrevious.key
                );
            }
        }
        // Delete reactive dependencies
        deleteReactiveDependencies(unproxiedNode);
    }

    /**
     * Handler for when a dependent node changed for a reactive node
     * @param reproxy the reproxied node that changed
     */
    private static handleReactiveDependentNodeChanged(reproxy: TreeNode) {
        // I could get unproxied node from scope...tradeoff between memory and runtime hit
        // It's cheap to get unproxied node, so doing that for now
        const _unproxy = getUnproxiedNode(reproxy);
        if (!_unproxy) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed: a ReactiveNode dependency change arrived with an unproxied node. This is unexpected and likely a Retree bug. Please file an issue with the dependency node and mutation that triggered this."
            );
        }
        const dependents = getReactiveDependents(_unproxy);
        if (!dependents) {
            return;
        }
        const groupedDependents = this.groupReactiveDependents(dependents);
        groupedDependents.forEach((group) => {
            if (
                !group.dependents.some((dependent) =>
                    this.shouldNotifyReactiveDependent(dependent, _unproxy)
                )
            ) {
                return;
            }
            // Reproxy node and emit listener
            const dependentBaseProxy = getBaseProxy(group.reactiveNode);
            const dependentUnproxied =
                getUnproxiedNodeFromProxy(dependentBaseProxy);
            const dependentReproxy = Transactions.skipReproxy
                ? getReproxyNodeForUnproxiedNode(dependentUnproxied)
                : updateReproxyNode(dependentBaseProxy);
            if (!dependentReproxy) {
                // @retree-throws
                throw new Error(
                    "Retree internal invariant failed: unexpectedly found no reproxy value for a dependent ReactiveNode. This is unexpected and likely a Retree bug. Please file an issue with the ReactiveNode.dependencies implementation and whether the mutation happened inside Retree.runSilent(...)."
                );
            }
            this.nodeChangeListener?.(
                dependentUnproxied,
                dependentBaseProxy,
                dependentReproxy
            );
        });
    }

    private static groupReactiveDependents(
        dependents: IPreviousReactiveDependent[]
    ) {
        const groups = new Map<
            TreeNode,
            {
                reactiveNode: ReactiveNode;
                dependents: IPreviousReactiveDependent[];
            }
        >();
        for (const dependent of dependents) {
            const group = groups.get(dependent.unproxiedReactiveNode);
            if (group !== undefined) {
                group.reactiveNode = dependent.reactiveNode;
                group.dependents.push(dependent);
                continue;
            }
            groups.set(dependent.unproxiedReactiveNode, {
                reactiveNode: dependent.reactiveNode,
                dependents: [dependent],
            });
        }
        return Array.from(groups.values());
    }

    private static shouldNotifyReactiveDependent(
        dependent: IPreviousReactiveDependent,
        changedUnproxiedNode: TreeNode
    ) {
        const selectValueChanged =
            this.hasReactiveSelectValueChanged(dependent);
        if (selectValueChanged !== undefined) {
            return selectValueChanged;
        }
        const previousComparisons = dependent.comparisons;
        if (previousComparisons === undefined) {
            return true;
        }
        const latest = this.getReactiveNodeDependencies(
            dependent.reactiveNode
        ).find((dependency) => dependency.key === dependent.key);
        if (latest === undefined) {
            return true;
        }
        if (latest.node !== undefined && latest.node !== null) {
            if (getUnproxiedNode(latest.node) !== changedUnproxiedNode) {
                return true;
            }
        }
        const latestComparisons = latest.comparisons;
        if (latestComparisons === undefined) {
            return true;
        }
        if (latestComparisons.length !== previousComparisons.length) {
            return true;
        }
        for (let i = 0; i < latestComparisons.length; i++) {
            if (
                !areDependencyValuesEqual(
                    previousComparisons[i],
                    latestComparisons[i]
                )
            ) {
                return true;
            }
        }
        return false;
    }

    private static hasReactiveSelectValueChanged(
        dependent: IPreviousReactiveDependent
    ): boolean | undefined {
        const selectGetterName = dependent.selectGetterName;
        if (selectGetterName === undefined) {
            return undefined;
        }
        if (!dependent.compareSelectValueBeforeNotify) {
            return undefined;
        }
        const selectGetter =
            dependent.reactiveNode[SELECT_GETTERS_SYMBOL].get(selectGetterName);
        if (selectGetter === undefined) {
            return true;
        }
        return !defaultSelectEquals(
            dependent.selectValue,
            selectGetter.getValue(dependent.reactiveNode)
        );
    }
}
