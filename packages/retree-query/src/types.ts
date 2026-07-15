/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * String sentinel used to disable a query subscription.
 */
export type QuerySkip = "skip";

/**
 * Subscription handle returned by an {@link IQuerySubscriptionSource}.
 */
export interface IQuerySubscriptionHandle<TValue> {
    /**
     * Stop listening to query updates.
     */
    unsubscribe(): void;
    /**
     * Get the latest synchronously available query value, if the backend has
     * one cached. Return `undefined` when no synchronous value exists.
     */
    getCurrentValue(): TValue | undefined;
}

/**
 * Minimal backend surface a {@link QueryNode} subscribes through.
 *
 * @remarks
 * Implement this to drive a {@link QueryNode} from any async backend: a
 * realtime sync client, a fetch poller, a WebSocket topic, and so on. The
 * source is subscribed when the node gains its first Retree observer and
 * unsubscribed when it loses its last one.
 *
 * `subscribe` may surface a synchronously cached error by calling `onError`
 * from inside `getCurrentValue()`; the node keeps that error visible instead
 * of resetting to pending.
 */
export interface IQuerySubscriptionSource<TArgs, TValue> {
    /**
     * Open a subscription for the given arguments.
     *
     * @param args Query arguments.
     * @param onValue Called when the backend emits a new query value.
     * @param onError Called when the backend emits a subscription error.
     * @returns Handle used to read cached values and stop the subscription.
     */
    subscribe(
        args: TArgs,
        onValue: (value: TValue) => void,
        onError: (error: Error) => void
    ): IQuerySubscriptionHandle<TValue>;
}

/**
 * Minimal mutation context consumed by {@link QueryNode.optimisticUpdate}.
 *
 * @remarks
 * Backends attach richer contexts (for example Convex mutation args); the
 * generic optimistic machinery only needs the outcome promise.
 */
export interface IOptimisticUpdateContext<TResult = unknown> {
    /**
     * Promise for the mutation outcome. Rejection triggers rollback unless a
     * newer server value resolves the dirty state first.
     */
    promise: Promise<TResult>;
}

/**
 * Imperative optimistic state transform for a {@link QueryNode}.
 */
export interface IOptimisticQueryTransform<TState> {
    /**
     * Optional mutation context. When provided, the node rolls this
     * optimistic state back if the promise rejects before a newer server
     * value resolves the dirty state.
     */
    ctx?: IOptimisticUpdateContext;
    /**
     * Apply an optimistic change to the current query state.
     */
    apply(state: TState): void;
    /**
     * Optional custom rollback. When omitted, the node restores the latest
     * clean server baseline at rejection time — including any server
     * confirmations that arrived after {@link IOptimisticQueryTransform.apply}
     * ran, so a failed mutation never wipes a confirmed one.
     */
    revert?: (state: TState, snapshot: TState) => void;
}

/**
 * Reconciles an incoming query value against the current node state.
 */
export interface IStateReconciler<TState> {
    /**
     * Reconcile `next` into `current`.
     *
     * @remarks
     * Reconciliation is read-dominated: it compares every field and writes
     * only the diffs. **Read from `rawCurrent`, write to `current`.**
     * `rawCurrent` is the raw object behind `current` (`Retree.raw`) —
     * native-speed, proxy-free reads. Writes must go through `current` so
     * changed rows emit `nodeChanged` and item identity stays stable for
     * `useNode` rows; writes to `rawCurrent` skip emission entirely.
     *
     * @param current Current query state, if any. Write surface.
     * @param next Newly emitted query state (raw server data).
     * @param rawCurrent Raw view of `current` for fast reads; `undefined`
     * when `current` is `undefined` or not object-valued.
     * @returns The state object that should be assigned to the query node.
     */
    reconcile(
        current: TState | undefined,
        next: TState,
        rawCurrent?: TState
    ): TState;
}

/**
 * Result metadata for a {@link QueryNode}.
 */
export type QueryNodeResult<TState> =
    | { status: "pending" }
    | { status: "skipped" }
    | {
          status: "success";
          data: TState;
          /**
           * True while `updateArgs` keeps the previous data visible
           * (`keepPreviousData`) and the new subscription has not emitted yet.
           */
          isStale?: boolean;
      }
    | { status: "error"; error: Error };

/**
 * Constructor options for {@link QueryNode}.
 */
export interface IQueryNodeOptions<TArgs, TState> {
    /**
     * Initial arguments for the query subscription.
     *
     * @remarks
     * Must not be `undefined`: the node uses `undefined` internally to mean
     * "no subscription yet". Use an empty object for argument-less queries.
     */
    args: TArgs;
    /**
     * Optional state to expose before the source emits a value.
     */
    initialState?: TState;
    /**
     * Optional custom reconciler for retaining existing object identities when
     * new query results arrive.
     */
    reconcile?: IStateReconciler<TState>;
    /**
     * Keep the previous `state` visible (with `result.isStale` set to
     * `true`) while a subscription opened by `updateArgs` loads,
     * instead of resetting to `"pending"`.
     */
    keepPreviousData?: boolean;
}

/**
 * Public state field type for {@link QueryNode}.
 */
export type QueryNodeState<TState> = TState | undefined;
