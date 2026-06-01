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
    QueryReference,
} from "./types";

/**
 * Reactive query node that subscribes to a Convex query and writes emitted
 * values into Retree state.
 *
 * @remarks
 * Use this directly or through {@link ConvexNode.query} when query results
 * should be live Retree state. Convex emissions update `state`, `result`, and
 * `error`, which can emit `nodeChanged` and re-render React subscribers.
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
    private isOptimisticDirty = false;
    private optimisticGeneration = 0;
    private optimisticRollbackState: ConvexQueryNodeState<Query>;

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
     * comparison changes.
     *
     * @remarks
     * Use this when query args are controlled by Retree state, routing, or user
     * input. Passing `"skip"` disables the active subscription and sets
     * `result.status` to `"skipped"`.
     *
     * Updating args can emit because `state`, `result`, and `error` may change.
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
        const generation = this.markOptimisticDirty();
        if (this.state !== undefined) {
            transform.apply(this.state);
        }

        transform.ctx?.promise.catch((error: unknown) => {
            Retree.runTransaction(() => {
                if (
                    !this.isOptimisticDirty ||
                    this.optimisticGeneration !== generation
                ) {
                    return;
                }

                if (
                    this.state !== undefined &&
                    this.optimisticRollbackState !== undefined &&
                    transform.revert !== undefined
                ) {
                    transform.revert(this.state, this.optimisticRollbackState);
                } else {
                    this.restoreState(this.optimisticRollbackState);
                }
                this.clearOptimisticDirty();
                this.setResultFromState();
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
            this.clearOptimisticDirty();
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
        if (
            this.isOptimisticDirty &&
            this.stateEquals(next, this.lastEmittedState)
        ) {
            this.lastEmittedState = this.cloneState(next);
            return;
        }

        this.clearOptimisticDirty();
        this.restoreState(next);
        this.lastEmittedState = this.cloneState(this.state);
        this.setResultFromState(next);
    }

    private setResultFromState(next?: FunctionReturnType<Query>): void {
        if (this.state !== undefined) {
            this.result = { status: "success", data: this.state };
            return;
        }

        if (next !== undefined) {
            this.result = { status: "success", data: next };
            return;
        }

        this.result = { status: "pending" };
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
     *
     * @remarks
     * Call this when the owner of the query node is torn down. Disposing stops
     * future Convex updates; it does not clear `state`, `result`, or `error`.
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

    private markOptimisticDirty(): number {
        if (!this.isOptimisticDirty) {
            this.isOptimisticDirty = true;
            this.optimisticGeneration++;
            this.optimisticRollbackState = this.cloneState(
                this.lastEmittedState
            );
        }

        return this.optimisticGeneration;
    }

    private clearOptimisticDirty(): void {
        this.isOptimisticDirty = false;
        this.optimisticRollbackState = undefined;
    }

    private stateEquals(
        left: ConvexQueryNodeState<Query>,
        right: ConvexQueryNodeState<Query>
    ): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
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
