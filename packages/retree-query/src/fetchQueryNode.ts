/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { QueryNode } from "./QueryNode.js";
import {
    IQueryNodeOptions,
    IQuerySubscriptionSource,
    IStateReconciler,
    QuerySkip,
} from "./types.js";

/**
 * Options for {@link createFetchQuerySource}.
 */
export interface IFetchQuerySourceOptions {
    /**
     * Poll interval in milliseconds. When set, the source re-runs the fetch
     * function on this interval for as long as the subscription is open. When
     * omitted, the source fetches once per subscription.
     */
    refetchInterval?: number;
}

/**
 * Constructor options for {@link fetchQueryNode}.
 */
export type IFetchQueryNodeOptions<TArgs, TState> = TArgs extends Record<
    string,
    never
>
    ? {
          /**
           * Initial arguments passed to the fetch function.
           */
          args?: TArgs;
          /**
           * Optional state to expose before the first fetch resolves.
           */
          initialState?: TState;
          /**
           * Optional custom reconciler for retaining existing object
           * identities when new results arrive.
           */
          reconcile?: IStateReconciler<TState>;
          /**
           * Keep the previous `state` visible (with `result.isStale`) while
           * a subscription opened by `updateArgs` loads.
           */
          keepPreviousData?: boolean;
          /**
           * Poll interval in milliseconds. Omit for one fetch per
           * subscription.
           */
          refetchInterval?: number;
      }
    : {
          /**
           * Initial arguments passed to the fetch function.
           */
          args: TArgs;
          /**
           * Optional state to expose before the first fetch resolves.
           */
          initialState?: TState;
          /**
           * Optional custom reconciler for retaining existing object
           * identities when new results arrive.
           */
          reconcile?: IStateReconciler<TState>;
          /**
           * Keep the previous `state` visible (with `result.isStale`) while
           * a subscription opened by `updateArgs` loads.
           */
          keepPreviousData?: boolean;
          /**
           * Poll interval in milliseconds. Omit for one fetch per
           * subscription.
           */
          refetchInterval?: number;
      };

/**
 * Constructor options tuple for {@link fetchQueryNode}.
 */
export type FetchQueryNodeOptionsArgs<TArgs, TState> = TArgs extends Record<
    string,
    never
>
    ? [options?: IFetchQueryNodeOptions<TArgs, TState> | QuerySkip]
    : [options: IFetchQueryNodeOptions<TArgs, TState> | QuerySkip];

/**
 * Adapt an async function into an {@link IQuerySubscriptionSource}.
 *
 * @remarks
 * Each subscription runs the fetch function once immediately and, when
 * `refetchInterval` is set, again on every interval tick. Results and errors
 * that resolve after the subscription is closed are dropped.
 *
 * @param fetchFn Async function producing a query value for the given args.
 * @param options Optional polling configuration.
 * @returns A subscription source usable with {@link QueryNode}.
 */
export function createFetchQuerySource<TArgs, TState>(
    fetchFn: (args: TArgs) => Promise<TState>,
    options?: IFetchQuerySourceOptions
): IQuerySubscriptionSource<TArgs, TState> {
    const refetchInterval = options?.refetchInterval;
    if (refetchInterval !== undefined && refetchInterval <= 0) {
        throw new Error(
            "createFetchQuerySource: expected refetchInterval to be greater than 0 milliseconds."
        );
    }

    return {
        subscribe(args, onValue, onError) {
            let isActive = true;
            const runFetch = () => {
                fetchFn(args).then(
                    (value) => {
                        if (!isActive) {
                            return;
                        }
                        onValue(value);
                    },
                    (error: unknown) => {
                        if (!isActive) {
                            return;
                        }
                        onError(toFetchError(error));
                    }
                );
            };
            runFetch();
            let timer: ReturnType<typeof setInterval> | undefined;
            if (refetchInterval !== undefined) {
                timer = setInterval(runFetch, refetchInterval);
            }

            return {
                unsubscribe() {
                    isActive = false;
                    if (timer !== undefined) {
                        clearInterval(timer);
                    }
                },
                getCurrentValue: () => undefined,
            };
        },
    };
}

/**
 * Create a {@link QueryNode} driven by a plain async function.
 *
 * @remarks
 * This is the smallest possible backend adapter: one-shot (or polled) fetches
 * flow through the same status machine, args lifecycle, reconciliation, and
 * optimistic-update machinery as realtime backends. Subscription lifecycle
 * follows Retree observation — the fetch runs when the node gains its first
 * observer, and `retry()` re-fetches after an error.
 *
 * @param source Async function producing a query value for the given args.
 * @param options Query arguments, polling interval, and node options — or
 * `"skip"` to start disabled.
 * @returns A query node subscribed to the fetch source.
 *
 * @example
 * ```ts
 * const weather = Retree.root(
 *     fetchQueryNode(
 *         (args: { city: string }) => fetchWeather(args.city),
 *         { args: { city: "Seattle" }, refetchInterval: 60_000 }
 *     )
 * );
 * ```
 */
export function fetchQueryNode<TState, TArgs = Record<string, never>>(
    source: (args: TArgs) => Promise<TState>,
    ...options: FetchQueryNodeOptionsArgs<TArgs, TState>
): QueryNode<TArgs, TState> {
    const rawOptions = options[0];
    const fetchOptions = getFetchOptions(rawOptions);
    const fetchSource = createFetchQuerySource(source, {
        refetchInterval: fetchOptions?.refetchInterval,
    });
    return new QueryNode(fetchSource, getNodeOptions(rawOptions, fetchOptions));
}

function toFetchError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(
        `createFetchQuerySource: query source rejected with a non-Error value: ${String(
            error
        )}`
    );
}

function getFetchOptions<TArgs, TState>(
    rawOptions: IFetchQueryNodeOptions<TArgs, TState> | QuerySkip | undefined
): IFetchQueryNodeOptions<TArgs, TState> | undefined {
    if (rawOptions === "skip") {
        return undefined;
    }

    return rawOptions;
}

function getNodeOptions<TArgs, TState>(
    rawOptions: IFetchQueryNodeOptions<TArgs, TState> | QuerySkip | undefined,
    options: IFetchQueryNodeOptions<TArgs, TState> | undefined
): IQueryNodeOptions<TArgs, TState> | QuerySkip {
    if (rawOptions === "skip") {
        return "skip";
    }

    return {
        args: getFetchArgs(options),
        initialState: options?.initialState,
        reconcile: options?.reconcile,
        keepPreviousData: options?.keepPreviousData,
    };
}

function getFetchArgs<TArgs, TState>(
    options: IFetchQueryNodeOptions<TArgs, TState> | undefined
): TArgs {
    const args = options?.args;
    if (args !== undefined) {
        return args;
    }

    // Argument-less fetch nodes default TArgs to Record<string, never>, so an
    // empty object is the correct runtime value; TypeScript cannot prove it
    // for the unresolved generic.
    return {} as TArgs;
}
