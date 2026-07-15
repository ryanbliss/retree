/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { INodeFieldChanges, TreeNode } from "../types.js";
import {
    getRetreeRootName,
    notifyRetreeDebugTaps,
    retreeDebugTapCount,
} from "./debug-tap.js";
import {
    getCustomProxyHandlerFromMetadata,
    proxiedParentKey,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";
import { Transactions } from "./transactions.js";
import { IEvent, TypedEventEmitter } from "./TypedEventEmitter.js";

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
            reproxiedNode: TreeNode,
            changes: INodeFieldChanges[]
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

/**
 * Resolve the registered root name for an emission by walking the changed
 * proxy's live parent metadata to the top of its tree. Only runs when at
 * least one debug tap is registered, so ordinary emissions never pay the
 * O(depth) walk.
 */
function resolveRootNameForProxy(proxyNode: TreeNode): string | undefined {
    let handler = getCustomProxyHandlerFromMetadata(proxyNode);
    let topRawNode: TreeNode | undefined;
    while (handler !== undefined) {
        topRawNode = handler[unproxiedBaseNodeKey];
        const parentProxyNode = handler[proxiedParentKey]?.proxyNode;
        if (!parentProxyNode) {
            break;
        }
        handler = getCustomProxyHandlerFromMetadata(parentProxyNode);
    }
    if (topRawNode === undefined) {
        return undefined;
    }
    return getRetreeRootName(topRawNode);
}

export class TreeChangeEmitter extends TypedEventEmitter<ITreeChangeEmitterEvents> {
    /**
     * Every Retree emission funnels through here; the single numeric check
     * keeps the zero-tap path free of any debug-tap overhead.
     */
    public emit(event: string, ...args: any[]): boolean {
        if (retreeDebugTapCount > 0) {
            this.notifyDebugTaps(event, args);
        }
        return super.emit(event, ...args);
    }

    private notifyDebugTaps(event: string, args: readonly unknown[]): void {
        if (event === "nodeChanged") {
            const node = args[0] as TreeNode;
            const proxyNode = args[1] as TreeNode;
            const changes = args[3] as INodeFieldChanges[];
            notifyRetreeDebugTaps({
                kind: "nodeChanged",
                node,
                rootName: resolveRootNameForProxy(proxyNode),
                changes,
                silent: Transactions.skipEmit,
            });
            return;
        }
        if (event === "nodeRemoved") {
            const node = args[0] as TreeNode;
            const proxyNode = args[1] as TreeNode;
            notifyRetreeDebugTaps({
                kind: "nodeRemoved",
                node,
                rootName: resolveRootNameForProxy(proxyNode),
                silent: Transactions.skipEmit,
            });
        }
    }
}
