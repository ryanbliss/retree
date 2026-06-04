/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, Retree } from "@retreejs/core";
import type { ConnectionState } from "convex/browser";
import { BaseConvexNode } from "./BaseConvexNode";
import { IConvexClient } from "./types";

/**
 * Reactive node that tracks a Convex client's connection state.
 *
 * @remarks
 * Use this directly or through {@link ConvexNode.connectionState} when UI
 * needs to render sync or connection status. Connection changes update
 * `state`, which emits through Retree while the node is observed.
 *
 * Dispose the node when its owner is torn down.
 *
 * @example
 * ```ts
 * const connection = Retree.root(new ConvexConnectionStateNode(client));
 * Retree.on(connection, "nodeChanged", (next) => {
 *     console.log(next.state.hasInflightRequests);
 * });
 * ```
 */
export class ConvexConnectionStateNode extends BaseConvexNode {
    @ignore
    private unsubscribe: (() => void) | null = null;

    /**
     * Latest Convex connection state.
     */
    public state: ConnectionState;

    /**
     * Create a node for Convex connection state.
     *
     * @remarks
     * The node reads the initial connection state immediately. It subscribes to
     * future connection-state updates when Retree observes it.
     *
     * @param client Convex client used for connection-state reads.
     */
    constructor(client: IConvexClient) {
        super(client);
        this.state = client.connectionState();
    }

    get dependencies() {
        return [];
    }

    protected onObserved(): void {
        if (this.unsubscribe !== null) {
            return;
        }

        this.unsubscribe = this.client.subscribeToConnectionState(
            (connectionState) => {
                Retree.runTransaction(() => {
                    this.state = connectionState;
                });
            }
        );
    }

    protected onUnobserved(): void {
        this.dispose();
    }

    /**
     * Stop listening to Convex connection-state changes.
     *
     * @remarks
     * Call this when the owner of the connection-state node is torn down.
     * Disposing stops future updates; it does not clear the last `state`.
     *
     * @example
     * ```ts
     * public dispose() {
     *     this.connection.dispose();
     * }
     * ```
     */
    public dispose(): void {
        if (this.unsubscribe === null) {
            return;
        }

        this.unsubscribe();
        this.unsubscribe = null;
    }
}
