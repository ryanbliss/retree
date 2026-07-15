/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, ReactiveNode } from "@retreejs/core";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
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
 * Base Retree node for classes that own a Convex client.
 *
 * Extend this class when you need typed Convex actions, mutations, and one-off
 * queries but do not need the query-node factories provided by
 * {@link ConvexNode}.
 *
 * @remarks
 * The Convex client is stored in an `@ignore` field, so assigning or using the
 * client does not emit Retree changes. Action, mutation, and one-off query
 * helpers do not emit by themselves; they only cause Retree updates when your
 * code writes their result into Retree state or pairs a mutation with an
 * optimistic query update.
 *
 * @example
 * ```ts
 * class TaskCommands extends BaseConvexNode {
 *     get dependencies() {
 *         return [];
 *     }
 *
 *     public async rename(taskId: Id<"tasks">, text: string) {
 *         const renameTask = this.mutation(api.tasks.rename);
 *         await renameTask({ taskId, text }); // ❌ no Retree emit by itself
 *     }
 * }
 * ```
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
     * @remarks
     * The returned function runs the Convex mutation. It does not update Retree
     * state by itself. Pass `withOptimisticUpdate` when the mutation should
     * immediately update a {@link ConvexQueryNode}; otherwise wait for the
     * subscribed query to emit a server value.
     *
     * @param mutation Convex mutation function reference.
     * @returns A typed mutation function with optional optimistic update support.
     *
     * @example
     * ```ts
     * const toggle = this.mutation(api.tasks.toggleCompleted);
     * return toggle(
     *     { taskId },
     *     {
     *         withOptimisticUpdate: (ctx) => {
     *             this.tasks.optimisticUpdate({
     *                 ctx,
     *                 apply(tasks) {
     *                     const task = tasks.find((item) => item._id === taskId);
     *                     if (task) task.isCompleted = !task.isCompleted;
     *                 },
     *             });
     *         },
     *     }
     * );
     * ```
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
     *
     * @example
     * ```ts
     * const generateSummary = this.action(api.ai.generateSummary);
     * const summary = await generateSummary({ taskId });
     * this.summary = summary; // ✅ this write emits if `summary` is reactive state
     * ```
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
     * state. Use {@link ConvexNode.query} when the value should stay subscribed.
     *
     * @param query Convex query function reference.
     * @param args Query arguments. Optional for no-args queries.
     * @returns Promise for the Convex query result.
     *
     * @example
     * ```ts
     * const task = await this.queryOnce(api.tasks.getById, { taskId });
     * this.selectedTaskPreview = task; // ✅ emits if this field participates in Retree
     * ```
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
