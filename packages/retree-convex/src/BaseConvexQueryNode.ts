/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore } from "@retreejs/core";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
    IQueryNodeOptions,
    IQuerySubscriptionSource,
    QueryNode,
    QuerySkip,
} from "@retreejs/query";
import { createRetreeConvexAction } from "./actions.js";
import { createRetreeConvexMutation } from "./mutations.js";
import {
    ActionReference,
    IConvexClient,
    MutationReference,
    OptionalConvexArgs,
    QueryReference,
    RetreeConvexAction,
    RetreeConvexMutation,
} from "./types.js";

/**
 * Base class binding a Convex client to the generic `@retreejs/query`
 * {@link QueryNode} machinery.
 *
 * @remarks
 * Provides the same protected Convex helpers as {@link BaseConvexNode}
 * (`mutation`, `action`, `queryOnce`, and the `client` field) on top of the
 * backend-agnostic query state machine. {@link ConvexQueryNode} and
 * {@link ConvexPaginatedQueryNode} extend this class.
 */
export abstract class BaseConvexQueryNode<TArgs, TState> extends QueryNode<
    TArgs,
    TState
> {
    /**
     * Convex client used by this node.
     */
    @ignore
    protected readonly client: IConvexClient;

    /**
     * Create a Convex-backed query node.
     *
     * @param client Convex client used by this node.
     * @param source Subscription source binding the client to the query.
     * @param options Normalized query node options, or `"skip"`.
     */
    constructor(
        client: IConvexClient,
        source: IQuerySubscriptionSource<TArgs, TState>,
        options: IQueryNodeOptions<TArgs, TState> | QuerySkip
    ) {
        super(source, options);
        this.client = client;
    }

    /**
     * Create a typed mutation function bound to this node's Convex client.
     *
     * @remarks
     * The returned function runs the Convex mutation. It does not update Retree
     * state by itself. Pass `withOptimisticUpdate` when the mutation should
     * immediately update a {@link ConvexQueryNode}; otherwise wait for the
     * subscribed query to emit a server value.
     *
     * @param mutation Convex mutation function reference.
     * @returns A typed mutation function with optional optimistic update support.
     */
    protected mutation<Mutation extends MutationReference>(
        mutation: Mutation
    ): RetreeConvexMutation<Mutation> {
        return createRetreeConvexMutation(this.client, mutation);
    }

    /**
     * Create a typed action function bound to this node's Convex client.
     *
     * @remarks
     * Actions are imperative calls. They do not emit Retree changes unless you
     * write their result into a Retree-managed field.
     *
     * @param action Convex action function reference.
     * @returns A typed action function.
     */
    protected action<Action extends ActionReference>(
        action: Action
    ): RetreeConvexAction<Action> {
        return createRetreeConvexAction(this.client, action);
    }

    /**
     * Run a Convex query once without creating a subscription.
     *
     * @remarks
     * Use this for imperative reads. It does not keep data live and does not
     * emit Retree changes unless you assign the returned value into Retree
     * state.
     *
     * @param query Convex query function reference.
     * @param args Query arguments. Optional for no-args queries.
     * @returns Promise for the Convex query result.
     */
    protected queryOnce<Query extends QueryReference>(
        query: Query,
        ...args: OptionalConvexArgs<Query>
    ): Promise<Awaited<FunctionReturnType<Query>>> {
        const queryArgs = this.getOptionalFunctionArgs<Query>(args);
        return this.client.query(query, queryArgs);
    }

    private getOptionalFunctionArgs<FuncRef extends QueryReference>(
        args: OptionalConvexArgs<FuncRef>
    ): FunctionArgs<FuncRef> {
        if (args[0] !== undefined) {
            return args[0];
        }

        return {} as FunctionArgs<FuncRef>;
    }
}
