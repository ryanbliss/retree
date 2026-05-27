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
     * @param client Convex client used for connection-state reads.
     */
    constructor(client: IConvexClient) {
        super(client);
        this.state = client.connectionState();
    }

    get dependencies() {
        this.memo("subscribeToConnectionState", () => {
            this.dispose();
            this.unsubscribe = this.client.subscribeToConnectionState(
                (connectionState) => {
                    Retree.runTransaction(() => {
                        this.state = connectionState;
                    });
                }
            );
        });
        return [];
    }

    /**
     * Stop listening to Convex connection-state changes.
     */
    public dispose(): void {
        if (this.unsubscribe === null) {
            return;
        }

        this.unsubscribe();
        this.unsubscribe = null;
    }
}
