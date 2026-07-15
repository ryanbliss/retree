/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, ReactiveNode, Retree, TreeNode } from "@retreejs/core";
import { getUnproxiedNode } from "@retreejs/core/internal";
import { isDevMode } from "./internals/env.js";
import { deepEquals } from "./internals/equality.js";
import {
    IOptimisticQueryTransform,
    IQueryNodeOptions,
    IQuerySubscriptionHandle,
    IQuerySubscriptionSource,
    IStateReconciler,
    QueryNodeResult,
    QuerySkip,
} from "./types.js";

/**
 * Backend-agnostic reactive query node that subscribes to an async source and
 * writes emitted values into Retree state.
 *
 * @remarks
 * The node owns the full async-query state machine:
 *
 * -   **Status/result:** `pending`, `success` (optionally `isStale` with
 *     `keepPreviousData`), `error`, and `skipped`.
 * -   **Subscription lifecycle:** the source is subscribed when the node gains
 *     its first Retree observer and disposed when it loses its last one;
 *     disposal is sticky until the node is observed again (or
 *     {@link QueryNode.retry} runs after an error).
 * -   **Args lifecycle:** {@link QueryNode.updateArgs} resubscribes only when
 *     arguments change under deep comparison.
 * -   **Optimistic updates:** {@link QueryNode.optimisticUpdate} applies local
 *     transforms with generation tracking and rejection-time baseline
 *     rollback.
 * -   **Reconciliation:** an optional {@link IStateReconciler} keeps object
 *     identity stable across emissions.
 *
 * Backends plug in through {@link IQuerySubscriptionSource}. Subclasses (for
 * example `ConvexQueryNode` in `@retreejs/convex`) bind a concrete client and
 * may override the protected hooks (`tryDefaultReconcile`, `cloneState`,
 * `stateEquals`, `restoreState`) for backend-specific state shapes.
 *
 * @example
 * ```ts
 * const node = Retree.root(
 *     new QueryNode(mySource, { args: { listId: "today" } })
 * );
 *
 * Retree.on(node, "nodeChanged", (next) => {
 *     console.log(next.result.status);
 * });
 * ```
 */
export class QueryNode<TArgs, TState> extends ReactiveNode {
    @ignore
    private readonly source: IQuerySubscriptionSource<TArgs, TState>;
    @ignore
    private args: TArgs | QuerySkip;
    @ignore
    private subscription: IQuerySubscriptionHandle<TState> | null = null;
    @ignore
    private subscribedArgs: TArgs | undefined;
    @ignore
    private reconciler: IStateReconciler<TState> | undefined;
    @ignore
    private keepPreviousData: boolean;
    /**
     * True after {@link QueryNode.dispose} until the node is observed again
     * (or {@link QueryNode.retry} runs). Distinguishes a disposed node from
     * one that has simply never subscribed, so lifecycle callbacks such as
     * `onChanged` cannot silently resurrect a disposed subscription.
     */
    @ignore
    private isDisposed = false;
    /**
     * Latest query state emitted by the source, or the initial state before
     * the source emits.
     */
    public state: TState | undefined;
    /**
     * Latest structured query result.
     */
    public result: QueryNodeResult<TState>;
    /**
     * Latest subscription or mutation rollback error.
     */
    public error: Error | null = null;
    /**
     * Last state emitted by the subscription that Retree accepted as a clean
     * server baseline. During overlapping optimistic updates this may advance
     * even when `state` intentionally keeps the newer optimistic value.
     */
    private lastEmittedState: TState | undefined;
    /**
     * True while local optimistic state differs from the last clean server
     * baseline and may still need confirmation or rollback.
     */
    private isOptimisticDirty = false;
    /**
     * Monotonic id assigned to each optimistic update. Promise handlers compare
     * against this so an older mutation cannot rollback or confirm over newer
     * local state.
     */
    private optimisticGeneration = 0;
    /**
     * Generation that opened the current dirty window. If a later generation is
     * still pending, server emissions are treated as older confirmations and do
     * not overwrite the newer optimistic state.
     */
    private dirtyWindowStartGeneration: number | undefined;
    /**
     * Newest optimistic mutation promise that has not resolved successfully yet.
     * Only this generation is allowed to clear the pending marker.
     */
    private pendingOptimisticGeneration: number | undefined;

    /**
     * Create a node for an async query subscription.
     *
     * @remarks
     * The subscription starts when the node is observed by Retree. This avoids
     * opening backend subscriptions for state nobody is currently rendering or
     * listening to.
     *
     * @param source Backend subscription source.
     * @param options Query arguments, optional initial state, and optional
     * reconciler — or `"skip"` to start disabled.
     *
     * @example
     * ```ts
     * const node = Retree.root(
     *     new QueryNode(mySource, {
     *         args: { listId: "today" },
     *         initialState: [],
     *     })
     * );
     * ```
     */
    constructor(
        source: IQuerySubscriptionSource<TArgs, TState>,
        options: IQueryNodeOptions<TArgs, TState> | QuerySkip
    ) {
        super();
        this.source = source;
        const queryOptions = getQueryOptions(options);
        this.args = getInitialArgs(options, queryOptions);
        this.reconciler = queryOptions?.reconcile;
        this.keepPreviousData = queryOptions?.keepPreviousData ?? false;
        this.state = queryOptions?.initialState;
        this.result = getInitialResult(options, this.state);
        this.lastEmittedState = this.cloneState(this.state);
    }

    get dependencies() {
        return [];
    }

    /**
     * Name used in error and warning messages so failures pinpoint the
     * concrete node class. Subclasses override this with their class name.
     */
    protected get queryNodeName(): string {
        return "QueryNode";
    }

    protected onObserved(): void {
        // Re-observation is fresh intent to run the query: a node disposed by
        // losing its last observer (or by an explicit dispose call)
        // resubscribes here with its latest args.
        this.isDisposed = false;
        this.syncArgs(this.args, false);
    }

    protected onChanged(): void {
        this.syncArgs(this.args, false);
    }

    protected onUnobserved(): void {
        // Self-cleanup: without this, a standalone query node (e.g.
        // Retree.root(new QueryNode(...))) would keep a live backend
        // subscription open forever after its last observer unsubscribes.
        this.dispose();
    }

    /**
     * Update the query arguments and resubscribe when the arguments change
     * (compared deeply).
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
     * node.updateArgs({ listId: "tomorrow" }); // ✅ may emit pending/success
     * node.updateArgs("skip"); // ✅ emits skipped state and unsubscribes
     * ```
     */
    public updateArgs(args: TArgs | QuerySkip): void {
        this.args = args;
        this.syncArgs(args, true);
    }

    /**
     * Re-subscribe to the query after `result.status` is `"error"`.
     *
     * @remarks
     * Use this from retry affordances in UI. It closes the errored
     * subscription and opens a fresh one with the current args, moving the
     * result to `"pending"` (or the cached value when the backend has one).
     * Does nothing unless the current status is `"error"`.
     *
     * @example
     * ```ts
     * if (node.result.status === "error") {
     *     node.retry(); // ✅ re-opens the subscription
     * }
     * ```
     */
    public retry(): void {
        if (this.result.status !== "error") {
            return;
        }

        this.isDisposed = false;
        this.closeSubscription();
        this.syncArgs(this.args, true);
    }

    private syncArgs(
        args: TArgs | QuerySkip,
        resetBeforeSubscribe: boolean
    ): void {
        // Disposed is sticky: only a new observer (onObserved) or an explicit
        // retry() reopens the subscription. Without this, any onChanged tick
        // after dispose() would silently resurrect the backend subscription.
        if (this.isDisposed) {
            return;
        }

        let receivedValue = false;
        let receivedError = false;
        if (
            this.subscription !== null &&
            this.subscribedArgs !== undefined &&
            deepEquals(this.subscribedArgs, args)
        ) {
            return;
        }

        this.closeSubscription();
        if (args === "skip") {
            if (resetBeforeSubscribe) {
                this.setSkipped();
            }
            return;
        }

        const subscription = this.source.subscribe(
            args,
            (result) => {
                receivedValue = true;
                Retree.runTransaction(() => {
                    this.setEmittedState(result);
                    this.error = null;
                });
            },
            (error) => {
                receivedError = true;
                this.setError(error);
            }
        );
        this.subscription = subscription;
        this.subscribedArgs = args;
        const currentValue = subscription.getCurrentValue();
        if (currentValue !== undefined) {
            receivedValue = true;
            Retree.runTransaction(() => {
                this.setEmittedState(currentValue);
                this.error = null;
            });
        }

        if (!resetBeforeSubscribe) {
            return;
        }

        if (receivedValue) {
            return;
        }

        // The new subscription's cached value can be an error surfaced
        // synchronously through the error callback above. That error must stay
        // visible; resetting to pending would leave the node pending forever.
        if (receivedError) {
            return;
        }

        if (this.keepPreviousData && this.state !== undefined) {
            this.setStale();
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
     * Use this when the UI should update immediately before the backend
     * confirms the write. The transform mutates the existing query state in
     * place and emits through Retree.
     *
     * Prefer small, targeted transforms. Provide `revert(...)` when the default
     * rollback to the last clean server value is not specific enough.
     *
     * @param transform Optimistic transform and optional mutation context.
     *
     * @example
     * ```ts
     * node.optimisticUpdate({
     *     ctx: { promise: mutationPromise },
     *     apply(tasks) {
     *         const task = tasks.find((item) => item.id === taskId);
     *         if (task) task.isCompleted = !task.isCompleted;
     *     },
     * });
     * ```
     */
    public optimisticUpdate(
        transform: IOptimisticQueryTransform<TState>
    ): void {
        const generation = this.markOptimisticDirty();
        if (transform.ctx !== undefined) {
            this.pendingOptimisticGeneration = generation;
            transform.ctx.promise.then(
                () => {
                    // A newer optimistic mutation may have started while this
                    // one was in flight. In that case, this confirmation is too
                    // old to mark the optimistic state as no longer pending.
                    if (this.pendingOptimisticGeneration !== generation) {
                        return;
                    }
                    this.pendingOptimisticGeneration = undefined;
                },
                () => {
                    return;
                }
            );
        }
        const currentState = this.state;
        if (currentState !== undefined) {
            // Batch the transform's writes like every other state entry point
            // so multi-field optimistic updates emit once per node.
            Retree.runTransaction(() => {
                transform.apply(currentState);
            });
        } else if (isDevMode()) {
            console.warn(
                `${this.queryNodeName}.optimisticUpdate: transform.apply was skipped because state is undefined. The query has not emitted a value yet (or is pending/skipped), so there is nothing to update optimistically.`
            );
        }

        transform.ctx?.promise.catch((error: unknown) => {
            Retree.runTransaction(() => {
                // Rejecting an older mutation should not rollback a newer local
                // edit. The newest generation owns rollback for the dirty window.
                if (
                    !this.isOptimisticDirty ||
                    this.optimisticGeneration !== generation
                ) {
                    return;
                }

                // Clone at rejection time so the rollback restores the latest
                // clean server baseline — including confirmations of older
                // mutations that advanced `lastEmittedState` mid-window — and
                // so the baseline never aliases objects written into managed
                // state during the restore.
                const rollbackState = this.cloneState(this.lastEmittedState);
                if (
                    this.state !== undefined &&
                    rollbackState !== undefined &&
                    transform.revert !== undefined
                ) {
                    transform.revert(this.state, rollbackState);
                } else {
                    this.restoreState(rollbackState);
                }
                this.clearOptimisticDirty();
                this.setResultFromState();
                this.error = this.toRollbackError(error);
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

    private setStale(): void {
        Retree.runTransaction(() => {
            const data = this.state;
            if (data === undefined) {
                throw new Error(
                    `${this.queryNodeName}.setStale: expected previous state to exist when marking the result stale. This is unexpected and likely a Retree bug. Please file an issue with the updateArgs call that triggered this.`
                );
            }
            this.error = null;
            this.result = { status: "success", data, isStale: true };
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

    private setEmittedState(next: TState): void {
        // The backend can confirm an older mutation while a newer optimistic
        // edit is still pending. Keep that server value as the latest baseline,
        // but do not restore it into `state` because that would make the UI
        // rubber-band back to the older value.
        if (
            this.isOptimisticDirty &&
            this.hasPendingSupersedingOptimisticMutation()
        ) {
            this.lastEmittedState = next;
            return;
        }

        // When the backend re-emits the baseline that existed before the
        // optimistic write, the write has not been confirmed yet. Keep the
        // optimistic state visible and keep waiting for either confirmation or
        // rollback.
        if (
            this.isOptimisticDirty &&
            this.stateEquals(next, this.lastEmittedState)
        ) {
            this.lastEmittedState = next;
            return;
        }

        this.clearOptimisticDirty();
        this.restoreState(next);
        // Store the emitted value by reference. Reconciliation may alias parts
        // of `next` into managed state, so `markOptimisticDirty` detaches the
        // baseline with a clone before any optimistic transform can mutate it.
        this.lastEmittedState = next;
        this.setResultFromState(next);
    }

    private setResultFromState(next?: TState): void {
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

    /**
     * Write an emitted or rollback value into `state`.
     *
     * @remarks
     * Applies the configured {@link IStateReconciler} when one exists,
     * otherwise gives {@link QueryNode.tryDefaultReconcile} a chance before
     * replacing the state wholesale. Subclasses with non-plain state shapes
     * (for example paginated results carrying a `loadMore` function) override
     * this.
     */
    protected restoreState(next: TState | undefined): void {
        if (next === undefined) {
            this.state = undefined;
            return;
        }

        if (this.reconciler === undefined) {
            if (this.tryDefaultReconcile(next)) {
                return;
            }

            this.state = next;
            return;
        }

        const current = this.state;
        // Read from raw, write through the managed state (raw purity makes
        // the raw view proxy-free and native-speed).
        const rawCurrent =
            current !== null && typeof current === "object"
                ? ((getUnproxiedNode(current as unknown as TreeNode) ??
                      current) as typeof current)
                : current;
        const reconciled = this.reconciler.reconcile(current, next, rawCurrent);
        if (reconciled === current) {
            return;
        }

        this.state = reconciled;
    }

    /**
     * Backend-convention reconciliation used when no explicit reconciler was
     * configured. Return `true` when `next` was reconciled into the current
     * state in place. The base implementation performs no reconciliation.
     */
    protected tryDefaultReconcile(_next: TState): boolean {
        return false;
    }

    /**
     * Stop the active backend subscription.
     *
     * @remarks
     * Retree calls this automatically when the node loses its last active
     * observer. Call it manually when tearing the owner down outside Retree
     * observation. Disposing stops future backend updates; it does not clear
     * `state`, `result`, or `error`.
     *
     * Disposal is sticky: writes to the node no longer reopen the
     * subscription. The node resubscribes when it gains a new observer, or
     * when {@link QueryNode.retry} runs after an error.
     */
    public dispose(): void {
        this.isDisposed = true;
        this.closeSubscription();
    }

    /**
     * Close the active subscription without marking the node disposed.
     * Used by args churn inside {@link QueryNode.syncArgs}, which closes
     * and immediately reopens the subscription.
     */
    private closeSubscription(): void {
        if (this.subscription === null) {
            return;
        }

        this.subscription.unsubscribe();
        this.subscription = null;
        this.subscribedArgs = undefined;
    }

    /**
     * Clone a state value for optimistic rollback baselines.
     *
     * @remarks
     * The base implementation uses `structuredClone` over the raw view, which
     * supports every structured-cloneable value including `bigint` and
     * `ArrayBuffer`. Subclasses whose state carries non-cloneable members
     * (such as functions) override this.
     */
    protected cloneState(state: TState | undefined): TState | undefined {
        if (state === null) {
            return state;
        }
        if (typeof state !== "object") {
            return state;
        }

        // Clone from the raw view (raw purity makes it proxy-free) because
        // structuredClone cannot serialize Proxy objects. structuredClone
        // supports every structured-cloneable value, including bigint and
        // ArrayBuffer, which a JSON round-trip would throw on or corrupt.
        const raw = (getUnproxiedNode(state as unknown as TreeNode) ??
            state) as TState;
        return structuredClone(raw);
    }

    private markOptimisticDirty(): number {
        if (!this.isOptimisticDirty) {
            this.isOptimisticDirty = true;
            // The emitted baseline may alias objects that reconciliation wrote
            // into managed state. Detach it now — before the first optimistic
            // transform mutates state — so the rollback baseline stays clean.
            this.lastEmittedState = this.cloneState(this.lastEmittedState);
        }

        this.optimisticGeneration++;
        // The first generation in a dirty window is the oldest optimistic write
        // whose server confirmation could still arrive before newer writes.
        if (this.dirtyWindowStartGeneration === undefined) {
            this.dirtyWindowStartGeneration = this.optimisticGeneration;
        }
        return this.optimisticGeneration;
    }

    private clearOptimisticDirty(): void {
        this.isOptimisticDirty = false;
        this.dirtyWindowStartGeneration = undefined;
        this.pendingOptimisticGeneration = undefined;
    }

    private hasPendingSupersedingOptimisticMutation(): boolean {
        if (this.pendingOptimisticGeneration === undefined) {
            return false;
        }
        if (this.dirtyWindowStartGeneration === undefined) {
            return false;
        }
        // A pending generation after the window start means at least one newer
        // optimistic write is still in flight, so incoming server state may only
        // be confirming an older write in the same dirty window.
        return (
            this.pendingOptimisticGeneration > this.dirtyWindowStartGeneration
        );
    }

    /**
     * Compare an incoming emission against the last clean baseline.
     *
     * @remarks
     * The base implementation is a deep structural compare. Subclasses whose
     * state carries members that churn identity without meaning (such as a
     * `loadMore` function) override this.
     */
    protected stateEquals(
        left: TState | undefined,
        right: TState | undefined
    ): boolean {
        return deepEquals(left, right);
    }

    private toRollbackError(error: unknown): Error {
        if (error instanceof Error) {
            return error;
        }

        return new Error(
            `${
                this.queryNodeName
            }.optimisticUpdate: mutation failed with a non-Error rejection: ${String(
                error
            )}`
        );
    }
}

function getQueryOptions<TArgs, TState>(
    options: IQueryNodeOptions<TArgs, TState> | QuerySkip
): IQueryNodeOptions<TArgs, TState> | undefined {
    if (options === "skip") {
        return undefined;
    }

    return options;
}

function getInitialArgs<TArgs, TState>(
    rawOptions: IQueryNodeOptions<TArgs, TState> | QuerySkip,
    options: IQueryNodeOptions<TArgs, TState> | undefined
): TArgs | QuerySkip {
    if (rawOptions === "skip") {
        return "skip";
    }

    if (options === undefined) {
        throw new Error(
            "QueryNode: expected options with args when the node is not skipped. This is unexpected and likely a Retree bug. Please file an issue with the constructor call that triggered this."
        );
    }

    return options.args;
}

function getInitialResult<TArgs, TState>(
    rawOptions: IQueryNodeOptions<TArgs, TState> | QuerySkip,
    state: TState | undefined
): QueryNodeResult<TState> {
    if (rawOptions === "skip") {
        return { status: "skipped" };
    }

    if (state === undefined) {
        return { status: "pending" };
    }

    return { status: "success", data: state };
}
