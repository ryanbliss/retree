/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, ReactiveNode } from "@retreejs/core";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { createRetreeConvexAction } from "./actions";
import { createRetreeConvexMutation } from "./mutations";
import {
    ActionReference,
    IConvexClient,
    MutationReference,
    OptionalConvexArgs,
    QueryReference,
    RetreeConvexAction,
    RetreeConvexMutation,
} from "./types";

/**
 * Base Retree node for classes that own a Convex client.
 *
 * Extend this class when you need typed Convex actions, mutations, and one-off
 * queries but do not need the query-node factories provided by
 * {@link ConvexNode}.
 */
export abstract class BaseConvexNode extends ReactiveNode {
    /**
     * Convex client used by this node.
     */
    @ignore
    protected readonly client: IConvexClient;

    /**
     * Create a Convex-backed Retree node.
     *
     * @param client Convex client used by this node.
     */
    constructor(client: IConvexClient) {
        super();
        this.client = client;
    }

    /**
     * Create a typed mutation function bound to this node's Convex client.
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
