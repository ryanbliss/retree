/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type {
    FunctionArgs,
    FunctionReturnType,
    PaginationOptions,
    PaginationResult,
} from "convex/server";
import {
    ConvexReactClient,
    type AuthTokenFetcher,
    type ConvexReactClientOptions,
} from "convex/react";
import type {
    ConvexAuthState,
    IConvexAuthClient,
    IConvexQuerySubscription,
    PaginatedQueryArgs,
    PaginatedQueryItem,
    PaginatedQueryReference,
    QueryReference,
    RetreePaginatedQueryResult,
} from "@retreejs/convex";

export * from "./preload.js";

interface IConvexReactPaginatedClient {
    watchPaginatedQuery<Query extends PaginatedQueryReference>(
        query: Query,
        args: PaginatedQueryArgs<Query>,
        options: RetreeConvexReactPaginatedWatchOptions
    ): IConvexReactWatch<RetreePaginatedQueryResult<PaginatedQueryItem<Query>>>;
}

interface RetreeConvexReactPaginatedWatchOptions {
    initialNumItems: number;
    id: number;
}

interface IConvexReactWatch<T> {
    onUpdate(callback: () => void): () => void;
    localQueryResult(): T | undefined;
}

/**
 * Convex React client adapted to Retree's Convex client interface.
 *
 * @remarks
 * Use this client anywhere you would normally create a `ConvexReactClient`,
 * including `ConvexProvider`. Pass the same instance to Retree
 * `BaseConvexNode`/`ConvexNode` classes so Retree query nodes share Convex's
 * React cache and clean up subscriptions through Retree observation.
 *
 * The client also implements Retree's observable auth surface
 * (`IConvexAuthClient`) by interposing on `setAuth`/`clearAuth`, so a
 * `ConvexAuthStateNode` can track `isLoading`/`isAuthenticated` reactively.
 */
export class RetreeConvexReactClient
    extends ConvexReactClient
    implements IConvexAuthClient
{
    private nextPaginationId = 0;
    private currentAuthState: ConvexAuthState = {
        isLoading: false,
        isAuthenticated: false,
    };
    private readonly authStateListeners = new Set<
        (authState: ConvexAuthState) => void
    >();

    constructor(address: string, options?: ConvexReactClientOptions) {
        super(address, options);
    }

    /**
     * Get the current authentication state.
     *
     * @remarks
     * Before {@link RetreeConvexReactClient.setAuth} runs, the client is
     * unauthenticated and not loading. While a token fetch started by
     * `setAuth` awaits server confirmation, `isLoading` is `true`.
     */
    public authState(): ConvexAuthState {
        return this.currentAuthState;
    }

    /**
     * Subscribe to authentication state changes.
     *
     * @param callback Called whenever `isLoading` or `isAuthenticated` change.
     * @returns Function that removes the listener.
     */
    public subscribeToAuthState(
        callback: (authState: ConvexAuthState) => void
    ): () => void {
        this.authStateListeners.add(callback);
        return () => {
            this.authStateListeners.delete(callback);
        };
    }

    /**
     * Set the authentication token fetcher, tracking the resulting auth state
     * so {@link ConvexAuthStateNode} subscribers stay current.
     */
    public setAuth(
        fetchToken: AuthTokenFetcher,
        onChange?: (isAuthenticated: boolean) => void,
        onRefreshChange?: (isRefreshing: boolean) => void
    ): void {
        // Loading until the server confirms or rejects the new credentials
        // through the onChange callback below.
        this.updateAuthState({ isLoading: true, isAuthenticated: false });
        super.setAuth(
            fetchToken,
            (isAuthenticated) => {
                this.updateAuthState({ isLoading: false, isAuthenticated });
                onChange?.(isAuthenticated);
            },
            onRefreshChange
        );
    }

    /**
     * Clear the current authentication token, resetting the observable auth
     * state to unauthenticated.
     */
    public clearAuth(): void {
        super.clearAuth();
        this.updateAuthState({ isLoading: false, isAuthenticated: false });
    }

    private updateAuthState(next: ConvexAuthState): void {
        const current = this.currentAuthState;
        if (
            next.isLoading === current.isLoading &&
            next.isAuthenticated === current.isAuthenticated
        ) {
            return;
        }

        this.currentAuthState = next;
        // Copy before iterating: listeners may unsubscribe during dispatch.
        for (const listener of [...this.authStateListeners]) {
            listener(next);
        }
    }

    public onUpdate<Query extends QueryReference>(
        query: Query,
        args: FunctionArgs<Query>,
        callback: (result: FunctionReturnType<Query>) => unknown,
        onError?: (error: Error) => unknown
    ): IConvexQuerySubscription<FunctionReturnType<Query>> {
        const watch = this.watchQuery(query, args);
        return subscribeToWatch(
            watch,
            callback,
            onError,
            "RetreeConvexReactClient.onUpdate"
        );
    }

    public onPaginatedUpdate_experimental<
        Query extends PaginatedQueryReference
    >(
        query: Query,
        args: PaginatedQueryArgs<Query>,
        options: { initialNumItems: number },
        callback: (
            result: RetreePaginatedQueryResult<PaginatedQueryItem<Query>>
        ) => unknown,
        onError?: (error: Error) => unknown
    ): IConvexQuerySubscription<
        RetreePaginatedQueryResult<PaginatedQueryItem<Query>> | undefined
    > {
        if (!hasWatchPaginatedQuery(this)) {
            throw new Error(
                "RetreeConvexReactClient.onPaginatedUpdate_experimental: ConvexReactClient does not expose watchPaginatedQuery. This Convex version cannot drive Retree paginated query nodes from the React client."
            );
        }

        const watch = this.watchPaginatedQuery(query, args, {
            initialNumItems: options.initialNumItems,
            id: this.getNextPaginationId(),
        });
        return subscribeToWatch(
            watch,
            callback,
            onError,
            "RetreeConvexReactClient.onPaginatedUpdate_experimental"
        );
    }

    private getNextPaginationId(): number {
        this.nextPaginationId += 1;
        return this.nextPaginationId;
    }
}

function subscribeToWatch<T>(
    watch: IConvexReactWatch<T>,
    callback: (result: T) => unknown,
    onError: ((error: Error) => unknown) | undefined,
    source: string
): IConvexQuerySubscription<T> {
    let isActive = true;
    const emitCurrentValue = () => {
        if (!isActive) {
            return;
        }

        const result = readCurrentValue(watch, onError, source);
        if (result === undefined) {
            return;
        }

        callback(result);
    };
    const unsubscribeWatch = watch.onUpdate(emitCurrentValue);
    const unsubscribe = () => {
        if (!isActive) {
            return;
        }

        isActive = false;
        unsubscribeWatch();
    };

    return Object.assign(unsubscribe, {
        unsubscribe,
        getCurrentValue: () => {
            if (!isActive) {
                return undefined;
            }

            return readCurrentValue(watch, onError, source);
        },
    });
}

function readCurrentValue<T>(
    watch: IConvexReactWatch<T>,
    onError: ((error: Error) => unknown) | undefined,
    source: string
): T | undefined {
    try {
        return watch.localQueryResult();
    } catch (error) {
        if (onError === undefined) {
            throw toError(error, source);
        }

        onError(toError(error, source));
        return undefined;
    }
}

function toError(error: unknown, source: string): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(
        `${source}: Convex watch failed with a non-Error value: ${String(
            error
        )}`
    );
}

function hasWatchPaginatedQuery(
    client: ConvexReactClient
): client is ConvexReactClient & IConvexReactPaginatedClient {
    if (!("watchPaginatedQuery" in client)) {
        return false;
    }

    return typeof client.watchPaginatedQuery === "function";
}

export type {
    FunctionArgs,
    FunctionReturnType,
    PaginationOptions,
    PaginationResult,
};
