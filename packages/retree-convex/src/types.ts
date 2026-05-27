/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type {
    FunctionArgs,
    FunctionReference,
    FunctionReturnType,
} from "convex/server";

/**
 * Convex query function reference accepted by Retree Convex query helpers.
 */
export type QueryReference = FunctionReference<"query">;

/**
 * Convex mutation function reference accepted by Retree Convex mutation helpers.
 */
export type MutationReference = FunctionReference<"mutation">;

/**
 * Subscription handle returned by a Convex query client.
 */
export interface IConvexQuerySubscription<T> {
    (): void;
    /**
     * Stop listening to query updates.
     */
    unsubscribe(): void;
    /**
     * Get the latest synchronously available query value, if Convex has one.
     */
    getCurrentValue(): T | undefined;
}

/**
 * Minimal Convex client query surface needed by {@link ConvexQueryNode}.
 */
export interface IConvexQueryClient {
    /**
     * Subscribe to a Convex query and receive emitted values.
     *
     * @param query Convex query function reference.
     * @param args Query arguments.
     * @param callback Called when Convex emits a new query result.
     * @param onError Optional callback for subscription errors.
     * @returns Subscription handle used by {@link ConvexQueryNode.dispose}.
     */
    onUpdate<Query extends QueryReference>(
        query: Query,
        args: FunctionArgs<Query>,
        callback: (result: FunctionReturnType<Query>) => unknown,
        onError?: (error: Error) => unknown
    ): IConvexQuerySubscription<FunctionReturnType<Query>>;
}

/**
 * Minimal Convex client mutation surface needed by Retree Convex mutation helpers.
 */
export interface IConvexMutationClient {
    /**
     * Run a Convex mutation.
     *
     * @param mutation Convex mutation function reference.
     * @param args Mutation arguments.
     * @returns Promise for the Convex mutation result.
     */
    mutation<Mutation extends MutationReference>(
        mutation: Mutation,
        args: FunctionArgs<Mutation>
    ): Promise<Awaited<FunctionReturnType<Mutation>>>;
}

/**
 * Minimal Convex client surface accepted by {@link ConvexNode}.
 */
export interface IConvexClient
    extends IConvexQueryClient,
        IConvexMutationClient {
    /**
     * Close the underlying Convex client.
     */
    close(): Promise<void>;
}

/**
 * Context passed to optimistic update handlers.
 */
export interface OptimisticUpdateContext<
    Mutation extends MutationReference = MutationReference
> {
    /**
     * Arguments passed to the mutation.
     */
    args: FunctionArgs<Mutation>;
    /**
     * Promise returned by the Convex mutation.
     */
    promise: Promise<Awaited<FunctionReturnType<Mutation>>>;
}

/**
 * Options accepted by a Retree Convex mutation function.
 */
export interface RetreeConvexMutationOptions<
    Mutation extends MutationReference = MutationReference
> {
    /**
     * Called after the mutation promise is created so query nodes can apply an
     * optimistic update and subscribe to the mutation outcome.
     */
    withOptimisticUpdate?: (ctx: OptimisticUpdateContext<Mutation>) => void;
}

/**
 * Typed function wrapper around a Convex mutation.
 */
export interface RetreeConvexMutation<
    Mutation extends MutationReference = MutationReference
> {
    /**
     * Run the Convex mutation.
     *
     * @param args Mutation arguments.
     * @param options Optional optimistic update hook.
     * @returns Promise for the Convex mutation result.
     */
    (
        args: FunctionArgs<Mutation>,
        options?: RetreeConvexMutationOptions<Mutation>
    ): Promise<Awaited<FunctionReturnType<Mutation>>>;
}

/**
 * Imperative optimistic state transform for a {@link ConvexQueryNode}.
 */
export interface IOptimisticTransform<TState> {
    /**
     * Apply an optimistic change to the current query state.
     */
    apply(state: TState): void;
    /**
     * Optional custom rollback. When omitted, Retree Convex restores a snapshot
     * captured before {@link IOptimisticTransform.apply} ran.
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
     * @param current Current query state, if any.
     * @param next Newly emitted query state.
     * @returns The state object that should be assigned to the query node.
     */
    reconcile(current: TState | undefined, next: TState): TState;
}

/**
 * Constructor options for {@link ConvexQueryNode}.
 */
export type IConvexQueryNodeOptions<Query extends QueryReference> =
    FunctionArgs<Query> extends Record<string, never>
        ? {
              /**
               * Initial arguments for the Convex query.
               */
              args?: FunctionArgs<Query>;
              /**
               * Optional state to expose before Convex emits a value.
               */
              initialState?: FunctionReturnType<Query>;
              /**
               * Optional custom reconciler for retaining existing object identities when
               * new query results arrive.
               */
              reconcile?: IStateReconciler<FunctionReturnType<Query>>;
          }
        : {
              /**
               * Initial arguments for the Convex query.
               */
              args: FunctionArgs<Query>;
              /**
               * Optional state to expose before Convex emits a value.
               */
              initialState?: FunctionReturnType<Query>;
              /**
               * Optional custom reconciler for retaining existing object identities when
               * new query results arrive.
               */
              reconcile?: IStateReconciler<FunctionReturnType<Query>>;
          };

/**
 * Constructor options tuple for {@link ConvexQueryNode}.
 */
export type ConvexQueryNodeOptionsArgs<Query extends QueryReference> =
    FunctionArgs<Query> extends Record<string, never>
        ? [options?: IConvexQueryNodeOptions<Query>]
        : [options: IConvexQueryNodeOptions<Query>];

/**
 * Public state field type for {@link ConvexQueryNode}.
 */
export type ConvexQueryNodeState<Query extends QueryReference> =
    | FunctionReturnType<Query>
    | undefined;
