/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type {
    FunctionArgs,
    FunctionReference,
    FunctionReturnType,
    PaginationOptions,
    PaginationResult,
} from "convex/server";
import type { ConnectionState, PaginationStatus } from "convex/browser";
import type { IStateReconciler } from "@retreejs/query";

// The reconciler protocol moved to @retreejs/query (spec §6.2 AsyncQueryNode
// extraction); re-exported here so existing imports keep working.
export type { IStateReconciler } from "@retreejs/query";

/**
 * Convex query function reference accepted by Retree Convex query helpers.
 */
export type QueryReference = FunctionReference<"query">;

/**
 * Convex action function reference accepted by Retree Convex action helpers.
 */
export type ActionReference = FunctionReference<"action">;

/**
 * Convex mutation function reference accepted by Retree Convex mutation helpers.
 */
export type MutationReference = FunctionReference<"mutation">;

/**
 * Convex paginated query reference accepted by Retree Convex pagination helpers.
 */
export type PaginatedQueryReference = FunctionReference<
    "query",
    "public",
    {
        paginationOpts: PaginationOptions;
    },
    PaginationResult<unknown>
>;

/**
 * Arguments for a paginated Convex query, excluding Convex's injected
 * `paginationOpts` argument.
 */
export type PaginatedQueryArgs<Query extends PaginatedQueryReference> = Omit<
    FunctionArgs<Query>,
    "paginationOpts"
>;

/**
 * Item returned by a paginated Convex query page.
 */
export type PaginatedQueryItem<Query extends PaginatedQueryReference> =
    FunctionReturnType<Query>["page"][number];

/**
 * Client-side aggregate result for a Convex paginated query.
 */
export interface RetreePaginatedQueryResult<TItem> {
    /**
     * Items loaded across all currently loaded pages.
     */
    results: TItem[];
    /**
     * Current pagination status.
     */
    status: PaginationStatus;
    /**
     * Request additional items.
     */
    loadMore(numItems: number): boolean;
}

/**
 * String used by Convex React to disable a query subscription.
 */
export type ConvexQuerySkip = "skip";

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

    /**
     * Subscribe to a paginated Convex query and receive emitted values.
     *
     * @param query Convex paginated query function reference.
     * @param args Query arguments excluding `paginationOpts`.
     * @param options Paginated query options.
     * @param callback Called when Convex emits a new paginated query result.
     * @param onError Optional callback for subscription errors.
     * @returns Subscription handle used by {@link ConvexPaginatedQueryNode.dispose}.
     */
    onPaginatedUpdate_experimental<Query extends PaginatedQueryReference>(
        query: Query,
        args: PaginatedQueryArgs<Query>,
        options: { initialNumItems: number },
        callback: (
            result: RetreePaginatedQueryResult<PaginatedQueryItem<Query>>
        ) => unknown,
        onError?: (error: Error) => unknown
    ): IConvexQuerySubscription<
        RetreePaginatedQueryResult<PaginatedQueryItem<Query>> | undefined
    >;
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
 * Minimal Convex client action surface needed by Retree Convex action helpers.
 */
export interface IConvexActionClient {
    /**
     * Run a Convex action.
     *
     * @param action Convex action function reference.
     * @param args Action arguments.
     * @returns Promise for the Convex action result.
     */
    action<Action extends ActionReference>(
        action: Action,
        args: FunctionArgs<Action>
    ): Promise<Awaited<FunctionReturnType<Action>>>;
}

/**
 * Minimal Convex client one-off query surface needed by {@link ConvexNode}.
 */
export interface IConvexQueryOnceClient {
    /**
     * Run a Convex query once without subscribing.
     *
     * @param query Convex query function reference.
     * @param args Query arguments.
     * @returns Promise for the Convex query result.
     */
    query<Query extends QueryReference>(
        query: Query,
        args: FunctionArgs<Query>
    ): Promise<Awaited<FunctionReturnType<Query>>>;
}

/**
 * Minimal Convex client connection-state surface needed by
 * {@link ConvexConnectionStateNode}.
 */
export interface IConvexConnectionClient {
    /**
     * Get the current connection state.
     */
    connectionState(): ConnectionState;
    /**
     * Subscribe to connection state changes.
     */
    subscribeToConnectionState(
        callback: (connectionState: ConnectionState) => void
    ): () => void;
}

/**
 * Reactive snapshot of a Convex client's authentication status.
 */
export interface ConvexAuthState {
    /**
     * True while an auth token fetch started by `setAuth` is in flight and the
     * server has not confirmed or rejected the credentials yet.
     */
    isLoading: boolean;
    /**
     * True once the Convex server has validated the current credentials.
     */
    isAuthenticated: boolean;
}

/**
 * Minimal Convex client auth surface needed by {@link ConvexAuthStateNode}.
 *
 * @remarks
 * Convex clients only expose auth changes through the `onChange` callback of
 * `setAuth`, so this surface is implemented by adapter clients (such as
 * `RetreeConvexReactClient` in `@retreejs/react-convex`) that interpose on
 * `setAuth`/`clearAuth` to make auth state observable. It is deliberately not
 * part of {@link IConvexClient}: existing client implementations stay valid.
 */
export interface IConvexAuthClient {
    /**
     * Get the current authentication state.
     */
    authState(): ConvexAuthState;
    /**
     * Subscribe to authentication state changes.
     *
     * @returns Function that removes the listener.
     */
    subscribeToAuthState(
        callback: (authState: ConvexAuthState) => void
    ): () => void;
}

/**
 * Minimal Convex client surface accepted by {@link ConvexNode}.
 */
export interface IConvexClient
    extends IConvexQueryClient,
        IConvexMutationClient,
        IConvexActionClient,
        IConvexQueryOnceClient,
        IConvexConnectionClient {
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
 * Typed function wrapper around a Convex action.
 */
export interface RetreeConvexAction<
    Action extends ActionReference = ActionReference
> {
    /**
     * Run the Convex action.
     *
     * @param args Action arguments.
     * @returns Promise for the Convex action result.
     */
    (...args: OptionalConvexArgs<Action>): Promise<
        Awaited<FunctionReturnType<Action>>
    >;
}

/**
 * Optional argument tuple for no-args Convex functions.
 */
export type OptionalConvexArgs<
    FuncRef extends FunctionReference<"query" | "action">
> = FunctionArgs<FuncRef> extends Record<string, never>
    ? [args?: FunctionArgs<FuncRef>]
    : [args: FunctionArgs<FuncRef>];

/**
 * Imperative optimistic state transform for a {@link ConvexQueryNode}.
 */
export interface IOptimisticTransform<
    TState,
    Mutation extends MutationReference = MutationReference
> {
    /**
     * Optional mutation context. When provided, Retree Convex rolls this
     * optimistic state back if the mutation promise rejects before a newer
     * server value resolves the dirty state.
     */
    ctx?: OptimisticUpdateContext<Mutation>;
    /**
     * Apply an optimistic change to the current query state.
     */
    apply(state: TState): void;
    /**
     * Optional custom rollback. When omitted, Retree Convex restores the
     * latest clean server baseline at rejection time — including any server
     * confirmations that arrived after {@link IOptimisticTransform.apply}
     * ran, so a failed mutation never wipes a confirmed one.
     */
    revert?: (state: TState, snapshot: TState) => void;
}

/**
 * Result metadata for a {@link ConvexQueryNode}.
 */
export type ConvexQueryNodeResult<Query extends QueryReference> =
    | { status: "pending" }
    | { status: "skipped" }
    | {
          status: "success";
          data: FunctionReturnType<Query>;
          /**
           * True while `updateArgs` keeps the previous data visible
           * (`keepPreviousData`) and the new subscription has not emitted yet.
           */
          isStale?: boolean;
      }
    | { status: "error"; error: Error };

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
              /**
               * Keep the previous `state` visible (with `result.isStale` set to
               * `true`) while a subscription opened by `updateArgs` loads,
               * instead of resetting to `"pending"`.
               */
              keepPreviousData?: boolean;
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
              /**
               * Keep the previous `state` visible (with `result.isStale` set to
               * `true`) while a subscription opened by `updateArgs` loads,
               * instead of resetting to `"pending"`.
               */
              keepPreviousData?: boolean;
          };

/**
 * Arguments accepted by {@link ConvexQueryNode.updateArgs}.
 */
export type ConvexQueryArgs<Query extends QueryReference> =
    | FunctionArgs<Query>
    | ConvexQuerySkip;

/**
 * Constructor options tuple for {@link ConvexQueryNode}.
 */
export type ConvexQueryNodeOptionsArgs<Query extends QueryReference> =
    FunctionArgs<Query> extends Record<string, never>
        ? [options?: IConvexQueryNodeOptions<Query> | ConvexQuerySkip]
        : [options: IConvexQueryNodeOptions<Query> | ConvexQuerySkip];

/**
 * Public state field type for {@link ConvexQueryNode}.
 */
export type ConvexQueryNodeState<Query extends QueryReference> =
    | FunctionReturnType<Query>
    | undefined;

/**
 * Result metadata for a {@link ConvexPaginatedQueryNode}.
 */
export type ConvexPaginatedQueryNodeResult<
    Query extends PaginatedQueryReference
> =
    | { status: "pending" }
    | { status: "skipped" }
    | {
          status: "success";
          data: RetreePaginatedQueryResult<PaginatedQueryItem<Query>>;
      }
    | { status: "error"; error: Error };

/**
 * Constructor options for {@link ConvexPaginatedQueryNode}.
 */
export type IConvexPaginatedQueryNodeOptions<
    Query extends PaginatedQueryReference
> = PaginatedQueryArgs<Query> extends Record<string, never>
    ? {
          /**
           * Initial arguments for the Convex query, excluding `paginationOpts`.
           */
          args?: PaginatedQueryArgs<Query>;
          /**
           * Number of items to request for the first page.
           */
          initialNumItems: number;
          /**
           * Optional state to expose before Convex emits a value.
           */
          initialState?: RetreePaginatedQueryResult<PaginatedQueryItem<Query>>;
      }
    : {
          /**
           * Initial arguments for the Convex query, excluding `paginationOpts`.
           */
          args: PaginatedQueryArgs<Query>;
          /**
           * Number of items to request for the first page.
           */
          initialNumItems: number;
          /**
           * Optional state to expose before Convex emits a value.
           */
          initialState?: RetreePaginatedQueryResult<PaginatedQueryItem<Query>>;
      };

/**
 * Constructor options tuple for {@link ConvexPaginatedQueryNode}.
 */
export type ConvexPaginatedQueryNodeOptionsArgs<
    Query extends PaginatedQueryReference
> = PaginatedQueryArgs<Query> extends Record<string, never>
    ? [options: IConvexPaginatedQueryNodeOptions<Query> | ConvexQuerySkip]
    : [options: IConvexPaginatedQueryNodeOptions<Query> | ConvexQuerySkip];

/**
 * Arguments accepted by {@link ConvexPaginatedQueryNode.updateArgs}.
 */
export type ConvexPaginatedQueryArgs<Query extends PaginatedQueryReference> =
    | PaginatedQueryArgs<Query>
    | ConvexQuerySkip;

/**
 * Public state field type for {@link ConvexPaginatedQueryNode}.
 */
export type ConvexPaginatedQueryNodeState<
    Query extends PaginatedQueryReference
> = RetreePaginatedQueryResult<PaginatedQueryItem<Query>> | undefined;
