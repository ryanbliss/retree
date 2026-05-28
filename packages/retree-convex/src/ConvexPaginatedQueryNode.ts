/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, Retree } from "@retreejs/core";
import type { PaginationStatus } from "convex/browser";
import { BaseConvexNode } from "./BaseConvexNode";
import {
    ConvexPaginatedQueryArgs,
    ConvexPaginatedQueryNodeOptionsArgs,
    ConvexPaginatedQueryNodeResult,
    ConvexPaginatedQueryNodeState,
    IConvexClient,
    IConvexPaginatedQueryNodeOptions,
    IConvexQuerySubscription,
    PaginatedQueryArgs,
    PaginatedQueryItem,
    PaginatedQueryReference,
    RetreePaginatedQueryResult,
} from "./types";

/**
 * Reactive paginated query node that subscribes to a Convex paginated query and
 * exposes the loaded pages as Retree state.
 */
export class ConvexPaginatedQueryNode<
    Query extends PaginatedQueryReference
> extends BaseConvexNode {
    @ignore
    private queryReference: Query;
    @ignore
    private args: ConvexPaginatedQueryArgs<Query>;
    @ignore
    private initialNumItems: number;
    @ignore
    private unsubscribe: IConvexQuerySubscription<unknown> | null = null;
    /**
     * Latest paginated query state emitted by Convex.
     */
    public state: ConvexPaginatedQueryNodeState<Query>;
    /**
     * Latest structured query result.
     */
    public result: ConvexPaginatedQueryNodeResult<Query>;
    /**
     * Latest subscription error.
     */
    public error: Error | null = null;

    /**
     * Create a node for a Convex paginated query subscription.
     *
     * @param client Convex client used for the subscription.
     * @param query Convex paginated query function reference.
     * @param options Query arguments, initial page size, and optional initial state.
     */
    constructor(
        client: IConvexClient,
        query: Query,
        ...options: ConvexPaginatedQueryNodeOptionsArgs<Query>
    ) {
        super(client);
        const rawOptions = options[0];
        const queryOptions = getQueryOptions(rawOptions);
        this.queryReference = query;
        this.args = getPaginatedQueryArgs(rawOptions, queryOptions);
        this.initialNumItems = queryOptions?.initialNumItems ?? 0;
        this.state = queryOptions?.initialState;
        this.result = getInitialResult(rawOptions, this.state);
    }

    get dependencies() {
        return [];
    }

    protected onObserved(): void {
        this.syncArgs(this.args, false);
    }

    protected onChanged(): void {
        this.syncArgs(this.args, false);
    }

    /**
     * Update the query arguments and resubscribe when the shallow argument
     * comparison changes. Pass `"skip"` to disable the subscription.
     *
     * @param args Next query arguments, or `"skip"`.
     */
    public updateArgs(args: ConvexPaginatedQueryArgs<Query>): void {
        this.args = args;
        this.syncArgs(args, true);
    }

    private syncArgs(
        args: ConvexPaginatedQueryArgs<Query>,
        resetBeforeSubscribe: boolean
    ): void {
        let didSubscribe = false;
        let receivedValue = false;
        this.memo(
            "updateArgs",
            () => {
                didSubscribe = true;
                this.dispose();
                if (args === "skip") {
                    return;
                }

                const subscription = this.client.onPaginatedUpdate_experimental(
                    this.queryReference,
                    args,
                    { initialNumItems: this.initialNumItems },
                    (result) => {
                        receivedValue =
                            this.setPaginatedStateFromUnknown(result);
                    },
                    (error) => {
                        this.setError(error);
                    }
                );
                this.unsubscribe = subscription;
                receivedValue = this.setPaginatedStateFromUnknown(
                    subscription.getCurrentValue()
                );
            },
            this.getArgComparisons(args)
        );

        if (!resetBeforeSubscribe) {
            return;
        }

        if (!didSubscribe) {
            return;
        }

        if (args === "skip") {
            this.setSkipped();
            return;
        }

        if (receivedValue) {
            return;
        }

        this.setPending();
    }

    /**
     * Request more items for the active paginated query.
     *
     * @param numItems Number of additional items to load.
     * @returns Whether Convex started a load-more request.
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
     */
    public dispose(): void {
        if (this.unsubscribe === null) {
            return;
        }

        this.unsubscribe.unsubscribe();
        this.unsubscribe = null;
    }

    private setPaginatedStateFromUnknown(result: unknown): boolean {
        if (!isPaginatedQueryResult<Query>(result)) {
            return false;
        }

        Retree.runTransaction(() => {
            this.state = result;
            this.error = null;
            this.result = { status: "success", data: result };
        });
        return true;
    }

    private setPending(): void {
        Retree.runTransaction(() => {
            this.state = undefined;
            this.error = null;
            this.result = { status: "pending" };
        });
    }

    private setSkipped(): void {
        Retree.runTransaction(() => {
            this.state = undefined;
            this.error = null;
            this.result = { status: "skipped" };
        });
    }

    private setError(error: Error): void {
        Retree.runTransaction(() => {
            this.error = error;
            this.result = { status: "error", error };
        });
    }

    private getArgComparisons(
        args: ConvexPaginatedQueryArgs<Query>
    ): unknown[] {
        if (args === "skip") {
            return ["skip", this.initialNumItems];
        }

        return [
            this.initialNumItems,
            ...Object.entries(args)
                .sort()
                .flatMap(([key, value]) => [key, value]),
        ];
    }
}

function getQueryOptions<Query extends PaginatedQueryReference>(
    options: IConvexPaginatedQueryNodeOptions<Query> | "skip"
): IConvexPaginatedQueryNodeOptions<Query> | undefined {
    if (options === "skip") {
        return undefined;
    }

    return options;
}

function getPaginatedQueryArgs<Query extends PaginatedQueryReference>(
    rawOptions: IConvexPaginatedQueryNodeOptions<Query> | "skip",
    options: IConvexPaginatedQueryNodeOptions<Query> | undefined
): ConvexPaginatedQueryArgs<Query> {
    if (rawOptions === "skip") {
        return "skip";
    }

    if (options?.args !== undefined) {
        return options.args;
    }

    return {} as PaginatedQueryArgs<Query>;
}

function getInitialResult<Query extends PaginatedQueryReference>(
    rawOptions: IConvexPaginatedQueryNodeOptions<Query> | "skip",
    state: ConvexPaginatedQueryNodeState<Query>
): ConvexPaginatedQueryNodeResult<Query> {
    if (rawOptions === "skip") {
        return { status: "skipped" };
    }

    if (state === undefined) {
        return { status: "pending" };
    }

    return { status: "success", data: state };
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
