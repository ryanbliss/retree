import { describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import type {
    FunctionArgs,
    FunctionReference,
    FunctionReturnType,
    PaginationOptions,
    PaginationResult,
} from "convex/server";
import type { ConnectionState } from "convex/browser";
import {
    ActionReference,
    ConvexPaginatedQueryNode,
    IConvexClient,
    IConvexQuerySubscription,
    PaginatedQueryArgs,
    PaginatedQueryItem,
    PaginatedQueryReference,
    RetreePaginatedQueryResult,
} from "./index.js";

type PaginatedDocsQuery = FunctionReference<
    "query",
    "public",
    { listId: string; paginationOpts: PaginationOptions },
    PaginationResult<{ _id: string; text: string; isCompleted: boolean }>
>;

const paginatedDocsQuery: PaginatedDocsQuery = {
    _type: "query",
    _visibility: "public",
    _args: {
        listId: "",
        paginationOpts: {} as PaginationOptions,
    },
    _returnType: {
        page: [],
        isDone: false,
        continueCursor: "",
    },
    _componentPath: undefined,
};

const connectedState: ConnectionState = {
    hasInflightRequests: false,
    isWebSocketConnected: true,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    connectionRetries: 0,
    inflightMutations: 0,
    inflightActions: 0,
};

type PaginatedDoc = PaginatedQueryItem<PaginatedDocsQuery>;

class FakePaginatedConvexClient implements IConvexClient {
    public readonly paginatedSubscriptions: {
        args: unknown;
        callback: (result: RetreePaginatedQueryResult<PaginatedDoc>) => unknown;
        onError: ((error: Error) => unknown) | undefined;
        unsubscribe: ReturnType<typeof vi.fn>;
    }[] = [];

    public onUpdate(): never {
        throw new Error(
            "FakePaginatedConvexClient does not support plain query subscriptions."
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
        const knownPaginatedQueries: readonly unknown[] = [paginatedDocsQuery];
        if (!knownPaginatedQueries.includes(query)) {
            throw new Error(
                "FakePaginatedConvexClient received an unexpected paginated query."
            );
        }
        if (options.initialNumItems <= 0) {
            throw new Error(
                "FakePaginatedConvexClient expected a positive initialNumItems value."
            );
        }

        const unsubscribe = vi.fn();
        this.paginatedSubscriptions.push({
            args,
            // The guard above proves Query is PaginatedDocsQuery; TypeScript
            // cannot narrow the generic from the identity check.
            callback: callback as (
                result: RetreePaginatedQueryResult<PaginatedDoc>
            ) => unknown,
            onError,
            unsubscribe,
        });
        return Object.assign(unsubscribe, {
            unsubscribe,
            getCurrentValue: () => undefined,
        });
    }

    public mutation<Mutation extends FunctionReference<"mutation">>(): Promise<
        Awaited<FunctionReturnType<Mutation>>
    > {
        throw new Error(
            "FakePaginatedConvexClient does not support mutations."
        );
    }

    public action<Action extends ActionReference>(): Promise<
        Awaited<FunctionReturnType<Action>>
    > {
        throw new Error("FakePaginatedConvexClient does not support actions.");
    }

    public query<Query extends FunctionReference<"query">>(): Promise<
        Awaited<FunctionReturnType<Query>>
    > {
        throw new Error(
            "FakePaginatedConvexClient does not support one-off queries."
        );
    }

    public connectionState(): ConnectionState {
        return connectedState;
    }

    public subscribeToConnectionState(): () => void {
        return vi.fn();
    }

    public close(): Promise<void> {
        return Promise.resolve();
    }
}

function subscribePaginatedNode(client: FakePaginatedConvexClient) {
    const node = Retree.root(
        new ConvexPaginatedQueryNode(client, paginatedDocsQuery, {
            args: { listId: "today" },
            initialNumItems: 10,
        })
    );
    Retree.on(node, "nodeChanged", () => undefined);
    return node;
}

function emitPage(
    client: FakePaginatedConvexClient,
    rows: PaginatedDoc[],
    loadMore: (numItems: number) => boolean = () => true
) {
    client.paginatedSubscriptions[0].callback({
        results: rows,
        status: "CanLoadMore",
        loadMore,
    });
}

describe("ConvexPaginatedQueryNode optimistic updates", () => {
    it("applies optimistic transforms to the loaded results immediately", () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.resolve(null),
            },
            apply(page) {
                page.results[0].isCompleted = true;
            },
        });

        expect(node.state?.results).toEqual([
            { _id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("rolls optimistic state back when the mutation fails, keeping loadMore callable", async () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        const loadMore = vi.fn(() => true);
        emitPage(
            client,
            [{ _id: "task-1", text: "Buy groceries", isCompleted: false }],
            loadMore
        );

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(page) {
                page.results[0].isCompleted = true;
            },
        });
        expect(node.state?.results[0]?.isCompleted).toBe(true);

        await Promise.resolve();

        expect(node.state?.results).toEqual([
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.error?.message).toBe("Mutation failed");
        // The rollback baseline keeps the loadMore function by reference.
        expect(node.loadMore(5)).toBe(true);
        expect(loadMore).toHaveBeenCalledWith(5);
    });

    it("preserves row identity through rollback via _id reconciliation", async () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
            { _id: "task-2", text: "Read docs", isCompleted: false },
        ]);
        const untouchedRow = node.state?.results[1];

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(page) {
                page.results[0].isCompleted = true;
            },
        });

        await Promise.resolve();

        expect(node.state?.results[0]?.isCompleted).toBe(false);
        expect(node.state?.results[1]).toBe(untouchedRow);
    });

    it("keeps dirty optimistic state when the server echoes the last clean value", () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        node.optimisticUpdate({
            apply(page) {
                page.results[0].isCompleted = true;
            },
        });
        // Convex re-emits the pre-write value with a fresh loadMore function;
        // the echo must not clobber the optimistic state.
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        expect(node.state?.results).toEqual([
            { _id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("clears dirty optimistic state when the server sends a changed value", async () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(page) {
                page.results[0].isCompleted = true;
            },
        });
        emitPage(client, [
            {
                _id: "task-1",
                text: "Buy groceries from the server",
                isCompleted: false,
            },
        ]);

        await Promise.resolve();

        expect(node.state?.results).toEqual([
            {
                _id: "task-1",
                text: "Buy groceries from the server",
                isCompleted: false,
            },
        ]);
        expect(node.error).toBeNull();
    });

    it("keeps newer optimistic state while a newer optimistic mutation is pending", async () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        let resolveFirstMutation!: () => void;
        const firstMutation = new Promise<null>((resolve) => {
            resolveFirstMutation = () => resolve(null);
        });
        const secondMutation = new Promise<null>(() => undefined);

        node.optimisticUpdate({
            ctx: { args: { taskId: "task-1" }, promise: firstMutation },
            apply(page) {
                page.results[0].text = "Buy groceries A";
            },
        });
        node.optimisticUpdate({
            ctx: { args: { taskId: "task-1" }, promise: secondMutation },
            apply(page) {
                page.results[0].text = "Buy groceries B";
            },
        });

        resolveFirstMutation();
        await firstMutation;
        await Promise.resolve();
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries A", isCompleted: false },
        ]);

        expect(node.state?.results[0]?.text).toBe("Buy groceries B");
    });

    it("rolls back to a baseline confirmed mid-window when the newest mutation fails", async () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        let resolveFirstMutation!: () => void;
        const firstMutation = new Promise<null>((resolve) => {
            resolveFirstMutation = () => resolve(null);
        });
        let rejectSecondMutation!: () => void;
        const secondMutation = new Promise<null>((_, reject) => {
            rejectSecondMutation = () => reject(new Error("Mutation failed"));
        });

        node.optimisticUpdate({
            ctx: { args: { taskId: "task-1" }, promise: firstMutation },
            apply(page) {
                page.results[0].isCompleted = true;
            },
        });
        node.optimisticUpdate({
            ctx: { args: { taskId: "task-1" }, promise: secondMutation },
            apply(page) {
                page.results[0].text = "Optimistic text";
            },
        });

        resolveFirstMutation();
        await firstMutation;
        // Server confirms the first mutation while the second is pending.
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);

        rejectSecondMutation();
        await Promise.resolve();
        await Promise.resolve();

        // Rollback restores the confirmed mid-window baseline, not the stale
        // pre-window snapshot that would wipe the first mutation's change.
        expect(node.state?.results).toEqual([
            { _id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
        expect(node.error?.message).toBe("Mutation failed");
    });

    it("batches optimisticUpdate transform writes into one emission per row", () => {
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        emitPage(client, [
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        const row = node.state?.results[0];
        if (row === undefined) {
            throw new Error(
                "ConvexPaginatedQueryNode test expected a loaded row."
            );
        }
        const rowChanged = vi.fn();
        Retree.on(row, "nodeChanged", rowChanged);

        node.optimisticUpdate({
            apply(page) {
                page.results[0].text = "Buy oat milk";
                page.results[0].isCompleted = true;
            },
        });

        expect(rowChanged).toHaveBeenCalledTimes(1);
        expect(node.state?.results[0]).toEqual({
            _id: "task-1",
            text: "Buy oat milk",
            isCompleted: true,
        });
    });

    it("warns in dev mode when optimisticUpdate no-ops because state is undefined", () => {
        const warn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        const client = new FakePaginatedConvexClient();
        const node = subscribePaginatedNode(client);
        const apply = vi.fn();

        node.optimisticUpdate({ apply });

        expect(apply).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain(
            "ConvexPaginatedQueryNode.optimisticUpdate"
        );
    });
});
