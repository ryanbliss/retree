/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "@retreejs/core";
import { getUnproxiedNode } from "@retreejs/core/internal";
import type { PaginationStatus } from "convex/browser";
import {
    deepEquals,
    IQueryNodeOptions,
    IQuerySubscriptionSource,
} from "@retreejs/query";
import { BaseConvexQueryNode } from "./BaseConvexQueryNode.js";
import { notifyNodeDisposed } from "./internals/disposal.js";
import { tryReconcileConvexDocuments } from "./internals/reconcile.js";
import {
    ConvexPaginatedQueryArgs,
    ConvexPaginatedQueryNodeOptionsArgs,
    ConvexPaginatedQueryNodeResult,
    ConvexPaginatedQueryNodeState,
    ConvexQuerySkip,
    IConvexClient,
    IConvexPaginatedQueryNodeOptions,
    IConvexQueryClient,
    IOptimisticTransform,
    MutationReference,
    PaginatedQueryArgs,
    PaginatedQueryItem,
    PaginatedQueryReference,
    RetreePaginatedQueryResult,
} from "./types.js";

/**
 * Reactive paginated query node that subscribes to a Convex paginated query and
 * exposes the loaded pages as Retree state.
 *
 * @remarks
 * Use this directly or through {@link ConvexNode.paginatedQuery} for live
 * paginated lists. New pages update `state`, `result`, and `error`, which can
 * emit Retree changes and re-render React subscribers.
 *
 * This class is a Convex adapter over the backend-agnostic `QueryNode` from
 * `@retreejs/query`, sharing its status machine, args lifecycle, and
 * optimistic-update machinery with {@link ConvexQueryNode}. Optimistic
 * transforms run against the loaded `state.results` rows; rollback baselines
 * clone the loaded rows while keeping the `loadMore` function by reference.
 *
 * Dispose the node when its owner is torn down. Use `"skip"` when the query
 * should be temporarily disabled.
 *
 * @example
 * ```ts
 * const messages = new ConvexPaginatedQueryNode(client, api.messages.list, {
 *     args: { channelId: "general" },
 *     initialNumItems: 20,
 * });
 * ```
 */
export class ConvexPaginatedQueryNode<
    Query extends PaginatedQueryReference
> extends BaseConvexQueryNode<
    PaginatedQueryArgs<Query>,
    RetreePaginatedQueryResult<PaginatedQueryItem<Query>>
> {
    /**
     * Latest paginated query state emitted by Convex.
     */
    public declare state: ConvexPaginatedQueryNodeState<Query>;
    /**
     * Latest structured query result.
     */
    public declare result: ConvexPaginatedQueryNodeResult<Query>;

    /**
     * Create a node for a Convex paginated query subscription.
     *
     * @remarks
     * The subscription starts when the node is observed by Retree. This avoids
     * opening Convex subscriptions for paginated state nobody is currently
     * rendering or listening to.
     *
     * @param client Convex client used for the subscription.
     * @param query Convex paginated query function reference.
     * @param options Query arguments, initial page size, and optional initial state.
     *
     * @example
     * ```ts
     * const messages = Retree.root(
     *     new ConvexPaginatedQueryNode(client, api.messages.list, {
     *         args: { channelId: "general" },
     *         initialNumItems: 20,
     *     })
     * );
     * ```
     */
    constructor(
        client: IConvexClient,
        query: Query,
        ...options: ConvexPaginatedQueryNodeOptionsArgs<Query>
    ) {
        const rawOptions = options[0];
        const queryOptions = getQueryOptions(rawOptions);
        super(
            client,
            createConvexPaginatedQuerySource(
                client,
                query,
                queryOptions?.initialNumItems ?? 0
            ),
            getPaginatedQueryNodeOptions(rawOptions, queryOptions)
        );
    }

    protected get queryNodeName(): string {
        return "ConvexPaginatedQueryNode";
    }

    /**
     * Update the query arguments and resubscribe when the arguments change
     * (compared deeply, matching Convex's own structural comparison). Pass
     * `"skip"` to disable the subscription.
     *
     * @remarks
     * Updating args can emit because `state`, `result`, and `error` may change.
     * Passing `"skip"` disables the active subscription and sets
     * `result.status` to `"skipped"`.
     *
     * On a disposed node this records the new args without opening a
     * subscription; the node resubscribes with the latest args when it is
     * observed again.
     *
     * @param args Next query arguments, or `"skip"`.
     *
     * @example
     * ```ts
     * messages.updateArgs({ channelId: "random" }); // ✅ may emit
     * messages.updateArgs("skip"); // ✅ emits skipped state and unsubscribes
     * ```
     */
    public updateArgs(args: ConvexPaginatedQueryArgs<Query>): void {
        super.updateArgs(args);
    }

    /**
     * Apply an optimistic update to the loaded paginated results. If a
     * mutation context is provided, rollback when its promise rejects unless a
     * newer server value resolves the dirty state first.
     *
     * @remarks
     * Use this from a mutation's `withOptimisticUpdate` callback when the UI
     * should update immediately before Convex confirms the write. The transform
     * mutates the existing paginated state (typically `state.results`) in
     * place and emits through Retree.
     *
     * Rollback restores the latest clean server baseline for the loaded rows
     * and pagination status; the `loadMore` function is kept by reference and
     * never cloned.
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
     *             this.messages.optimisticUpdate({
     *                 ctx,
     *                 apply(page) {
     *                     const task = page.results.find(
     *                         (item) => item._id === taskId
     *                     );
     *                     if (task) task.isCompleted = !task.isCompleted;
     *                 },
     *             });
     *         },
     *     }
     * );
     * ```
     */
    public optimisticUpdate<Mutation extends MutationReference>(
        transform: IOptimisticTransform<
            RetreePaginatedQueryResult<PaginatedQueryItem<Query>>,
            Mutation
        >
    ): void {
        super.optimisticUpdate(transform);
    }

    /**
     * Request more items for the active paginated query.
     *
     * @remarks
     * Use this from UI actions such as "Load more" buttons or infinite scroll.
     * It returns `false` when there is no active paginated state to extend.
     * Passing a non-positive number throws.
     *
     * @param numItems Number of additional items to load.
     * @returns Whether Convex started a load-more request.
     *
     * @example
     * ```ts
     * const requested = messages.loadMore(20);
     * if (!requested) {
     *     console.log("No active page to extend");
     * }
     * ```
     */
    public loadMore(numItems: number): boolean {
        if (numItems <= 0) {
            throw new Error(
                "ConvexPaginatedQueryNode.loadMore: expected numItems to be greater than 0."
            );
        }

        if (this.state === undefined) {
            return false;
        }

        return this.state.loadMore(numItems);
    }

    /**
     * Stop the active Convex paginated query subscription.
     *
     * @remarks
     * Retree calls this automatically when the node loses its last active
     * observer. Call it manually when tearing the owner down outside Retree
     * observation. Disposing stops future Convex updates; it does not clear
     * `state`, `result`, or `error`.
     *
     * Disposal is sticky: writes to the node no longer reopen the
     * subscription. The node resubscribes when it gains a new observer.
     *
     * @example
     * ```ts
     * public dispose() {
     *     this.messages.dispose();
     * }
     * ```
     */
    public dispose(): void {
        notifyNodeDisposed(this);
        super.dispose();
    }

    /**
     * Write a freshly emitted (or rollback) paginated result into `state`,
     * reconciling loaded rows by `_id` so unchanged row nodes keep identity
     * when any page updates or `loadMore` lands.
     */
    protected restoreState(next: ConvexPaginatedQueryNodeState<Query>): void {
        if (next === undefined) {
            this.state = undefined;
            return;
        }

        const current = this.state;
        if (current === undefined) {
            this.state = next;
            return;
        }

        if (!tryReconcileConvexDocuments(current.results, next.results)) {
            // Rows without `_id` cannot be reconciled by identity; replace the
            // loaded rows wholesale like the non-paginated node does.
            current.results = next.results;
        }

        // Page bookkeeping: compare against the raw view so the function
        // reference check is not affected by proxy wrapping.
        const rawCurrent =
            (getUnproxiedNode(current as unknown as TreeNode) as
                | typeof current
                | undefined) ?? current;
        if (rawCurrent.status !== next.status) {
            current.status = next.status;
        }
        if (rawCurrent.loadMore !== next.loadMore) {
            current.loadMore = next.loadMore;
        }
    }

    /**
     * Clone paginated state for optimistic rollback baselines.
     *
     * @remarks
     * `structuredClone` throws on the `loadMore` function stored in paginated
     * state, so this clones the loaded rows and pagination status while
     * keeping `loadMore` by reference.
     */
    protected cloneState(
        state: ConvexPaginatedQueryNodeState<Query>
    ): ConvexPaginatedQueryNodeState<Query> {
        if (state === undefined) {
            return undefined;
        }

        const raw = unwrapPaginatedState(state);
        return {
            results: structuredClone(raw.results),
            status: raw.status,
            loadMore: raw.loadMore,
        };
    }

    /**
     * Compare paginated emissions by loaded rows and pagination status.
     *
     * @remarks
     * Convex creates a fresh `loadMore` function per emission, so including it
     * in the comparison would make every server echo look like a change and
     * defeat the optimistic dirty-window logic.
     */
    protected stateEquals(
        left: ConvexPaginatedQueryNodeState<Query>,
        right: ConvexPaginatedQueryNodeState<Query>
    ): boolean {
        if (left === undefined) {
            return right === undefined;
        }
        if (right === undefined) {
            return false;
        }

        const rawLeft = unwrapPaginatedState(left);
        const rawRight = unwrapPaginatedState(right);
        if (rawLeft.status !== rawRight.status) {
            return false;
        }
        return deepEquals(rawLeft.results, rawRight.results);
    }
}

function unwrapPaginatedState<TState extends object>(state: TState): TState {
    return (
        (getUnproxiedNode(state as unknown as TreeNode) as
            | TState
            | undefined) ?? state
    );
}

function createConvexPaginatedQuerySource<
    Query extends PaginatedQueryReference
>(
    client: IConvexQueryClient,
    query: Query,
    initialNumItems: number
): IQuerySubscriptionSource<
    PaginatedQueryArgs<Query>,
    RetreePaginatedQueryResult<PaginatedQueryItem<Query>>
> {
    return {
        subscribe(args, onValue, onError) {
            const subscription = client.onPaginatedUpdate_experimental(
                query,
                args,
                { initialNumItems },
                (result) => {
                    // Values that do not look like paginated results are
                    // dropped so the node never stores a malformed page.
                    if (!isPaginatedQueryResult<Query>(result)) {
                        return;
                    }
                    onValue(result);
                },
                onError
            );
            return {
                unsubscribe: () => subscription.unsubscribe(),
                getCurrentValue: () => {
                    const value = subscription.getCurrentValue();
                    if (!isPaginatedQueryResult<Query>(value)) {
                        return undefined;
                    }
                    return value;
                },
            };
        },
    };
}

function getQueryOptions<Query extends PaginatedQueryReference>(
    options: IConvexPaginatedQueryNodeOptions<Query> | ConvexQuerySkip
): IConvexPaginatedQueryNodeOptions<Query> | undefined {
    if (options === "skip") {
        return undefined;
    }

    return options;
}

function getPaginatedQueryNodeOptions<Query extends PaginatedQueryReference>(
    rawOptions: IConvexPaginatedQueryNodeOptions<Query> | ConvexQuerySkip,
    options: IConvexPaginatedQueryNodeOptions<Query> | undefined
):
    | IQueryNodeOptions<
          PaginatedQueryArgs<Query>,
          RetreePaginatedQueryResult<PaginatedQueryItem<Query>>
      >
    | ConvexQuerySkip {
    if (rawOptions === "skip") {
        return "skip";
    }

    return {
        args: getPaginatedQueryArgs(options),
        initialState: options?.initialState,
    };
}

function getPaginatedQueryArgs<Query extends PaginatedQueryReference>(
    options: IConvexPaginatedQueryNodeOptions<Query> | undefined
): PaginatedQueryArgs<Query> {
    if (options?.args !== undefined) {
        return options.args;
    }

    return {} as PaginatedQueryArgs<Query>;
}

function isPaginatedQueryResult<Query extends PaginatedQueryReference>(
    value: unknown
): value is RetreePaginatedQueryResult<PaginatedQueryItem<Query>> {
    if (typeof value !== "object") {
        return false;
    }

    if (value === null) {
        return false;
    }

    if (!("results" in value)) {
        return false;
    }

    if (!("status" in value)) {
        return false;
    }

    if (!("loadMore" in value)) {
        return false;
    }

    const candidate = value as {
        results: unknown;
        status: unknown;
        loadMore: unknown;
    };
    if (!Array.isArray(candidate.results)) {
        return false;
    }

    if (!isPaginationStatus(candidate.status)) {
        return false;
    }

    return typeof candidate.loadMore === "function";
}

function isPaginationStatus(value: unknown): value is PaginationStatus {
    if (value === "LoadingFirstPage") {
        return true;
    }

    if (value === "CanLoadMore") {
        return true;
    }

    if (value === "LoadingMore") {
        return true;
    }

    return value === "Exhausted";
}
