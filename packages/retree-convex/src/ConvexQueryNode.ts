/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { IQueryNodeOptions, IQuerySubscriptionSource } from "@retreejs/query";
import { BaseConvexQueryNode } from "./BaseConvexQueryNode.js";
import { notifyNodeDisposed } from "./internals/disposal.js";
import { tryReconcileConvexDocuments } from "./internals/reconcile.js";
import {
    ConvexQueryNodeOptionsArgs,
    ConvexQueryArgs,
    ConvexQueryNodeResult,
    ConvexQueryNodeState,
    ConvexQuerySkip,
    IConvexClient,
    IConvexQueryClient,
    IConvexQueryNodeOptions,
    IOptimisticTransform,
    MutationReference,
    QueryReference,
} from "./types.js";

/**
 * Reactive query node that subscribes to a Convex query and writes emitted
 * values into Retree state.
 *
 * @remarks
 * Use this directly or through {@link ConvexNode.query} when query results
 * should be live Retree state. Convex emissions update `state`, `result`, and
 * `error`, which can emit `nodeChanged` and re-render React subscribers.
 *
 * This class is a Convex adapter over the backend-agnostic
 * `QueryNode` from `@retreejs/query`, which owns the status machine,
 * subscription lifecycle, args comparison, reconciliation, and optimistic
 * update machinery.
 *
 * Dispose query nodes when their owner is torn down. Use `"skip"` when the
 * query should be temporarily disabled. Prefer reconciled arrays so unchanged
 * child objects keep identity for `useNode(item)` components.
 *
 * @example
 * ```ts
 * const tasks = new ConvexQueryNode(client, api.tasks.byProject, {
 *     args: { projectId: "p1" },
 *     initialState: [],
 * });
 *
 * Retree.on(tasks, "nodeChanged", (next) => {
 *     console.log(next.result.status);
 * });
 * ```
 */
export class ConvexQueryNode<
    Query extends QueryReference
> extends BaseConvexQueryNode<FunctionArgs<Query>, FunctionReturnType<Query>> {
    /**
     * Latest query state emitted by Convex, or the initial state before Convex
     * emits.
     */
    public declare state: ConvexQueryNodeState<Query>;
    /**
     * Latest structured query result.
     */
    public declare result: ConvexQueryNodeResult<Query>;

    /**
     * Create a node for a Convex query subscription.
     *
     * @remarks
     * The subscription starts when the node is observed by Retree. This avoids
     * opening Convex subscriptions for state nobody is currently rendering or
     * listening to.
     *
     * @param client Convex client used for the subscription.
     * @param query Convex query function reference.
     * @param options Query arguments, optional initial state, and optional reconciler.
     *
     * @example
     * ```ts
     * const tasks = Retree.root(
     *     new ConvexQueryNode(client, api.tasks.list, {
     *         initialState: [],
     *     })
     * );
     * ```
     */
    constructor(
        client: IConvexClient,
        query: Query,
        ...options: ConvexQueryNodeOptionsArgs<Query>
    ) {
        super(
            client,
            createConvexQuerySource(client, query),
            getQueryNodeOptions(options[0])
        );
    }

    protected get queryNodeName(): string {
        return "ConvexQueryNode";
    }

    /**
     * Default Convex reconciliation: document arrays are reconciled by `_id`
     * so unchanged rows keep identity even without an explicit reconciler.
     */
    protected tryDefaultReconcile(next: FunctionReturnType<Query>): boolean {
        return tryReconcileConvexDocuments(this.state, next);
    }

    /**
     * Update the query arguments and resubscribe when the arguments change
     * (compared deeply, matching Convex's own structural comparison).
     *
     * @remarks
     * Use this when query args are controlled by Retree state, routing, or user
     * input. Passing `"skip"` disables the active subscription and sets
     * `result.status` to `"skipped"`.
     *
     * Updating args can emit because `state`, `result`, and `error` may change.
     * When the node was constructed with `keepPreviousData`, the previous
     * `state` stays visible while the new subscription loads and
     * `result.isStale` is `true` until the first value arrives.
     *
     * On a disposed node this records the new args without opening a
     * subscription; the node resubscribes with the latest args when it is
     * observed again.
     *
     * @param args Next query arguments, or `"skip"` to disable the subscription.
     *
     * @example
     * ```ts
     * tasks.updateArgs({ projectId: "p2" }); // ✅ may emit pending/success
     * tasks.updateArgs("skip"); // ✅ emits skipped state and unsubscribes
     * ```
     */
    public updateArgs(args: ConvexQueryArgs<Query>): void {
        super.updateArgs(args);
    }

    /**
     * Re-subscribe to the query after `result.status` is `"error"`.
     *
     * @remarks
     * Use this from retry affordances in UI. It closes the errored
     * subscription and opens a fresh one with the current args, moving the
     * result to `"pending"` (or the cached value when Convex has one). Does
     * nothing unless the current status is `"error"`.
     *
     * @example
     * ```ts
     * if (tasks.result.status === "error") {
     *     tasks.retry(); // ✅ re-opens the subscription
     * }
     * ```
     */
    public retry(): void {
        super.retry();
    }

    /**
     * Apply an optimistic update. If a mutation context is provided, rollback
     * when its promise rejects unless a newer server value resolves the dirty
     * state first.
     *
     * @remarks
     * Use this from a mutation's `withOptimisticUpdate` callback when the UI
     * should update immediately before Convex confirms the write. The transform
     * mutates the existing query state in place and emits through Retree.
     *
     * Prefer small, targeted transforms. Provide `revert(...)` when the default
     * rollback to the last clean server value is not specific enough.
     *
     * @param transform Optimistic transform and optional mutation context.
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
    public optimisticUpdate<Mutation extends MutationReference>(
        transform: IOptimisticTransform<FunctionReturnType<Query>, Mutation>
    ): void {
        super.optimisticUpdate(transform);
    }

    /**
     * Stop the active Convex query subscription.
     *
     * @remarks
     * Retree calls this automatically when the node loses its last active
     * observer. Call it manually when tearing the owner down outside Retree
     * observation. Disposing stops future Convex updates; it does not clear
     * `state`, `result`, or `error`.
     *
     * Disposal is sticky: writes to the node no longer reopen the
     * subscription. The node resubscribes when it gains a new observer, or
     * when {@link ConvexQueryNode.retry} runs after an error.
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
     *     public dispose() {
     *         this.tasks.dispose();
     *     }
     * }
     * ```
     */
    public dispose(): void {
        notifyNodeDisposed(this);
        super.dispose();
    }
}

function createConvexQuerySource<Query extends QueryReference>(
    client: IConvexQueryClient,
    query: Query
): IQuerySubscriptionSource<FunctionArgs<Query>, FunctionReturnType<Query>> {
    return {
        subscribe(args, onValue, onError) {
            // The Convex subscription handle already satisfies the generic
            // handle protocol (unsubscribe + getCurrentValue).
            return client.onUpdate(query, args, onValue, onError);
        },
    };
}

function getQueryNodeOptions<Query extends QueryReference>(
    rawOptions: IConvexQueryNodeOptions<Query> | ConvexQuerySkip | undefined
):
    | IQueryNodeOptions<FunctionArgs<Query>, FunctionReturnType<Query>>
    | ConvexQuerySkip {
    if (rawOptions === "skip") {
        return "skip";
    }

    return {
        args: getQueryArgs(rawOptions),
        initialState: rawOptions?.initialState,
        reconcile: rawOptions?.reconcile,
        keepPreviousData: rawOptions?.keepPreviousData,
    };
}

function getQueryArgs<Query extends QueryReference>(
    options: IConvexQueryNodeOptions<Query> | undefined
): FunctionArgs<Query> {
    if (options?.args !== undefined) {
        return options.args;
    }

    return {};
}
