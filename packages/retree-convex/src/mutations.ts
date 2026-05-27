/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    IConvexMutationClient,
    MutationReference,
    RetreeConvexMutation,
} from "./types";

/**
 * Create a typed Retree Convex mutation function from a Convex client and
 * mutation reference.
 *
 * @param client Convex mutation client.
 * @param mutation Convex mutation function reference.
 * @returns A typed mutation function with optional optimistic update support.
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
