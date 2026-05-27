/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ConvexQueryNode } from "./ConvexQueryNode";
import { ConvexConnectionStateNode } from "./ConvexConnectionStateNode";
import { ConvexPaginatedQueryNode } from "./ConvexPaginatedQueryNode";
import { BaseConvexNode } from "./BaseConvexNode";
import {
    ConvexPaginatedQueryNodeOptionsArgs,
    ConvexQueryNodeOptionsArgs,
    IConvexClient,
    PaginatedQueryReference,
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

    /**
     * Create a typed paginated query node bound to this node's Convex client.
     *
     * @param query Convex paginated query function reference.
     * @param options Query arguments, initial page size, and optional initial state.
     * @returns A {@link ConvexPaginatedQueryNode} subscribed with this node's Convex client.
     */
    protected paginatedQuery<Query extends PaginatedQueryReference>(
        query: Query,
        ...options: ConvexPaginatedQueryNodeOptionsArgs<Query>
    ): ConvexPaginatedQueryNode<Query> {
        return new ConvexPaginatedQueryNode(this.client, query, ...options);
    }

    /**
     * Create a node that tracks this Convex client's connection state.
     *
     * @returns A {@link ConvexConnectionStateNode} subscribed with this node's Convex client.
     */
    protected connectionState(): ConvexConnectionStateNode {
        return new ConvexConnectionStateNode(this.client);
    }
}
