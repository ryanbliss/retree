/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    buildProxy,
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
} from "./internals";
import { TreeChangeEmitter } from "./internals/NodeChangeEmitter";
import { proxiedParentKey } from "./internals/proxy-types";
import { getReproxyNode, updateReproxyNode } from "./internals/reproxy";
import { TransactionStates } from "./internals/transactions";
import {
    TRetreeEvents,
    TNodeChangedListener,
    TRetreeListeners,
    TreeNode,
    TRetreeChangedEvents,
} from "./types";

type TInternalNodeChangedListener = (
    node: TreeNode,
    proxyNode: TreeNode,
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
        const relevantListenerMap =
            listenerType === "nodeChanged"
                ? this.nodeChangedListeners
                : listenerType === "treeChanged"
                ? this.treeChangedListeners
                : this.nodeRemovedListeners;
        const rawNode = getUnproxiedNode(node);
        if (!rawNode) {
            throw new Error(
                "Retree.on: must use an object that is a proxied node. Pass object to Retree.use first, or get value from another child object."
            );
        }
        let listeners = relevantListenerMap.get(rawNode);
        if (!listeners) {
            listeners = [callback as TRetreeListeners];
            relevantListenerMap.set(rawNode, listeners);
        } else {
            listeners.push(callback as TRetreeListeners);
        }
        return this.buildUnsubscribeCallback(
            rawNode,
            callback as TRetreeListeners,
            relevantListenerMap
        );
    }

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
        TransactionStates.skipEmit = true;
        TransactionStates.skipReproxy = skipReproxy;
        transaction();
        TransactionStates.skipEmit = false;
        TransactionStates.skipReproxy = false;
    }

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
        rawNode: TreeNode,
        callback: TRetreeListeners,
        relevantListenerMap: Map<TreeNode, TNodeChangedListener[]>
    ) {
        const unsubscribe = () => {
            const _listeners = relevantListenerMap.get(rawNode);
            if (_listeners) {
                const findIndex = _listeners.findIndex((l) => l === callback);
                _listeners.splice(findIndex, 1);
                if (_listeners.length === 0) {
                    relevantListenerMap.delete(rawNode);
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
        proxyNode: TreeNode,
        proxyNodeThatChanged: TreeNode,
        topProxyNodeListenedTo: TreeNode | null = null,
        confirmedCallbacksToNotify: Map<
            TreeNode,
            TNodeChangedListener[]
        > = new Map(),
        checkedParentProxyNodes: TreeNode[] = []
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
            if (!TransactionStates.skipEmit) {
                // Handle callbacks for the node that originally changed
                confirmedCallbacksToNotify
                    .get(proxyNodeThatChanged)
                    ?.forEach((c) => c(getReproxyNode(proxyNodeThatChanged)));
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
                const callbacks = confirmedCallbacksToNotify.get(pNode);
                const pReproxyNode = updateReproxyNode(pNode);
                // Skip emitting if in skipEmit transaction
                if (!TransactionStates.skipEmit) {
                    callbacks?.forEach((c) => c(pReproxyNode));
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
        this.nodeChangeListener = (
            node: TreeNode,
            proxyNode: TreeNode,
            reproxyNode: TreeNode
        ) => {
            // If in a skipEmit transaction state, skip emitting nodeChanged
            if (!TransactionStates.skipEmit) {
                const nodeChangedListnersToNotify =
                    this.nodeChangedListeners.get(node);
                nodeChangedListnersToNotify?.forEach((callback) => {
                    callback(reproxyNode);
                });
            }
            // Still handle here so we reproxy parents, despite skipping emit later in biz logic
            // Note that we should never have gotten this far if skipReproxy is true, so we skip checking again
            this.handleNotifyTreeChanged(node, proxyNode, proxyNode);
        };
        this.nodeChangeEmitter.on(
            "nodeChanged",
            this.nodeChangeListener.bind(this)
        );

        this.nodeRemovedListener = (node: TreeNode) => {
            // If in a skipEmit transaction state, skip emitting
            if (TransactionStates.skipEmit) return;
            const listnersToNotify = this.nodeRemovedListeners.get(node);
            listnersToNotify?.forEach((callback) => {
                callback();
            });
            // TODO: notify all child nodes as well
        };
        this.nodeChangeEmitter.on(
            "nodeRemoved",
            this.nodeRemovedListener.bind(this)
        );
    }
    private static stopListening() {
        if (this.nodeChangeListener) {
            this.nodeChangeEmitter.off("nodeChanged", this.nodeChangeListener);
        }
        if (this.nodeRemovedListener) {
            this.nodeChangeEmitter.off("nodeRemoved", this.nodeRemovedListener);
        }
        this.nodeRemovedListeners.clear();
        this.nodeChangedListeners.clear();
        this.treeChangedListeners.clear();
    }

    private static getParentInternal(
        node: TreeNode
    ): { rawNode: TreeNode; proxyNode: TreeNode } | null {
        const oldHandler = getCustomProxyHandler(node);
        if (oldHandler) {
            const parent = oldHandler[proxiedParentKey];
            if (!parent) return null;
            const rawNode = getUnproxiedNode(parent);
            if (!rawNode) {
                throw new Error(
                    "Retree.getParentInternal: cannot get parent from an unproxied parent node"
                );
            }
            return {
                proxyNode: getBaseProxy(parent),
                rawNode,
            };
        }
        throw new Error("Node must be a valid TreeNode");
    }
}
