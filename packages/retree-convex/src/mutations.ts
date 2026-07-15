/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    IConvexMutationClient,
    MutationReference,
    RetreeConvexMutation,
} from "./types.js";

/**
 * Create a typed Retree Convex mutation function from a Convex client and
 * mutation reference.
 *
 * @remarks
 * Use this when you need a typed mutation helper outside a
 * {@link BaseConvexNode}. Mutations are imperative calls and do not emit
 * Retree changes by themselves. Pair with `withOptimisticUpdate` to update a
 * query node immediately, or wait for a subscribed query to emit the server
 * value.
 *
 * @param client Convex mutation client.
 * @param mutation Convex mutation function reference.
 * @returns A typed mutation function with optional optimistic update support.
 *
 * @example
 * ```ts
 * const toggleCompleted = createRetreeConvexMutation(
 *     client,
 *     api.tasks.toggleCompleted
 * );
 *
 * await toggleCompleted(
 *     { taskId },
 *     {
 *         withOptimisticUpdate: (ctx) => {
 *             tasks.optimisticUpdate({
 *                 ctx,
 *                 apply(items) {
 *                     const task = items.find((item) => item._id === taskId);
 *                     if (task) task.isCompleted = !task.isCompleted;
 *                 },
 *             });
 *         },
 *     }
 * );
 * ```
 */
export function createRetreeConvexMutation<Mutation extends MutationReference>(
    client: IConvexMutationClient,
    mutation: Mutation
): RetreeConvexMutation<Mutation> {
    return (args, options) => {
        const promise = client.mutation(mutation, args);
        options?.withOptimisticUpdate?.({
            args,
            promise,
        });
        return promise;
    };
}
