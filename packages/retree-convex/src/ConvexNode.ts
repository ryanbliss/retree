/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ConvexQueryNode } from "./ConvexQueryNode";
import { BaseConvexNode } from "./internals/BaseConvexNode";
import {
    ConvexQueryNodeOptionsArgs,
    IConvexClient,
    QueryReference,
} from "./types";

/**
 * Base class for Retree nodes that need access to a Convex client.
 */
export abstract class ConvexNode extends BaseConvexNode {
    /**
     * Create a Convex-backed Retree node.
     *
     * @param client Convex client used by this node.
     */
    constructor(client: IConvexClient) {
        super(client);
    }

    /**
     * Create a typed query node bound to this node's Convex client.
     *
     * @param query Convex query function reference.
     * @param options Query arguments, optional initial state, and optional reconciler.
     * @returns A {@link ConvexQueryNode} subscribed with this node's Convex client.
     */
    protected query<Query extends QueryReference>(
        query: Query,
        ...options: ConvexQueryNodeOptionsArgs<Query>
    ): ConvexQueryNode<Query> {
        return new ConvexQueryNode(this.client, query, ...options);
    }
}
