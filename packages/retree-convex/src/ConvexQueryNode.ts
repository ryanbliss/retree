/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, Retree } from "@retreejs/core";
import type { FunctionReturnType } from "convex/server";
import { BaseConvexNode } from "./BaseConvexNode";
import { tryReconcileConvexDocuments } from "./internals/reconcile";
import {
    ConvexQueryNodeOptionsArgs,
    ConvexQueryArgs,
    ConvexQueryNodeResult,
    ConvexQueryNodeState,
    IConvexClient,
    IConvexQueryNodeOptions,
    IConvexQuerySubscription,
    IOptimisticTransform,
    IStateReconciler,
    MutationReference,
    OptimisticUpdateContext,
    QueryReference,
} from "./types";

/**
 * Reactive query node that subscribes to a Convex query and writes emitted
 * values into Retree state.
 */
export class ConvexQueryNode<
    Query extends QueryReference
> extends BaseConvexNode {
    @ignore
    private queryReference: Query;
    @ignore
    private args: ConvexQueryArgs<Query>;
    @ignore
    private unsubscribe: IConvexQuerySubscription<
        FunctionReturnType<Query>
    > | null = null;
    @ignore
    private reconciler: IStateReconciler<FunctionReturnType<Query>> | undefined;

    /**
     * Latest query state emitted by Convex, or the initial state before Convex
     * emits.
     */
    public state: ConvexQueryNodeState<Query>;
    /**
     * Latest structured query result.
     */
    public result: ConvexQueryNodeResult<Query>;
    /**
     * Latest subscription or mutation rollback error.
     */
    public error: Error | null = null;
    private lastEmittedState: ConvexQueryNodeState<Query>;

    /**
     * Create a node for a Convex query subscription.
     *
     * @param client Convex client used for the subscription.
     * @param query Convex query function reference.
     * @param options Query arguments, optional initial state, and optional reconciler.
     */
    constructor(
        client: IConvexClient,
        query: Query,
        ...options: ConvexQueryNodeOptionsArgs<Query>
    ) {
        super(client);
        const rawOptions = options[0];
        const queryOptions = getQueryOptions(rawOptions);
        this.queryReference = query;
        this.args = getQueryArgs(rawOptions, queryOptions);
        this.reconciler = queryOptions?.reconcile;
        this.state = queryOptions?.initialState;
        this.result = getInitialResult(rawOptions, this.state);
        this.lastEmittedState = this.cloneState(queryOptions?.initialState);
    }

    get dependencies() {
        // Retree calls this getter when the node is observed. Starting the
        // subscription here makes Convex callbacks write through the proxied node
        // instead of the raw constructor instance, so `state` updates emit.
        this.syncArgs(this.args, false);
        return [];
    }

    /**
     * Update the query arguments and resubscribe when the shallow argument
     * comparison changes.
     *
     * @param args Next query arguments, or `"skip"` to disable the subscription.
     */
    public updateArgs(args: ConvexQueryArgs<Query>): void {
        this.args = args;
        this.syncArgs(args, true);
    }

    private syncArgs(
        args: ConvexQueryArgs<Query>,
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

                const subscription = this.client.onUpdate(
                    this.queryReference,
                    args,
                    (result) => {
                        receivedValue = true;
                        Retree.runTransaction(() => {
                            this.setEmittedState(result);
                            this.error = null;
                        });
                    },
                    (error) => {
                        this.setError(error);
                    }
                );
                this.unsubscribe = subscription;
                const currentValue = subscription.getCurrentValue();
                if (currentValue !== undefined) {
                    receivedValue = true;
                    Retree.runTransaction(() => {
                        this.setEmittedState(currentValue);
                        this.error = null;
                    });
                }
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
     * Apply an optimistic update and attach rollback handling to the mutation
     * promise.
     *
     * @param ctx Optimistic update context from a Retree Convex mutation.
     * @param transform Optional state transform to apply optimistically.
     */
    public optimisticUpdate<Mutation extends MutationReference>(
        ctx: OptimisticUpdateContext<Mutation>,
        transform?: IOptimisticTransform<FunctionReturnType<Query>>
    ): void {
        const snapshot =
            this.state === undefined ? undefined : this.cloneState(this.state);
        if (this.state !== undefined && transform !== undefined) {
            transform.apply(this.state);
        }

        ctx.promise.catch((error: unknown) => {
            Retree.runTransaction(() => {
                if (
                    this.state !== undefined &&
                    snapshot !== undefined &&
                    transform?.revert !== undefined
                ) {
                    transform.revert(this.state, snapshot);
                } else {
                    this.restoreState(snapshot ?? this.lastEmittedState);
                }
                this.error = getError(error);
            });
        });
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
            this.lastEmittedState = undefined;
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

    private setEmittedState(next: FunctionReturnType<Query>): void {
        this.restoreState(next);
        this.lastEmittedState = this.cloneState(this.state);
        if (this.state !== undefined) {
            this.result = { status: "success", data: this.state };
            return;
        }

        this.result = { status: "success", data: next };
    }

    private restoreState(next: ConvexQueryNodeState<Query>): void {
        if (next === undefined) {
            this.state = undefined;
            return;
        }

        if (this.reconciler === undefined) {
            if (tryReconcileConvexDocuments(this.state, next)) {
                return;
            }

            this.state = next;
            return;
        }

        const current = this.state;
        const reconciled = this.reconciler.reconcile(current, next);
        if (reconciled === current) {
            return;
        }

        this.state = reconciled;
    }

    /**
     * Stop the active Convex query subscription.
     */
    public dispose(): void {
        if (this.unsubscribe === null) {
            return;
        }

        this.unsubscribe.unsubscribe();
        this.unsubscribe = null;
    }

    private getArgComparisons(args: ConvexQueryArgs<Query>): unknown[] {
        if (args === "skip") {
            return ["skip"];
        }

        return Object.keys(args)
            .sort()
            .flatMap((key) => [key, args[key]]);
    }

    private cloneState<T>(state: T): T {
        if (state === undefined) {
            return state;
        }

        const serializedState = JSON.stringify(state);
        if (serializedState === undefined) {
            throw new Error(
                "ConvexQueryNode.cloneState: expected query state to be JSON-serializable, but JSON.stringify returned undefined."
            );
        }

        return JSON.parse(serializedState) as T;
    }
}

function getError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(
        `ConvexQueryNode.optimisticUpdate: mutation failed with a non-Error rejection: ${String(
            error
        )}`
    );
}

function getInitialResult<Query extends QueryReference>(
    rawOptions: IConvexQueryNodeOptions<Query> | "skip" | undefined,
    state: ConvexQueryNodeState<Query>
): ConvexQueryNodeResult<Query> {
    if (rawOptions === "skip") {
        return { status: "skipped" };
    }

    if (state === undefined) {
        return { status: "pending" };
    }

    return { status: "success", data: state };
}

function getQueryOptions<Query extends QueryReference>(
    options: IConvexQueryNodeOptions<Query> | "skip" | undefined
): IConvexQueryNodeOptions<Query> | undefined {
    if (options === "skip") {
        return undefined;
    }

    return options;
}

function getQueryArgs<Query extends QueryReference>(
    rawOptions: IConvexQueryNodeOptions<Query> | "skip" | undefined,
    options: IConvexQueryNodeOptions<Query> | undefined
): ConvexQueryArgs<Query> {
    if (rawOptions === "skip") {
        return "skip";
    }

    if (options?.args !== undefined) {
        return options.args;
    }

    return {};
}
