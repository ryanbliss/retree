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
 *
 * @remarks
 * Extend this when a Retree app state node should own live Convex query
 * nodes, paginated query nodes, action/mutation helpers, one-off queries, or
 * connection state. Use {@link BaseConvexNode} when you only need imperative
 * actions, mutations, or one-off queries.
 *
 * Query nodes emit through Retree when Convex sends new values. Actions,
 * mutations, and `queryOnce` do not emit unless their results are written into
 * Retree state or paired with an optimistic update.
 *
 * @example
 * ```ts
 * class TasksState extends ConvexNode {
 *     public readonly tasks: ConvexQueryNode<typeof api.tasks.list>;
 *
 *     constructor(client: IConvexClient) {
 *         super(client);
 *         this.tasks = this.query(api.tasks.list);
 *     }
 *
 *     get dependencies() {
 *         return [];
 *     }
 * }
 * ```
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
     * @remarks
     * Use this for live Convex query data that should flow into Retree. The
     * returned {@link ConvexQueryNode} writes `state`, `result`, and `error`,
     * which can emit Retree events and re-render React subscribers.
     *
     * Pass `"skip"` or later call `updateArgs("skip")` when the query should
     * be disabled. Prefer reconcilers for arrays so unchanged child items keep
     * stable identity.
     *
     * @param query Convex query function reference.
     * @param options Query arguments, optional initial state, and optional reconciler.
     * @returns A {@link ConvexQueryNode} subscribed with this node's Convex client.
     *
     * @example
     * ```ts
     * class TasksState extends ConvexNode {
     *     public readonly tasks: ConvexQueryNode<typeof api.tasks.byProject>;
     *
     *     constructor(client: IConvexClient) {
     *         super(client);
     *         this.tasks = this.query(api.tasks.byProject, {
     *             args: { projectId: "p1" },
     *             initialState: [],
     *         });
     *     }
     *
     *     get dependencies() {
     *         return [];
     *     }
     * }
     * ```
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
     * @remarks
     * Use this for live paginated lists. The returned
     * {@link ConvexPaginatedQueryNode} emits through Retree when pages arrive
     * and exposes `loadMore(...)` for requesting additional items.
     *
     * @param query Convex paginated query function reference.
     * @param options Query arguments, initial page size, and optional initial state.
     * @returns A {@link ConvexPaginatedQueryNode} subscribed with this node's Convex client.
     *
     * @example
     * ```ts
     * class MessagesState extends ConvexNode {
     *     public readonly messages: ConvexPaginatedQueryNode<typeof api.messages.list>;
     *
     *     constructor(client: IConvexClient) {
     *         super(client);
     *         this.messages = this.paginatedQuery(api.messages.list, {
     *             args: { channelId: "general" },
     *             initialNumItems: 20,
     *         });
     *     }
     *
     *     get dependencies() {
     *         return [];
     *     }
     * }
     * ```
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
     * @remarks
     * Use this when UI needs to render connection or sync status. Dispose the
     * returned node when its owner is torn down.
     *
     * @returns A {@link ConvexConnectionStateNode} subscribed with this node's Convex client.
     *
     * @example
     * ```ts
     * class AppState extends ConvexNode {
     *     public readonly connection: ConvexConnectionStateNode;
     *
     *     constructor(client: IConvexClient) {
     *         super(client);
     *         this.connection = this.connectionState();
     *     }
     *
     *     get dependencies() {
     *         return [];
     *     }
     * }
     * ```
     */
    protected connectionState(): ConvexConnectionStateNode {
        return new ConvexConnectionStateNode(this.client);
    }
}
