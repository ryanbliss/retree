import { describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import type {
    FunctionArgs,
    FunctionReference,
    FunctionReturnType,
} from "convex/server";
import {
    ConvexQueryNode,
    createRetreeConvexMutation,
    IConvexQueryClient,
    IConvexMutationClient,
    reconcileArrayById,
    RetreeOptimisticMutation,
} from "./index";

type TasksQuery = FunctionReference<
    "query",
    "public",
    { listId: string },
    { id: string; text: string; isCompleted: boolean }[]
>;
type ConvexTasksQuery = FunctionReference<
    "query",
    "public",
    { listId: string },
    { _id: string; text: string; isCompleted: boolean }[]
>;
type ToggleTaskMutation = FunctionReference<
    "mutation",
    "public",
    { taskId: string },
    null
>;

const tasksQuery: TasksQuery = {
    _type: "query",
    _visibility: "public",
    _args: { listId: "" },
    _returnType: [],
    _componentPath: undefined,
};
const convexTasksQuery: ConvexTasksQuery = {
    _type: "query",
    _visibility: "public",
    _args: { listId: "" },
    _returnType: [],
    _componentPath: undefined,
};
const toggleTaskMutation: ToggleTaskMutation = {
    _type: "mutation",
    _visibility: "public",
    _args: { taskId: "" },
    _returnType: null,
    _componentPath: undefined,
};

class FakeConvexClient implements IConvexQueryClient {
    public subscriptions: {
        args: unknown;
        callback: (result: unknown) => unknown;
        onError: ((error: Error) => unknown) | undefined;
        unsubscribe: ReturnType<typeof vi.fn>;
    }[] = [];

    onUpdate<Query extends FunctionReference<"query">>(
        query: Query,
        args: FunctionArgs<Query>,
        callback: (result: FunctionReturnType<Query>) => unknown,
        onError?: (error: Error) => unknown
    ) {
        if (query !== tasksQuery && query !== convexTasksQuery) {
            throw new Error("FakeConvexClient received an unexpected query.");
        }

        const unsubscribe = vi.fn();
        this.subscriptions.push({ args, callback, onError, unsubscribe });
        return Object.assign(unsubscribe, {
            unsubscribe,
            getCurrentValue: () => undefined,
        });
    }
}

class FakeMutationClient implements IConvexMutationClient {
    public readonly mutationCalls: {
        mutation: unknown;
        args: unknown;
    }[] = [];
    public nextMutationPromise: Promise<null> = Promise.resolve(null);

    mutation<Mutation extends FunctionReference<"mutation">>(
        mutation: Mutation,
        args: FunctionArgs<Mutation>
    ): Promise<Awaited<FunctionReturnType<Mutation>>> {
        this.mutationCalls.push({ mutation, args });
        return this.nextMutationPromise as Promise<
            Awaited<FunctionReturnType<Mutation>>
        >;
    }
}

describe("ConvexQueryNode", () => {
    it("writes query updates into state through Retree", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        const nodeChanged = vi.fn();

        Retree.on(node, "nodeChanged", nodeChanged);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(nodeChanged).toHaveBeenCalled();
    });

    it("resubscribes when args change", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );

        Retree.on(node, "nodeChanged", () => undefined);
        node.updateArgs({ listId: "tomorrow" });

        expect(client.subscriptions).toHaveLength(2);
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(client.subscriptions[1].args).toEqual({ listId: "tomorrow" });
    });

    it("does not resubscribe when args have the same values", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );

        Retree.on(node, "nodeChanged", () => undefined);
        node.updateArgs({ listId: "today" });

        expect(client.subscriptions).toHaveLength(1);
    });

    it("cleans up the active subscription", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );

        Retree.on(node, "nodeChanged", () => undefined);
        node.dispose();

        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    });

    it("creates typed mutations with optimistic hooks", async () => {
        const client = new FakeMutationClient();
        const toggleTask = createRetreeConvexMutation(
            client,
            toggleTaskMutation
        );
        const onOptimistic =
            vi.fn<
                (mutation: RetreeOptimisticMutation<ToggleTaskMutation>) => void
            >();

        const result = await toggleTask({ taskId: "task-1" }, { onOptimistic });

        expect(result).toBeNull();
        expect(client.mutationCalls).toEqual([
            {
                mutation: toggleTaskMutation,
                args: { taskId: "task-1" },
            },
        ]);
        expect(onOptimistic).toHaveBeenCalledOnce();
        expect(onOptimistic.mock.calls[0][0].args).toEqual({
            taskId: "task-1",
        });
    });

    it("keeps optimistic state when the mutation succeeds", async () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        await node.applyOptimisticMutation(
            {
                args: { taskId: "task-1" },
                promise: Promise.resolve(null),
            },
            {
                apply(tasks) {
                    tasks[0].isCompleted = true;
                },
            }
        );

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("rolls optimistic state back when the mutation fails", async () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        await node.applyOptimisticMutation(
            {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            {
                apply(tasks) {
                    tasks[0].isCompleted = true;
                },
            }
        );

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.error?.message).toBe("Mutation failed");
    });

    it("reconciles array items by id when query updates arrive", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
                reconcile: reconcileArrayById("id"),
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        const task = node.state?.[0];
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);

        expect(node.state?.[0]).toBe(task);
        expect(node.state?.[0]).toEqual({
            id: "task-1",
            text: "Buy groceries",
            isCompleted: true,
        });
    });

    it("keeps unchanged array item proxies stable when another item changes", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
                reconcile: reconcileArrayById("id"),
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);

        const unchangedTask = node.state?.[1];
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);

        expect(node.state?.[0]?.isCompleted).toBe(true);
        expect(node.state?.[1]).toBe(unchangedTask);
    });

    it("defaults to reconciling Convex document arrays by _id", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, convexTasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
            { _id: "task-2", text: "Read docs", isCompleted: false },
        ]);

        const unchangedTask = node.state?.[1];
        client.subscriptions[0].callback([
            { _id: "task-1", text: "Buy groceries", isCompleted: true },
            { _id: "task-2", text: "Read docs", isCompleted: false },
        ]);

        expect(node.state?.[0]?.isCompleted).toBe(true);
        expect(node.state?.[1]).toBe(unchangedTask);
    });
});
