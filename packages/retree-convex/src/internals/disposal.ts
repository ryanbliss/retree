/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { getUnproxiedNode } from "@retreejs/core/internal";
import { TreeNode } from "@retreejs/core";

type DisposalListener = () => void;

/**
 * Disposal listeners keyed by the raw (unproxied) node so registration and
 * notification agree on identity whether callers hold the raw instance or a
 * Retree proxy. WeakMap keeps disposed transient nodes collectable.
 */
const disposalListenersByNode = new WeakMap<object, Set<DisposalListener>>();

function getDisposalKey(node: object): object {
    return (getUnproxiedNode(node as TreeNode) as object | undefined) ?? node;
}

/**
 * Register a listener that runs when `node`'s `dispose()` is called.
 *
 * @remarks
 * Used by {@link ConvexNode} to drop disposed children from its live-child
 * tracking so the list does not grow (and pin nodes) forever.
 *
 * @returns Function that removes the listener.
 */
export function addNodeDisposalListener(
    node: object,
    listener: DisposalListener
): () => void {
    const key = getDisposalKey(node);
    let listeners = disposalListenersByNode.get(key);
    if (listeners === undefined) {
        listeners = new Set();
        disposalListenersByNode.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Notify every registered disposal listener for `node`.
 */
export function notifyNodeDisposed(node: object): void {
    const listeners = disposalListenersByNode.get(getDisposalKey(node));
    if (listeners === undefined) {
        return;
    }

    for (const listener of [...listeners]) {
        listener();
    }
}
