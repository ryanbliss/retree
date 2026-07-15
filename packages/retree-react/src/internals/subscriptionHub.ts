/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    INodeFieldChanges,
    Retree,
    TRetreeChangedEvents,
    TreeNode,
} from "@retreejs/core";

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
}

const subscriptionHubs: WeakMap<
    TreeNode,
    Map<TRetreeChangedEvents, SubscriptionHubEntry>
> = new WeakMap();

export function subscribeToNode<T extends TreeNode = TreeNode>(
    baseProxy: T,
    listenerType: TRetreeChangedEvents,
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
        const unsubscribeRetree = Retree.on<T>(
            baseProxy,
            listenerType,
            (reproxy, changes) => {
                for (const callback of [...listeners.keys()]) {
                    callback(reproxy, changes);
                }
            }
        );
        hub = {
            listeners,
            unsubscribeRetree,
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
        hub.unsubscribeRetree();
        nodeHubs.delete(listenerType);
        if (nodeHubs.size === 0) {
            subscriptionHubs.delete(baseProxy);
        }
    };
}
