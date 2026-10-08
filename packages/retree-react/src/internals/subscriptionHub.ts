/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    INodeFieldChanges,
    ReactiveNode,
    Retree,
    TRetreeChangedEvents,
    TreeNode,
} from "@retreejs/core";
import { SUBSCRIBE_SUBTREE_CHANGED_SYMBOL } from "@retreejs/core/internal";

/**
 * Listener kinds a hook can hold: the public change events plus the internal
 * subtree subscription tracked `useSelect` uses for its read covers, and the
 * observe-only subscription it holds on `ReactiveNode`s read through them.
 */
export type RetreeStoreListenerType =
    | TRetreeChangedEvents
    | "subtreeChanged"
    | "observed";

/**
 * For `nodeChanged`/`treeChanged` the first argument is the node's reproxy;
 * for `subtreeChanged` it is the raw node that emitted.
 */
type HubListener<T extends TreeNode = TreeNode> = (
    node: T,
    changes?: INodeFieldChanges[]
) => void;

interface SubscriptionHubEntry<T extends TreeNode = TreeNode> {
    /**
     * Listener -> subscription count. Ref-counted (rather than a Set) so the
     * same callback subscribed twice survives its first unsubscribe; each
     * listener is still invoked once per notification.
     */
    listeners: Map<HubListener<T>, number>;
    unsubscribeRetree: () => void;
    /** A `ReactiveNode` hub lost its last listener and tears down next microtask. */
    teardownQueued: boolean;
}

const subscriptionHubs: WeakMap<
    TreeNode,
    Map<RetreeStoreListenerType, SubscriptionHubEntry>
> = new WeakMap();

function subscribeRetree<T extends TreeNode>(
    baseProxy: T,
    listenerType: RetreeStoreListenerType,
    notify: (node: T, changes: INodeFieldChanges[]) => void
): () => void {
    if (listenerType === "observed") {
        // Runs the node's observed lifecycle; its cover delivers changes.
        return Retree.on<T>(baseProxy, "nodeChanged", () => undefined);
    }
    if (listenerType === "subtreeChanged") {
        return Retree[SUBSCRIBE_SUBTREE_CHANGED_SYMBOL](
            baseProxy,
            (changedRawNode, changes) => notify(changedRawNode as T, changes)
        );
    }
    return Retree.on<T>(baseProxy, listenerType, notify);
}

export function subscribeToNode<T extends TreeNode = TreeNode>(
    baseProxy: T,
    listenerType: RetreeStoreListenerType,
    listener: HubListener<T>
): () => void {
    let nodeHubs = subscriptionHubs.get(baseProxy);
    if (!nodeHubs) {
        nodeHubs = new Map();
        subscriptionHubs.set(baseProxy, nodeHubs);
    }

    let hub = nodeHubs.get(listenerType) as SubscriptionHubEntry<T> | undefined;
    if (!hub) {
        const listeners = new Map<HubListener<T>, number>();
        const unsubscribeRetree = subscribeRetree<T>(
            baseProxy,
            listenerType,
            (node, changes) => {
                for (const callback of [...listeners.keys()]) {
                    callback(node, changes);
                }
            }
        );
        hub = {
            listeners,
            unsubscribeRetree,
            teardownQueued: false,
        };
        nodeHubs.set(listenerType, hub as SubscriptionHubEntry);
    }

    const currentCount = hub.listeners.get(listener) ?? 0;
    hub.listeners.set(listener, currentCount + 1);

    // Idempotency flag: React cleanup (especially StrictMode) can run twice.
    // Without it, a second call would decrement some other subscription's
    // ref count, or tear down a hub a newer subscription still relies on.
    let unsubscribed = false;
    return () => {
        if (unsubscribed) {
            return;
        }
        unsubscribed = true;
        const count = hub.listeners.get(listener);
        if (count === undefined) {
            return;
        }
        if (count > 1) {
            hub.listeners.set(listener, count - 1);
            return;
        }
        hub.listeners.delete(listener);
        if (hub.listeners.size > 0) {
            return;
        }
        if (!(baseProxy instanceof ReactiveNode)) {
            teardownHub(baseProxy, nodeHubs, listenerType, hub);
            return;
        }
        // React swaps a moved store's subscription by unsubscribing the old
        // one before subscribing the new one in the same commit. Deferring
        // lets a resubscribe adopt this hub, so a node both stores hold keeps
        // its listener instead of re-running `onUnobserved`/`onObserved`.
        if (hub.teardownQueued) {
            return;
        }
        hub.teardownQueued = true;
        queueMicrotask(() => {
            hub.teardownQueued = false;
            if (hub.listeners.size > 0) {
                return;
            }
            teardownHub(baseProxy, nodeHubs, listenerType, hub);
        });
    };
}

function teardownHub<T extends TreeNode>(
    baseProxy: T,
    nodeHubs: Map<RetreeStoreListenerType, SubscriptionHubEntry>,
    listenerType: RetreeStoreListenerType,
    hub: SubscriptionHubEntry<T>
): void {
    hub.unsubscribeRetree();
    nodeHubs.delete(listenerType);
    if (nodeHubs.size === 0) {
        subscriptionHubs.delete(baseProxy);
    }
}
