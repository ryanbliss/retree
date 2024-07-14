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
    setReactiveDependencies,
    setReactiveDependents,
} from "./internals/reactive-node-utils";
import {
    getReproxyNode,
    getReproxyNodeForUnproxiedNode,
    updateReproxyNode,
} from "./internals/reproxy";
import { Transactions } from "./internals/transactions";
import { ReactiveNode } from "./ReactiveNode";
import {
    TRetreeEvents,
    TNodeChangedListener,
    TRetreeListeners,
    TreeNode,
    TRetreeChangedEvents,
} from "./types";

type TInternalNodeChangedListener = (
    node: TreeNode,
    proxyNode: TCustomProxy<TreeNode>,
    reproxiedNode: TreeNode
) => void;

/**
 * Main entry point for use with Retree package.
 * Exposes utility functions for observing to changes to an object and its children.
 */
export class Retree {
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

    /**
     * Builds a Retree compatible node for the root object of your tree.
     * @remarks
     * Use this function only for a root object.
     * This will make the object compatible with {@link Retree.on}, {@link Retree.parent}, etc.
     * For child objects of this root node, simply set values to them like you normally would in JS/TS.
     *
     * @param object a root TreeNode for your tree
     * @returns a Retree compatible object of type T
     * 
     * @example
     const counter = Retree.use({ count: 0 });
     Retree.on(counter, "valueChanged", () => console.log(counter.count));
     counter.count = counter.count + 1;
     */
    static use<T extends TreeNode = TreeNode>(object: T): T {
        return buildProxy<T>(object, this.nodeChangeEmitter);
    }

    /**
     * Listen for changes to a node.
     * @remarks
     * Use listener {@link TRetreeEvents"nodeChanged"} for changes to any leaf child of the node.
     * Use listener {@link TRetreeEvents"treeChanged"} for changes to any leaf child of the node or its child nodes.
     * Use listener {@link TRetreeEvents"nodeRemoved"} for when this node was removed from its parent.
     *
     * @param node the object to listen for changes to.
     * @param listenerType the type of {@link TRetreeEvents} change events to listen to.
     * @param callback the callback function for your listener.
     * @returns an unsubscribe function to cleanup your listners.
     * 
     * @example
     ```ts
     // Create the root node
     const counter = Retree.use({ count: 0 });
     // Listen for changes to values of the node
     const unsubscribe = Retree.on(counter, "valueChanged", (reproxy) => {
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
            throw new Error(
                "Retree.on: must use an object that is a proxied node. Pass object to Retree.use first, or get value from another child object."
            );
        }
        const relevantListenerMap =
            listenerType === "nodeChanged"
                ? this.nodeChangedListeners
                : listenerType === "treeChanged"
                ? this.treeChangedListeners
                : this.nodeRemovedListeners;

        let listeners = relevantListenerMap.get(unproxiedNode);
        if (!listeners) {
            listeners = [callback as TRetreeListeners];
            relevantListenerMap.set(unproxiedNode, listeners);
        } else {
            listeners.push(callback as TRetreeListeners);
        }
        if (
            node instanceof ReactiveNode &&
            (listenerType === "nodeChanged" || listenerType === "treeChanged")
        ) {
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
     * Get a parent node for a given child node, if it exists
     * @param node a child node to get the parent of
     * @returns the parent node if it exists, otherwise null
     * 
     * @example
     ```js
     const tree = Retree.use({
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
     * @param transaction transaction function to run
     * @param skipReproxy skip reproxying nodes such that subsequent comparisons are equal.
     * defaults to true.
     */
    static runSilent(transaction: () => void, skipReproxy = true) {
        Transactions.skipEmit = true;
        Transactions.skipReproxy = skipReproxy;
        transaction();
        Transactions.skipEmit = false;
        Transactions.skipReproxy = false;
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
     const counter = Retree.use({ count: 0 });
     Retree.on(counter, "valueChanged", () => console.log(counter.count));
     // Will only emit "valueChanged" once
     Retree.runTransaction(() => {
        counter.count = counter.count + 1;
        counter.count = counter.count * 2;
     });
     ```
     */
    static runTransaction(transaction: () => void) {
        Transactions.runningTransaction = true;
        transaction();
        // Node changes made during the transaction will emit up to one nodeChanged, treeChanged, and/or nodeRemoved listener.
        Transactions.runPendingTransactions();
        Transactions.runningTransaction = false;
    }

    /**
     * Clear all listeners for a given node.
     * @remarks
     * Equivalent to calling each `unsubscribe` function returned by {@link Retree.on}.
     *
     * @param node node to clear all listeners for
     * @param shallow when false, will unsubscribe to all child nodes as well.
     */
    public static clearListeners(node: TreeNode, shallow: boolean = true) {
        const rawNode = getUnproxiedNode(node);
        if (!rawNode) {
            throw new Error("Cannot clear listeners for an unproxied `node`");
        }
        this.nodeChangedListeners.delete(rawNode);
        this.nodeRemovedListeners.delete(rawNode);
        this.treeChangedListeners.delete(rawNode);
        if (
            this.treeChangedListeners.size === 0 &&
            this.nodeChangedListeners.size === 0 &&
            this.nodeRemovedListeners.size === 0
        ) {
            this.stopListening();
        }
        if (shallow) return;
        Object.values(node).forEach((child) => {
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
            if (
                proxiedNode instanceof ReactiveNode &&
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
                        throw new Error(
                            "Retree.handleNotifyTreeChanged: Unexpected to not find unproxied node for proxyNodeThatChanged"
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
                const pReproxyNode = updateReproxyNode(pNode);
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
                            throw new Error(
                                "Retree.handleNotifyTreeChanged: Unexpected to not find unproxied node for proxyNodeThatChanged"
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
            // If this is a reactive proxy node, update comparisons and listeners
            if (proxyNode instanceof ReactiveNode) {
                this.handleReactiveNode(proxyNode, unproxiedNode);
            }
            // If in a skipEmit transaction state, skip emitting nodeChanged
            if (!Transactions.skipEmit) {
                const emitNodeChangedListeners = () => {
                    const nodeChangedListnersToNotify =
                        this.nodeChangedListeners.get(unproxiedNode) ?? [];
                    // We copy the list because it could get changed if the first callback triggers an unsubscribe
                    [...nodeChangedListnersToNotify].forEach((callback) => {
                        callback(reproxyNode);
                    });
                };
                // If running a transaction, schedule this to emit later.
                // That way if this same node gets changed later, we can only emit once for that node.
                if (Transactions.runningTransaction) {
                    Transactions.upsertPendingTransaction(unproxiedNode, {
                        emitNodeChanged: emitNodeChangedListeners,
                    });
                } else {
                    // emit immediately
                    emitNodeChangedListeners();
                }
            }
            // Still handle here so we reproxy parents, despite skipping emit later in biz logic
            // Note that we should never have gotten this far if skipReproxy is true, so we skip checking again
            this.handleNotifyTreeChanged(unproxiedNode, proxyNode, proxyNode);
        };
        this.nodeChangeListener = _nodeChangeListener.bind(this);
        this.nodeChangeEmitter.on("nodeChanged", this.nodeChangeListener);

        const _nodeRemovedListener = (node: TreeNode) => {
            // If in a skipEmit transaction state, skip emitting
            if (Transactions.skipEmit) return;
            const emitNodeRemovedListeners = () => {
                const listnersToNotify =
                    this.nodeRemovedListeners.get(node) ?? [];
                // We copy the list because it could get changed if the first callback triggers an unsubscribe
                [...listnersToNotify].forEach((callback) => {
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

    private static getParentInternal(
        node: TreeNode
    ): { rawNode: TreeNode; proxyNode: TCustomProxy<TreeNode> } | null {
        const oldHandler = getCustomProxyHandler(node);
        if (oldHandler) {
            const parent = oldHandler[proxiedParentKey];
            if (!parent || !parent.proxyNode) return null;
            const rawNode = getUnproxiedNode(parent.proxyNode);
            if (!rawNode) {
                throw new Error(
                    "Retree.getParentInternal: cannot get parent from an unproxied parent node"
                );
            }
            return {
                proxyNode: getBaseProxy(parent.proxyNode),
                rawNode,
            };
        }
        throw new Error("Node must be a valid TreeNode");
    }

    private static handleReactiveNode(
        proxiedDependentNode: ReactiveNode,
        unproxiedDependentNode: TreeNode
    ) {
        const current = proxiedDependentNode.dependencies;
        const previous = getReactiveDependencies(unproxiedDependentNode);
        if (previous && previous.length !== current.length) {
            throw new Error(
                "ReactiveNode length of dependencies does not equal previous value. Please ensure your dependencies list is consistent in its length and ordering."
            );
        }
        const newActiveDependencies: IActiveReactiveDependency[] = [];
        for (
            let depIndex = 0;
            depIndex < proxiedDependentNode.dependencies.length;
            depIndex++
        ) {
            const depPrevious = previous?.[depIndex];
            depPrevious?.unsubscribeListener?.();
            const currentDependency =
                proxiedDependentNode.dependencies[depIndex];
            const prevDependencyNode = depPrevious?.node;
            const newDependencyNode = currentDependency.node;
            let unsubscribe: (() => void) | undefined;
            if (prevDependencyNode && !newDependencyNode) {
                const prevUnproxiedNode = getUnproxiedNode(prevDependencyNode);
                if (!prevUnproxiedNode) {
                    throw new Error(
                        "Unexpected unproxied node for previous dependent reactive node"
                    );
                }
                deleteReactiveDependent(
                    prevUnproxiedNode,
                    unproxiedDependentNode
                );
            } else if (newDependencyNode) {
                const unproxiedDependencyNode =
                    getUnproxiedNode(newDependencyNode);
                if (!unproxiedDependencyNode) {
                    throw new Error(
                        "Unexpected unproxied node for current dependent reactive node"
                    );
                }
                setReactiveDependents(unproxiedDependencyNode, {
                    reactiveNode: proxiedDependentNode,
                    comparisons: currentDependency.comparisons,
                    index: depIndex,
                });
                unsubscribe = this.on(
                    newDependencyNode,
                    // TODO: figure out if I should support treeChanged for this...seems expensive
                    "nodeChanged",
                    this.handleReactiveDependentNodeChanged.bind(this)
                );
            }
            newActiveDependencies.push({
                node: currentDependency.node,
                comparisons: currentDependency.comparisons,
                unsubscribeListener: unsubscribe,
            });
        }
        // Set reactive dependencies
        setReactiveDependencies(unproxiedDependentNode, newActiveDependencies);
    }

    private static stopReactiveNode(
        proxiedNode: ReactiveNode,
        unproxiedNode: TreeNode
    ) {
        const current = proxiedNode.dependencies;
        const previous = getReactiveDependencies(unproxiedNode);
        if (previous && previous.length !== current.length) {
            throw new Error(
                "ReactiveNode length of dependencies does not equal previous value. Please ensure your dependencies list is consistent in its length and ordering."
            );
        }
        for (
            let depIndex = 0;
            depIndex < proxiedNode.dependencies.length;
            depIndex++
        ) {
            const depPrevious = previous?.[depIndex];
            depPrevious?.unsubscribeListener?.();
            const prevDependentNode = depPrevious?.node;
            if (prevDependentNode) {
                const prevUnproxiedDependentNode =
                    getUnproxiedNode(prevDependentNode);
                if (!prevUnproxiedDependentNode) {
                    throw new Error(
                        "Unexpected unproxied node for previous dependent reactive node"
                    );
                }
                deleteReactiveDependent(
                    prevUnproxiedDependentNode,
                    unproxiedNode
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
            throw new Error(
                "Unexpected unproxied node for current dependent reactive node on nodeChanged"
            );
        }
        const dependents = getReactiveDependents(_unproxy);
        if (!dependents) {
            return;
        }
        dependents.forEach((dependent) => {
            const previousComparisons = dependent.comparisons;
            let shouldNotify = previousComparisons === undefined;
            // If our comparisons exist, we check to see if any changed
            if (!shouldNotify) {
                // Need to get the latest dependency values for our comparison
                const latest =
                    dependent.reactiveNode.dependencies[dependent.index];
                const latestComparisons = latest.comparisons;
                if (
                    latestComparisons === undefined ||
                    !previousComparisons ||
                    latestComparisons.length !== previousComparisons.length
                ) {
                    throw new Error(
                        "Unexpected comparisons value for ReactiveNode. Ensure your comparisons have a consistent length and ordering for each ReactiveNode instance."
                    );
                }
                for (let i = 0; i < latestComparisons.length; i++) {
                    if (latestComparisons[i] !== previousComparisons[i]) {
                        shouldNotify = true;
                        continue;
                    }
                }
            }
            if (!shouldNotify) return;
            // Reproxy node and emit listener
            const dependentBaseProxy = getBaseProxy(dependent.reactiveNode);
            const dependentUnproxied =
                getUnproxiedNodeFromProxy(dependentBaseProxy);
            const dependentReproxy = Transactions.skipReproxy
                ? getReproxyNodeForUnproxiedNode(dependentUnproxied)
                : updateReproxyNode(dependentBaseProxy);
            if (!dependentReproxy) {
                throw new Error(
                    "Unexpectely found no existing reproxy value for dependent node."
                );
            }
            this.nodeChangeListener?.(
                dependentUnproxied,
                dependentBaseProxy,
                dependentReproxy
            );
        });
    }
}
