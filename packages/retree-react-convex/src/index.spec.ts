import { describe, expect, it, vi } from "vitest";
import type {
    FunctionReference,
    FunctionReturnType,
    PaginationOptions,
    PaginationResult,
} from "convex/server";
import type { QueryJournal } from "convex/browser";
import type { Watch } from "convex/react";
import { Retree } from "@retreejs/core";
import {
    ConvexQueryNode,
    type PaginatedQueryArgs,
    type RetreePaginatedQueryResult,
} from "@retreejs/convex";
import { RetreeConvexReactClient } from "./index.js";

type TasksQuery = FunctionReference<
    "query",
    "public",
    { listId: string },
    string[]
>;
type MessagesQuery = FunctionReference<
    "query",
    "public",
    { roomId: string; paginationOpts: PaginationOptions },
    PaginationResult<{ id: string; text: string }>
>;

const tasksQuery: TasksQuery = {
    _type: "query",
    _visibility: "public",
    _args: { listId: "" },
    _returnType: [],
    _componentPath: undefined,
};
const messagesQuery: MessagesQuery = {
    _type: "query",
    _visibility: "public",
    _args: {
        roomId: "",
        paginationOpts: {
            numItems: 0,
            cursor: null,
        },
    },
    _returnType: {
        page: [],
        isDone: false,
        continueCursor: "",
    },
    _componentPath: undefined,
};

class FakeWatch<T> implements Watch<T> {
    public readonly unsubscribe = vi.fn();
    private callback: (() => void) | undefined;
    private error: unknown;

    constructor(private value: T | undefined) {}

    public onUpdate(callback: () => void): () => void {
        this.callback = callback;
        return this.unsubscribe;
    }

    public localQueryResult(): T | undefined {
        if (this.error !== undefined) {
            throw this.error;
        }

        return this.value;
    }

    public journal(): QueryJournal | undefined {
        return undefined;
    }

    public setValue(value: T | undefined): void {
        this.value = value;
    }

    public setError(error: unknown): void {
        this.error = error;
    }

    public emit(): void {
        this.callback?.();
    }
}

type MessagesResult = RetreePaginatedQueryResult<
    FunctionReturnType<MessagesQuery>["page"][number]
>;

interface IWatchPaginatedQuery {
    (
        query: MessagesQuery,
        args: PaginatedQueryArgs<MessagesQuery>,
        options: { initialNumItems: number; id: number }
    ): FakeWatch<MessagesResult>;
}

describe("RetreeConvexReactClient", () => {
    it("subscribes to Convex React query watches and reads cached values", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const watch = new FakeWatch<FunctionReturnType<TasksQuery>>(["cached"]);
        const callback =
            vi.fn<(result: FunctionReturnType<TasksQuery>) => void>();
        const watchQuery = vi
            .spyOn(client, "watchQuery")
            .mockReturnValue(watch);

        const subscription = client.onUpdate(
            tasksQuery,
            { listId: "today" },
            callback
        );

        expect(watchQuery).toHaveBeenCalledWith(tasksQuery, {
            listId: "today",
        });
        expect(subscription.getCurrentValue()).toEqual(["cached"]);

        watch.setValue(["fresh"]);
        watch.emit();

        expect(callback).toHaveBeenCalledWith(["fresh"]);

        subscription.unsubscribe();
        subscription.unsubscribe();
        watch.setValue(["ignored"]);
        watch.emit();

        expect(watch.unsubscribe).toHaveBeenCalledOnce();
        expect(subscription.getCurrentValue()).toBeUndefined();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it("routes watch read errors to the optional error handler", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const watch = new FakeWatch<FunctionReturnType<TasksQuery>>(undefined);
        const callback =
            vi.fn<(result: FunctionReturnType<TasksQuery>) => void>();
        const onError = vi.fn<(error: Error) => void>();
        vi.spyOn(client, "watchQuery").mockReturnValue(watch);

        client.onUpdate(tasksQuery, { listId: "today" }, callback, onError);
        watch.setError("boom");
        watch.emit();

        expect(callback).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0].message).toBe(
            "RetreeConvexReactClient.onUpdate: Convex watch failed with a non-Error value: boom"
        );
    });

    it("throws watch read errors when no error handler is provided", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const watch = new FakeWatch<FunctionReturnType<TasksQuery>>(undefined);
        vi.spyOn(client, "watchQuery").mockReturnValue(watch);

        const subscription = client.onUpdate(
            tasksQuery,
            { listId: "today" },
            () => undefined
        );
        watch.setError(new Error("Query failed"));

        expect(() => subscription.getCurrentValue()).toThrow("Query failed");
    });

    it("subscribes to paginated watches with stable increasing ids", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const firstResult: MessagesResult = {
            results: [{ id: "message-1", text: "Hello" }],
            status: "CanLoadMore",
            loadMore: vi.fn(() => true),
        };
        const firstWatch = new FakeWatch<MessagesResult>(firstResult);
        const secondWatch = new FakeWatch<MessagesResult>(undefined);
        const watchPaginatedQuery = vi
            .fn<IWatchPaginatedQuery>()
            .mockReturnValueOnce(firstWatch)
            .mockReturnValueOnce(secondWatch);
        installPaginatedWatch(client, watchPaginatedQuery);

        const callback = vi.fn<(result: MessagesResult) => void>();
        const firstSubscription = client.onPaginatedUpdate_experimental(
            messagesQuery,
            { roomId: "general" },
            { initialNumItems: 10 },
            callback
        );
        client.onPaginatedUpdate_experimental(
            messagesQuery,
            { roomId: "random" },
            { initialNumItems: 20 },
            callback
        );

        expect(firstSubscription.getCurrentValue()).toBe(firstResult);
        expect(watchPaginatedQuery.mock.calls[0]).toEqual([
            messagesQuery,
            { roomId: "general" },
            { initialNumItems: 10, id: 1 },
        ]);
        expect(watchPaginatedQuery.mock.calls[1]).toEqual([
            messagesQuery,
            { roomId: "random" },
            { initialNumItems: 20, id: 2 },
        ]);

        firstWatch.emit();

        expect(callback).toHaveBeenCalledWith(firstResult);
    });

    it("surfaces an errored watch through ConvexQueryNode as error, not eternal pending", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const goodWatch = new FakeWatch<FunctionReturnType<TasksQuery>>([
            "cached",
        ]);
        const errorWatch = new FakeWatch<FunctionReturnType<TasksQuery>>(
            undefined
        );
        errorWatch.setError(new Error("Query failed"));
        vi.spyOn(client, "watchQuery")
            .mockReturnValueOnce(goodWatch)
            .mockReturnValueOnce(errorWatch);

        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        expect(node.result).toEqual({ status: "success", data: ["cached"] });

        // The new watch's cached value is an error; the node must show the
        // error instead of resetting to pending forever.
        node.updateArgs({ listId: "tomorrow" });

        expect(node.result.status).toBe("error");
        if (node.result.status !== "error") {
            throw new Error(
                "RetreeConvexReactClient test expected an error query result."
            );
        }
        expect(node.result.error.message).toBe("Query failed");
        expect(node.error?.message).toBe("Query failed");
    });

    it("throws a helpful error when paginated watches are unavailable", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        installMissingPaginatedWatch(client);

        expect(() =>
            client.onPaginatedUpdate_experimental(
                messagesQuery,
                { roomId: "general" },
                { initialNumItems: 10 },
                () => undefined
            )
        ).toThrow(
            "RetreeConvexReactClient.onPaginatedUpdate_experimental: ConvexReactClient does not expose watchPaginatedQuery. This Convex version cannot drive Retree paginated query nodes from the React client."
        );
    });
});

function installPaginatedWatch(
    client: RetreeConvexReactClient,
    watchPaginatedQuery: IWatchPaginatedQuery
): void {
    Object.defineProperty(client, "watchPaginatedQuery", {
        configurable: true,
        value: watchPaginatedQuery,
    });
}

function installMissingPaginatedWatch(client: RetreeConvexReactClient): void {
    Object.defineProperty(client, "watchPaginatedQuery", {
        configurable: true,
        value: undefined,
    });
}
