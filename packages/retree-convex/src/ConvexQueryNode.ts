/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore } from "@retreejs/core";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { BaseConvexNode } from "./internals/BaseConvexNode";
import { tryReconcileConvexDocuments } from "./internals/reconcile";
import {
    ConvexQueryNodeOptionsArgs,
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
    private args: FunctionArgs<Query>;
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
        const queryOptions = options[0];
        this.queryReference = query;
        this.args = getQueryArgs(queryOptions);
        this.reconciler = queryOptions?.reconcile;
        this.state = queryOptions?.initialState;
        this.lastEmittedState = this.cloneState(queryOptions?.initialState);
    }

    get dependencies() {
        // Retree calls this getter when the node is observed. Starting the
        // subscription here makes Convex callbacks write through the proxied node
        // instead of the raw constructor instance, so `state` updates emit.
        this.updateArgs(this.args);
        return [];
    }

    /**
     * Update the query arguments and resubscribe when the shallow argument
     * comparison changes.
     *
     * @param args Next query arguments.
     */
    public updateArgs(args: FunctionArgs<Query>): void {
        this.args = args;
        this.memo(
            "updateArgs",
            () => {
                this.dispose();
                const subscription = this.client.onUpdate(
                    this.queryReference,
                    args,
                    (result) => {
                        this.setEmittedState(result);
                        this.error = null;
                    },
                    (error) => {
                        this.error = error;
                    }
                );
                this.unsubscribe = subscription;
                const currentValue = subscription.getCurrentValue();
                if (currentValue !== undefined) {
                    this.setEmittedState(currentValue);
                    this.error = null;
                }
            },
            this.getArgComparisons(args)
        );
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
            if (
                this.state !== undefined &&
                snapshot !== undefined &&
                transform?.revert !== undefined
            ) {
                transform.revert(this.state, snapshot);
            } else {
                this.restoreState(snapshot ?? this.lastEmittedState);
            }
            this.error =
                error instanceof Error
                    ? error
                    : new Error(
                          `ConvexQueryNode.optimisticUpdate: mutation failed with a non-Error rejection: ${String(
                              error
                          )}`
                      );
        });
    }

    private setEmittedState(next: FunctionReturnType<Query>): void {
        this.restoreState(next);
        this.lastEmittedState = this.cloneState(this.state);
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

    private getArgComparisons(args: FunctionArgs<Query>): unknown[] {
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

function getQueryArgs<Query extends QueryReference>(
    options: IConvexQueryNodeOptions<Query> | undefined
): FunctionArgs<Query> {
    if (options?.args !== undefined) {
        return options.args;
    }

    return {} as FunctionArgs<Query>;
}
