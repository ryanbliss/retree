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
    listeners: Set<HubListener<T>>;
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
        const listeners = new Set<HubListener<T>>();
        const unsubscribeRetree = Retree.on<T>(
            baseProxy,
            listenerType,
            (reproxy, changes) => {
                for (const callback of [...listeners]) {
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

    hub.listeners.add(listener);

    return () => {
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
