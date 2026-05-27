/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, ReactiveNode } from "@retreejs/core";
import type { ConvexClient } from "convex/browser";
import type {
    FunctionArgs,
    FunctionReference,
    FunctionReturnType,
} from "convex/server";

type QueryReference = FunctionReference<"query">;
type MutationReference = FunctionReference<"mutation">;

interface IQuerySubscription<T> {
    (): void;
    unsubscribe(): void;
    getCurrentValue(): T | undefined;
}

export interface IConvexQueryClient {
    onUpdate<Query extends QueryReference>(
        query: Query,
        args: FunctionArgs<Query>,
        callback: (result: FunctionReturnType<Query>) => unknown,
        onError?: (error: Error) => unknown
    ): IQuerySubscription<FunctionReturnType<Query>>;
}

export interface IConvexMutationClient {
    mutation<Mutation extends MutationReference>(
        mutation: Mutation,
        args: FunctionArgs<Mutation>
    ): Promise<Awaited<FunctionReturnType<Mutation>>>;
}

export interface RetreeOptimisticMutation<
    Mutation extends MutationReference = MutationReference
> {
    args: FunctionArgs<Mutation>;
    promise: Promise<Awaited<FunctionReturnType<Mutation>>>;
}

export interface RetreeConvexMutationOptions<
    Mutation extends MutationReference = MutationReference
> {
    onOptimistic?: (mutation: RetreeOptimisticMutation<Mutation>) => void;
}

export interface RetreeConvexMutation<
    Mutation extends MutationReference = MutationReference
> {
    (
        args: FunctionArgs<Mutation>,
        options?: RetreeConvexMutationOptions<Mutation>
    ): Promise<Awaited<FunctionReturnType<Mutation>>>;
}

export interface IOptimisticTransform<TState> {
    apply(state: TState): void;
    revert?: (state: TState, snapshot: TState) => void;
}

export interface IStateReconciler<TState> {
    reconcile(current: TState | undefined, next: TState): TState;
}

export interface IConvexQueryNodeOptions<Query extends QueryReference> {
    args: FunctionArgs<Query>;
    initialState?: FunctionReturnType<Query>;
    reconcile?: IStateReconciler<FunctionReturnType<Query>>;
}

export function createRetreeConvexMutation<Mutation extends MutationReference>(
    client: IConvexMutationClient,
    mutation: Mutation
): RetreeConvexMutation<Mutation> {
    return (args, options) => {
        const promise = client.mutation(mutation, args);
        options?.onOptimistic?.({
            args,
            promise,
        });
        return promise;
    };
}

export function reconcileArrayById<
    TItem extends Record<TKey, PropertyKey>,
    TKey extends keyof TItem & string
>(idKey: TKey): IStateReconciler<TItem[]> {
    return {
        reconcile(current, next) {
            if (current === undefined) {
                return next;
            }

            reconcileArray(current, next, (item) => item[idKey]);
            return current;
        },
    };
}

export function reconcileConvexDocuments<
    TDoc extends { _id: PropertyKey }
>(): IStateReconciler<TDoc[]> {
    return reconcileArrayById<TDoc, "_id">("_id");
}

function tryReconcileConvexDocuments(current: unknown, next: unknown): boolean {
    if (!isConvexDocumentArray(current)) {
        return false;
    }
    if (!isConvexDocumentArray(next)) {
        return false;
    }

    reconcileDocumentArrayById(current, next);
    return true;
}

function isConvexDocumentArray(
    value: unknown
): value is Array<Record<"_id", PropertyKey>> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const item of value) {
        if (!isRecordWithPropertyKeyId(item)) {
            return false;
        }
    }

    return true;
}

function isRecordWithPropertyKeyId(
    value: unknown
): value is Record<"_id", PropertyKey> {
    if (value === null) {
        return false;
    }
    if (typeof value !== "object") {
        return false;
    }

    const id = Reflect.get(value, "_id");
    if (typeof id === "string") {
        return true;
    }
    if (typeof id === "number") {
        return true;
    }
    return typeof id === "symbol";
}

function reconcileDocumentArrayById(
    current: Array<Record<"_id", PropertyKey>>,
    next: Array<Record<"_id", PropertyKey>>
): void {
    reconcileArray(current, next, (item) => item._id);
}

function reconcileArray<TItem extends object>(
    current: TItem[],
    next: TItem[],
    getId: (item: TItem) => PropertyKey
): void {
    if (current.length === next.length) {
        let allItemsStayedInPlace = true;
        for (let index = 0; index < next.length; index++) {
            const currentItem = current[index];
            const nextItem = next[index];
            if (getId(currentItem) !== getId(nextItem)) {
                allItemsStayedInPlace = false;
                break;
            }

            reconcileObject(currentItem, nextItem);
        }

        if (allItemsStayedInPlace) {
            return;
        }
    }

    const currentById = new Map<PropertyKey, TItem>();
    for (const currentItem of current) {
        currentById.set(getId(currentItem), currentItem);
    }

    for (let index = 0; index < next.length; index++) {
        const nextItem = next[index];
        const currentItem = currentById.get(getId(nextItem));
        if (currentItem === undefined) {
            current[index] = nextItem;
            continue;
        }

        reconcileObject(currentItem, nextItem);
        if (getId(current[index]) === getId(currentItem)) {
            continue;
        }

        current[index] = currentItem;
    }

    current.length = next.length;
}

function reconcileObject<T extends object>(target: T, source: T): void {
    for (const key of Object.keys(target)) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            Reflect.deleteProperty(target, key);
        }
    }

    for (const [key, value] of Object.entries(source)) {
        Reflect.set(target, key, value);
    }
}

export type ConvexQueryNodeState<Query extends QueryReference> =
    | FunctionReturnType<Query>
    | undefined;

export class ConvexQueryNode<
    Query extends QueryReference
> extends ReactiveNode {
    @ignore
    private client: IConvexQueryClient;
    @ignore
    private query: Query;
    @ignore
    private args: FunctionArgs<Query>;
    @ignore
    private unsubscribe: IQuerySubscription<FunctionReturnType<Query>> | null =
        null;
    @ignore
    private reconciler: IStateReconciler<FunctionReturnType<Query>> | undefined;

    public state: ConvexQueryNodeState<Query>;
    public error: Error | null = null;
    private lastEmittedState: ConvexQueryNodeState<Query>;

    constructor(
        client: Pick<ConvexClient, "onUpdate">,
        query: Query,
        options: IConvexQueryNodeOptions<Query>
    ) {
        super();
        this.client = client;
        this.query = query;
        this.args = options.args;
        this.reconciler = options.reconcile;
        this.state = options.initialState;
        this.lastEmittedState = this.cloneState(options.initialState);
    }

    get dependencies() {
        // Retree calls this getter when the node is observed. Starting the
        // subscription here makes Convex callbacks write through the proxied node
        // instead of the raw constructor instance, so `state` updates emit.
        this.updateArgs(this.args);
        return [];
    }

    public updateArgs(args: FunctionArgs<Query>): void {
        this.args = args;
        this.memo(
            "updateArgs",
            () => {
                this.dispose();
                const subscription = this.client.onUpdate(
                    this.query,
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

    public async applyOptimisticMutation(
        mutation: RetreeOptimisticMutation,
        transform?: IOptimisticTransform<FunctionReturnType<Query>>
    ): Promise<void> {
        const snapshot =
            this.state === undefined ? undefined : this.cloneState(this.state);
        if (this.state !== undefined && transform !== undefined) {
            transform.apply(this.state);
        }

        try {
            await mutation.promise;
        } catch (error) {
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
                          `ConvexQueryNode.applyOptimisticMutation: mutation failed with a non-Error rejection: ${String(
                              error
                          )}`
                      );
        }
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
