import { describe, expect, it, vi } from "vitest";
import { ReactiveNode, Retree, select } from "@retreejs/core";
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
    ConvexConnectionStateNode,
    ConvexNode,
    ConvexPaginatedQueryNode,
    ConvexQueryNode,
    createRetreeConvexAction,
    createRetreeConvexMutation,
    IConvexClient,
    OptimisticUpdateContext,
    reconcileArrayById,
} from "./index";
import { reconcileArray } from "./internals/reconcile";

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
type NoArgsQuery = FunctionReference<
    "query",
    "public",
    Record<string, never>,
    string
>;
type ToggleTaskMutation = FunctionReference<
    "mutation",
    "public",
    { taskId: string },
    null
>;
type GenerateTasksAction = FunctionReference<
    "action",
    "public",
    { count: number },
    string[]
>;
type PaginatedTasksQuery = FunctionReference<
    "query",
    "public",
    { listId: string; paginationOpts: PaginationOptions },
    PaginationResult<{ id: string; text: string }>
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
const noArgsQuery: NoArgsQuery = {
    _type: "query",
    _visibility: "public",
    _args: {},
    _returnType: "",
    _componentPath: undefined,
};
const toggleTaskMutation: ToggleTaskMutation = {
    _type: "mutation",
    _visibility: "public",
    _args: { taskId: "" },
    _returnType: null,
    _componentPath: undefined,
};
const generateTasksAction: GenerateTasksAction = {
    _type: "action",
    _visibility: "public",
    _args: { count: 0 },
    _returnType: [],
    _componentPath: undefined,
};
const paginatedTasksQuery: PaginatedTasksQuery = {
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

class FakeConvexClient implements IConvexClient {
    public subscriptions: {
        args: unknown;
        callback: (result: unknown) => unknown;
        onError: ((error: Error) => unknown) | undefined;
        unsubscribe: ReturnType<typeof vi.fn>;
    }[] = [];
    public paginatedSubscriptions: {
        args: unknown;
        callback: (result: unknown) => unknown;
        onError: ((error: Error) => unknown) | undefined;
        unsubscribe: ReturnType<typeof vi.fn>;
        loadMore: ReturnType<typeof vi.fn>;
    }[] = [];
    public readonly mutationCalls: {
        mutation: unknown;
        args: unknown;
    }[] = [];
    public readonly actionCalls: {
        action: unknown;
        args: unknown;
    }[] = [];
    public readonly queryCalls: {
        query: unknown;
        args: unknown;
    }[] = [];
    public readonly close = vi.fn<() => Promise<void>>(() => Promise.resolve());
    public readonly connectionStateListeners: ((
        connectionState: ConnectionState
    ) => void)[] = [];
    public nextMutationPromise: Promise<null> = Promise.resolve(null);
    public nextActionPromise: Promise<string[]> = Promise.resolve(["created"]);
    public nextQueryPromise: Promise<string> = Promise.resolve("once");
    public currentConnectionState = connectedState;

    onUpdate<Query extends FunctionReference<"query">>(
        query: Query,
        args: FunctionArgs<Query>,
        callback: (result: FunctionReturnType<Query>) => unknown,
        onError?: (error: Error) => unknown
    ) {
        if (
            query !== tasksQuery &&
            query !== convexTasksQuery &&
            query !== noArgsQuery &&
            query !== paginatedTasksQuery
        ) {
            throw new Error("FakeConvexClient received an unexpected query.");
        }

        const unsubscribe = vi.fn();
        this.subscriptions.push({ args, callback, onError, unsubscribe });
        return Object.assign(unsubscribe, {
            unsubscribe,
            getCurrentValue: () => undefined,
        });
    }

    public mutation<Mutation extends FunctionReference<"mutation">>(
        mutation: Mutation,
        args: FunctionArgs<Mutation>
    ): Promise<Awaited<FunctionReturnType<Mutation>>> {
        this.mutationCalls.push({ mutation, args });
        return this.nextMutationPromise as Promise<
            Awaited<FunctionReturnType<Mutation>>
        >;
    }

    public action<Action extends ActionReference>(
        action: Action,
        args: FunctionArgs<Action>
    ): Promise<Awaited<FunctionReturnType<Action>>> {
        this.actionCalls.push({ action, args });
        return this.nextActionPromise as Promise<
            Awaited<FunctionReturnType<Action>>
        >;
    }

    public query<Query extends FunctionReference<"query">>(
        query: Query,
        args: FunctionArgs<Query>
    ): Promise<Awaited<FunctionReturnType<Query>>> {
        this.queryCalls.push({ query, args });
        return this.nextQueryPromise as Promise<
            Awaited<FunctionReturnType<Query>>
        >;
    }

    public connectionState(): ConnectionState {
        return this.currentConnectionState;
    }

    public subscribeToConnectionState(
        callback: (connectionState: ConnectionState) => void
    ): () => void {
        this.connectionStateListeners.push(callback);
        return vi.fn();
    }

    public onPaginatedUpdate_experimental<Query extends PaginatedTasksQuery>(
        query: Query,
        args: Omit<FunctionArgs<Query>, "paginationOpts">,
        options: { initialNumItems: number },
        callback: (result: unknown) => unknown,
        onError?: (error: Error) => unknown
    ) {
        if (query !== paginatedTasksQuery) {
            throw new Error(
                "FakeConvexClient received an unexpected paginated query."
            );
        }

        if (options.initialNumItems <= 0) {
            throw new Error(
                "FakeConvexClient expected a positive initialNumItems value."
            );
        }

        const unsubscribe = vi.fn();
        const loadMore = vi.fn(() => true);
        this.paginatedSubscriptions.push({
            args,
            callback,
            onError,
            unsubscribe,
            loadMore,
        });
        return Object.assign(unsubscribe, {
            unsubscribe,
            getCurrentValue: () => undefined,
        });
    }
}

class TestConvexNode extends ConvexNode {
    get dependencies() {
        return [];
    }

    public toggleTask(
        args: FunctionArgs<ToggleTaskMutation>,
        options?: {
            withOptimisticUpdate?: (
                ctx: OptimisticUpdateContext<ToggleTaskMutation>
            ) => void;
        }
    ): Promise<null> {
        const toggleTask = this.mutation(toggleTaskMutation);
        return toggleTask(args, options);
    }

    public tasksQuery() {
        return this.query(tasksQuery, { args: { listId: "today" } });
    }

    public noArgsQuery() {
        return this.query(noArgsQuery);
    }

    public skippedTasksQuery() {
        return this.query(tasksQuery, "skip");
    }

    public paginatedTasksQuery() {
        return this.paginatedQuery(paginatedTasksQuery, {
            args: { listId: "today" },
            initialNumItems: 10,
        });
    }

    public connection() {
        return this.connectionState();
    }

    public generateTasks(args: FunctionArgs<GenerateTasksAction>) {
        const generateTasks = this.action(generateTasksAction);
        return generateTasks(args);
    }

    public getStatusOnce() {
        return this.queryOnce(noArgsQuery);
    }
}

class SelectedTasksNode extends ReactiveNode {
    public readonly tasksQuery: ConvexQueryNode<ConvexTasksQuery>;

    constructor(client: FakeConvexClient) {
        super();
        this.tasksQuery = new ConvexQueryNode(client, convexTasksQuery, {
            args: { listId: "today" },
            initialState: [],
        });
    }

    @select
    public get tasks() {
        return this.tasksQuery.state?.filter(() => true) ?? [];
    }

    get dependencies() {
        return [];
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

    it("reproxies a parent @select owner when a reconciled document array gains an item", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(new SelectedTasksNode(client));
        const nodeChanged = vi.fn();

        Retree.on(node, "nodeChanged", nodeChanged);
        expect(node.tasks).toEqual([]);

        client.subscriptions[0].callback([
            {
                _id: "task-1",
                text: "Buy groceries",
                isCompleted: false,
            },
        ]);

        expect(nodeChanged).toHaveBeenCalled();
        expect(node.tasks).toEqual([
            {
                _id: "task-1",
                text: "Buy groceries",
                isCompleted: false,
            },
        ]);
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

    it("creates typed query nodes from a ConvexNode client", () => {
        const client = new FakeConvexClient();
        const node = new TestConvexNode(client);
        const tasksNode = node.tasksQuery();

        Retree.on(Retree.root(tasksNode), "nodeChanged", () => undefined);

        expect(client.subscriptions[0].args).toEqual({ listId: "today" });
    });

    it("allows no-args queries to omit args", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(new ConvexQueryNode(client, noArgsQuery));

        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback("ready");

        expect(client.subscriptions[0].args).toEqual({});
        expect(node.state).toBe("ready");
    });

    it("allows no-args query wrappers to omit args", () => {
        const client = new FakeConvexClient();
        const state = new TestConvexNode(client);
        const node = Retree.root(state.noArgsQuery());

        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback("ready");

        expect(client.subscriptions[0].args).toEqual({});
        expect(node.state).toBe("ready");
    });

    it("tracks structured query status for pending, success, and errors", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );

        Retree.on(node, "nodeChanged", () => undefined);
        expect(node.result).toEqual({ status: "pending" });

        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.result).toEqual({
            status: "success",
            data: [{ id: "task-1", text: "Buy groceries", isCompleted: false }],
        });

        client.subscriptions[0].onError?.(new Error("Query failed"));
        expect(node.result.status).toBe("error");
        if (node.result.status !== "error") {
            throw new Error(
                "ConvexQueryNode test expected an error query result."
            );
        }
        expect(node.result.error.message).toBe("Query failed");
    });

    it("skips query subscriptions from the constructor and updateArgs", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, "skip")
        );

        Retree.on(node, "nodeChanged", () => undefined);

        expect(client.subscriptions).toHaveLength(0);
        expect(node.state).toBeUndefined();
        expect(node.result).toEqual({ status: "skipped" });

        node.updateArgs({ listId: "today" });
        expect(client.subscriptions).toHaveLength(1);
        expect(node.result).toEqual({ status: "pending" });

        node.updateArgs("skip");
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(node.state).toBeUndefined();
        expect(node.result).toEqual({ status: "skipped" });
    });

    it("creates skipped typed query nodes from a ConvexNode client", () => {
        const client = new FakeConvexClient();
        const state = new TestConvexNode(client);
        const node = Retree.root(state.skippedTasksQuery());

        Retree.on(node, "nodeChanged", () => undefined);

        expect(client.subscriptions).toHaveLength(0);
        expect(node.result).toEqual({ status: "skipped" });
    });

    it("creates typed mutations with optimistic hooks", async () => {
        const client = new FakeConvexClient();
        const toggleTask = createRetreeConvexMutation(
            client,
            toggleTaskMutation
        );
        const withOptimisticUpdate =
            vi.fn<(ctx: OptimisticUpdateContext<ToggleTaskMutation>) => void>();

        const result = await toggleTask(
            { taskId: "task-1" },
            { withOptimisticUpdate }
        );

        expect(result).toBeNull();
        expect(client.mutationCalls).toEqual([
            {
                mutation: toggleTaskMutation,
                args: { taskId: "task-1" },
            },
        ]);
        expect(withOptimisticUpdate).toHaveBeenCalledOnce();
        expect(withOptimisticUpdate.mock.calls[0][0].args).toEqual({
            taskId: "task-1",
        });
    });

    it("creates typed mutations from a ConvexNode client", async () => {
        const client = new FakeConvexClient();
        const node = new TestConvexNode(client);
        const withOptimisticUpdate =
            vi.fn<(ctx: OptimisticUpdateContext<ToggleTaskMutation>) => void>();

        const result = await node.toggleTask(
            { taskId: "task-1" },
            { withOptimisticUpdate }
        );

        expect(result).toBeNull();
        expect(client.mutationCalls).toEqual([
            {
                mutation: toggleTaskMutation,
                args: { taskId: "task-1" },
            },
        ]);
        expect(withOptimisticUpdate).toHaveBeenCalledOnce();
        expect(withOptimisticUpdate.mock.calls[0][0].args).toEqual({
            taskId: "task-1",
        });
    });

    it("creates typed actions from a ConvexNode client", async () => {
        const client = new FakeConvexClient();
        const node = new TestConvexNode(client);

        const result = await node.generateTasks({ count: 2 });

        expect(result).toEqual(["created"]);
        expect(client.actionCalls).toEqual([
            {
                action: generateTasksAction,
                args: { count: 2 },
            },
        ]);
    });

    it("keeps createRetreeConvexAction exported for direct action helpers", async () => {
        const client = new FakeConvexClient();
        const generateTasks = createRetreeConvexAction(
            client,
            generateTasksAction
        );

        const result = await generateTasks({ count: 1 });

        expect(result).toEqual(["created"]);
        expect(client.actionCalls).toEqual([
            {
                action: generateTasksAction,
                args: { count: 1 },
            },
        ]);
    });

    it("runs one-off queries from a ConvexNode client", async () => {
        const client = new FakeConvexClient();
        const node = new TestConvexNode(client);

        const result = await node.getStatusOnce();

        expect(result).toBe("once");
        expect(client.queryCalls).toEqual([
            {
                query: noArgsQuery,
                args: {},
            },
        ]);
    });

    it("tracks connection state changes", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(new ConvexConnectionStateNode(client));
        const nextState: ConnectionState = {
            ...connectedState,
            isWebSocketConnected: false,
            connectionRetries: 1,
        };

        Retree.on(node, "nodeChanged", () => undefined);
        client.connectionStateListeners[0](nextState);

        expect(node.state).toEqual(nextState);
    });

    it("creates connection state nodes from a ConvexNode client", () => {
        const client = new FakeConvexClient();
        const state = new TestConvexNode(client);
        const node = Retree.root(state.connection());

        Retree.on(node, "nodeChanged", () => undefined);

        expect(node.state).toEqual(connectedState);
        expect(client.connectionStateListeners).toHaveLength(1);
    });

    it("subscribes to paginated queries and loads more items", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexPaginatedQueryNode(client, paginatedTasksQuery, {
                args: { listId: "today" },
                initialNumItems: 10,
            })
        );

        Retree.on(node, "nodeChanged", () => undefined);
        client.paginatedSubscriptions[0].callback({
            results: [{ id: "task-1", text: "Buy groceries" }],
            status: "CanLoadMore",
            loadMore: client.paginatedSubscriptions[0].loadMore,
        });

        expect(node.state?.results).toEqual([
            { id: "task-1", text: "Buy groceries" },
        ]);
        expect(node.result.status).toBe("success");
        if (node.result.status !== "success") {
            throw new Error(
                "ConvexQueryNode test expected a success paginated query result."
            );
        }
        expect(node.result.data.results).toEqual(node.state?.results);
        expect(node.result.data.status).toBe(node.state?.status);
        expect(node.loadMore(5)).toBe(true);
        expect(client.paginatedSubscriptions[0].loadMore).toHaveBeenCalledWith(
            5
        );
    });

    it("creates paginated query nodes from a ConvexNode client", () => {
        const client = new FakeConvexClient();
        const state = new TestConvexNode(client);
        const node = Retree.root(state.paginatedTasksQuery());

        Retree.on(node, "nodeChanged", () => undefined);

        expect(client.paginatedSubscriptions[0].args).toEqual({
            listId: "today",
        });
        expect(node.result).toEqual({ status: "pending" });
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

        const result = node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.resolve(null),
            },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });

        expect(result).toBeUndefined();
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

        const result = node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });

        expect(result).toBeUndefined();
        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);

        await Promise.resolve();

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.error?.message).toBe("Mutation failed");
    });

    it("keeps dirty optimistic state when the server echoes the last clean value", () => {
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

        node.optimisticUpdate({
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("clears dirty optimistic state when the server sends a changed value", async () => {
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

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        client.subscriptions[0].callback([
            {
                id: "task-1",
                text: "Buy groceries from the server",
                isCompleted: false,
            },
        ]);

        await Promise.resolve();

        expect(node.state).toEqual([
            {
                id: "task-1",
                text: "Buy groceries from the server",
                isCompleted: false,
            },
        ]);
        expect(node.error).toBeNull();
    });

    it("keeps newer optimistic state while a newer optimistic mutation is pending", async () => {
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
        let resolveFirstMutation!: () => void;
        const firstMutation = new Promise<null>((resolve) => {
            resolveFirstMutation = () => resolve(null);
        });
        let resolveSecondMutation!: () => void;
        const secondMutation = new Promise<null>((resolve) => {
            resolveSecondMutation = () => resolve(null);
        });

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: firstMutation,
            },
            apply(tasks) {
                tasks[0].text = "Buy groceries A";
            },
        });
        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: secondMutation,
            },
            apply(tasks) {
                tasks[0].text = "Buy groceries B";
            },
        });

        resolveFirstMutation();
        await firstMutation;
        await Promise.resolve();
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries A", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries B", isCompleted: false },
        ]);

        resolveSecondMutation();
        await secondMutation;
        await Promise.resolve();
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries B", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries B", isCompleted: false },
        ]);
    });

    it("rolls dirty optimistic state back when a later mutation fails first", async () => {
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

        node.optimisticUpdate({
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(tasks) {
                tasks[0].text = "Optimistic text";
            },
        });

        await Promise.resolve();

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

    it("reconciles arrays with sparse current slots", () => {
        const current: { id: string; text: string }[] = [];
        current.length = 2;
        current[1] = { id: "task-2", text: "Read docs" };
        const preservedTask = current[1];

        reconcileArray(
            current,
            [
                { id: "task-1", text: "Buy groceries" },
                { id: "task-2", text: "Read better docs" },
            ],
            (task) => task.id
        );

        expect(current[0]).toEqual({
            id: "task-1",
            text: "Buy groceries",
        });
        expect(current[1]).toBe(preservedTask);
        expect(current[1]).toEqual({
            id: "task-2",
            text: "Read better docs",
        });
    });
});
