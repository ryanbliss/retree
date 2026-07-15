/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type { Preloaded } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { jsonToConvex } from "convex/values";
import type { QueryReference } from "@retreejs/convex";

/**
 * `ConvexQueryNode` constructor options derived from a Next.js
 * `preloadQuery` payload.
 */
export interface IPreloadedQueryNodeOptions<Query extends QueryReference> {
    /**
     * Query arguments the server component ran the query with.
     */
    args: FunctionArgs<Query>;
    /**
     * Server-fetched query result, exposed as `state` (with
     * `result.status === "success"`) until the live subscription emits.
     */
    initialState: FunctionReturnType<Query>;
}

/**
 * Derive `ConvexQueryNode` options from a `Preloaded` payload produced by
 * `preloadQuery` from `convex/nextjs`.
 *
 * @remarks
 * This is the Retree equivalent of Convex React's `usePreloadedQuery` for
 * Next.js RSC hydration:
 *
 * 1. **Server component:** run `preloadQuery(api.tasks.list, args)` and pass
 *    the returned payload to a client component as a prop.
 * 2. **Client component:** spread the derived options into a
 *    {@link ConvexQueryNode} (or `this.query(...)` on a `ConvexNode`). The
 *    node renders the server-fetched data immediately — no pending flash —
 *    and seamlessly switches to live values once the websocket subscription
 *    emits.
 *
 * The payload's args become the node's initial args so the live subscription
 * runs the exact query the server preloaded.
 *
 * @param preloaded Payload returned by `preloadQuery` from `convex/nextjs`.
 * @returns Options with `args` and `initialState` for a `ConvexQueryNode`.
 *
 * @example
 * ```ts
 * // app/tasks/page.tsx (server component)
 * const preloaded = await preloadQuery(api.tasks.list, { listId });
 * return <TasksClient preloaded={preloaded} />;
 *
 * // TasksClient.tsx ("use client")
 * const tasks = useNode(
 *     () =>
 *         new ConvexQueryNode(client, api.tasks.list, {
 *             ...preloadedQueryOptions(preloaded),
 *         })
 * );
 * ```
 */
export function preloadedQueryOptions<Query extends QueryReference>(
    preloaded: Preloaded<Query>
): IPreloadedQueryNodeOptions<Query> {
    const args = jsonToConvex(preloaded._argsJSON);
    if (args === null) {
        throw new Error(
            "preloadedQueryOptions: the preloaded payload's _argsJSON decoded to null. Expected the arguments object the server component passed to preloadQuery."
        );
    }
    if (typeof args !== "object") {
        throw new Error(
            `preloadedQueryOptions: the preloaded payload's _argsJSON decoded to a ${typeof args}. Expected the arguments object the server component passed to preloadQuery.`
        );
    }

    const value = jsonToConvex(preloaded._valueJSON);
    return {
        // jsonToConvex returns the untyped Value union; the payload was
        // produced from this exact query's args and result, so these casts
        // restore the type information the wire format erased.
        args: args as FunctionArgs<Query>,
        initialState: value as FunctionReturnType<Query>,
    };
}
