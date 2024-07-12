/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import { IEvent, TypedEventEmitter } from "./TypedEventEmitter";

export interface ITreeChangeEmitterEvents extends IEvent {
    /**
     * Event listener for when a leaf on a node was changed
     * @param event update
     * @param listener listener function
     * @param listener.node the raw unproxied node that was updated
     * @param listener.proxyNode the static proxied node that was updated
     * @param listener.reproxiedNode reproxied node for this change, so that frameworks like React detect changes
     */
    (
        event: "nodeChanged",
        listener: (
            node: TreeNode,
            proxyNode: TreeNode,
            reproxiedNode: TreeNode
        ) => void
    ): void;

    /**
     * Event listener for when a node was removed from the tree
     * @param event update
     * @param listener listener function
     * @param listener.node the raw unproxied node that was removed from the tree
     * @param listener.proxyNode the proxied node that was removed from the tree
     */
    (
        event: "nodeRemoved",
        listener: (node: TreeNode, proxyNode: TreeNode) => void
    ): void;
}

export class TreeChangeEmitter extends TypedEventEmitter<ITreeChangeEmitterEvents> {
    //
}
