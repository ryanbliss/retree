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
import { ConvexReactClient, type ConvexReactClientOptions } from "convex/react";
import type {
    IConvexQuerySubscription,
    PaginatedQueryArgs,
    PaginatedQueryItem,
    PaginatedQueryReference,
    QueryReference,
    RetreePaginatedQueryResult,
} from "@retreejs/convex";

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
 */
export class RetreeConvexReactClient extends ConvexReactClient {
    private nextPaginationId = 0;

    constructor(address: string, options?: ConvexReactClientOptions) {
        super(address, options);
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
