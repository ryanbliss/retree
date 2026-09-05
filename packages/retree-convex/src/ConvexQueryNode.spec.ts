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
    PaginatedQueryReference,
    reconcileArrayById,
} from "./index.js";
import { deepEquals } from "./internals/equality.js";
import { reconcileArray } from "./internals/reconcile.js";
import { getCustomProxyHandler } from "@retreejs/core/internal";

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
type StatsQuery = FunctionReference<
    "query",
    "public",
    Record<string, never>,
    { views: bigint }
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
type PaginatedDocsQuery = FunctionReference<
    "query",
    "public",
    { listId: string; paginationOpts: PaginationOptions },
    PaginationResult<{ _id: string; text: string }>
>;
interface INestedTask {
    _id: string;
    text: string;
    metadata: { priority: number; assignee: { name: string } } | null;
    tags: string[];
}
type NestedTasksQuery = FunctionReference<
    "query",
    "public",
    { listId: string },
    INestedTask[]
>;
type FilteredTasksQuery = FunctionReference<
    "query",
    "public",
    { filter: { listId: string; tags: string[] } },
    string[]
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
const statsQuery: StatsQuery = {
    _type: "query",
    _visibility: "public",
    _args: {},
    _returnType: { views: 0n },
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
const nestedTasksQuery: NestedTasksQuery = {
    _type: "query",
    _visibility: "public",
    _args: { listId: "" },
    _returnType: [],
    _componentPath: undefined,
};
const filteredTasksQuery: FilteredTasksQuery = {
    _type: "query",
    _visibility: "public",
    _args: { filter: { listId: "", tags: [] } },
    _returnType: [],
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
    /**
     * When set, `getCurrentValue()` on new subscriptions surfaces this error
     * through the subscription's error callback and returns `undefined`,
     * mirroring how the Convex React watch exposes an errored cached value.
     */
    public nextCurrentValueError: Error | undefined;

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
            query !== statsQuery &&
            query !== paginatedTasksQuery &&
            query !== nestedTasksQuery &&
            query !== filteredTasksQuery
        ) {
            throw new Error("FakeConvexClient received an unexpected query.");
        }

        const unsubscribe = vi.fn();
        this.subscriptions.push({ args, callback, onError, unsubscribe });
        return Object.assign(unsubscribe, {
            unsubscribe,
            getCurrentValue: () => {
                if (this.nextCurrentValueError !== undefined) {
                    onError?.(this.nextCurrentValueError);
                }
                return undefined;
            },
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

    public onPaginatedUpdate_experimental<
        Query extends PaginatedQueryReference
    >(
        query: Query,
        args: Omit<FunctionArgs<Query>, "paginationOpts">,
        options: { initialNumItems: number },
        callback: (result: unknown) => unknown,
        onError?: (error: Error) => unknown
    ) {
        const knownPaginatedQueries: readonly unknown[] = [
            paginatedTasksQuery,
            paginatedDocsQuery,
        ];
        if (!knownPaginatedQueries.includes(query)) {
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

class AutoDisposeTasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<TasksQuery>;

    constructor(client: IConvexClient) {
        super(client);
        this.tasks = this.query(tasksQuery, {
            args: { listId: "today" },
        });
    }

    @select
    public get status() {
        return this.tasks.result.status;
    }

    get dependencies() {
        return [];
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

    it("resubscribes after cleanup when observed again", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );

        Retree.on(node, "nodeChanged", () => undefined);
        node.dispose();
        Retree.clearListeners(node);
        Retree.on(node, "nodeChanged", () => undefined);

        expect(client.subscriptions).toHaveLength(2);
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(client.subscriptions[1].args).toEqual({ listId: "today" });
    });

    it("disposes ConvexNode query children when the owner is unobserved", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(new AutoDisposeTasksState(client));

        expect(node.status).toBe("pending");
        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(1);

        unsubscribe();

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

    it("rolls back to a baseline confirmed mid-window when the newest mutation fails", async () => {
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
        let rejectSecondMutation!: () => void;
        const secondMutation = new Promise<null>((_, reject) => {
            rejectSecondMutation = () => reject(new Error("Mutation failed"));
        });

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: firstMutation,
            },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: secondMutation,
            },
            apply(tasks) {
                tasks[0].text = "Optimistic text";
            },
        });

        resolveFirstMutation();
        await firstMutation;
        // Server confirms the first mutation while the second is still pending.
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);

        rejectSecondMutation();
        await Promise.resolve();
        await Promise.resolve();

        // Rollback restores the confirmed mid-window baseline, not the stale
        // pre-window snapshot that would wipe the first mutation's change.
        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
        expect(node.error?.message).toBe("Mutation failed");
    });

    it("supports bigint query state through emission and optimistic rollback", async () => {
        const client = new FakeConvexClient();
        const node = Retree.root(new ConvexQueryNode(client, statsQuery));
        Retree.on(node, "nodeChanged", () => undefined);

        client.subscriptions[0].callback({ views: 5n });
        expect(node.state).toEqual({ views: 5n });

        node.optimisticUpdate({
            ctx: {
                args: { taskId: "task-1" },
                promise: Promise.reject(new Error("Mutation failed")),
            },
            apply(stats) {
                stats.views = 6n;
            },
        });
        expect(node.state?.views).toBe(6n);

        await Promise.resolve();

        expect(node.state?.views).toBe(5n);
        expect(node.error?.message).toBe("Mutation failed");
    });

    it("keeps dirty optimistic state when the server echo reorders object keys", () => {
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
            { isCompleted: false, text: "Buy groceries", id: "task-1" },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("compares query state deeply across Convex value types", () => {
        expect(deepEquals(5n, 5n)).toBe(true);
        expect(deepEquals(5n, 6n)).toBe(false);
        expect(deepEquals(5n, 5)).toBe(false);

        expect(deepEquals(NaN, NaN)).toBe(true);
        expect(deepEquals(null, null)).toBe(true);
        expect(deepEquals(null, {})).toBe(false);
        expect(deepEquals({}, null)).toBe(false);

        expect(deepEquals(new Date("2026-07-14"), new Date("2026-07-14"))).toBe(
            true
        );
        expect(deepEquals(new Date("2026-07-14"), new Date("2026-07-15"))).toBe(
            false
        );
        expect(deepEquals(new Date(0), {})).toBe(false);

        expect(
            deepEquals(
                new Uint8Array([1, 2, 3]).buffer,
                new Uint8Array([1, 2, 3]).buffer
            )
        ).toBe(true);
        expect(
            deepEquals(
                new Uint8Array([1, 2, 3]).buffer,
                new Uint8Array([1, 2, 4]).buffer
            )
        ).toBe(false);
        expect(
            deepEquals(
                new Uint8Array([1, 2, 3]).buffer,
                new Uint8Array([1, 2]).buffer
            )
        ).toBe(false);

        expect(deepEquals([{ a: 1 }], [{ a: 1 }])).toBe(true);
        expect(deepEquals([{ a: 1 }], [{ a: 2 }])).toBe(false);
        expect(deepEquals([1, 2], [1, 2, 3])).toBe(false);
        expect(deepEquals([1], { 0: 1 })).toBe(false);
        expect(deepEquals({ 0: 1 }, [1])).toBe(false);

        expect(deepEquals({ a: 1, b: 2n }, { b: 2n, a: 1 })).toBe(true);
        expect(deepEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(deepEquals({ a: 1, b: 2 }, { a: 1 })).toBe(false);
        expect(deepEquals({ a: undefined }, { b: undefined })).toBe(false);
    });

    it("reconciles duplicate _ids into two distinct managed objects", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, convexTasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { _id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        // User-authored queries (manual joins, concatenated results) can emit
        // the same document twice. Each slot must stay a distinct object.
        client.subscriptions[0].callback([
            { _id: "task-1", text: "First copy", isCompleted: false },
            { _id: "task-1", text: "Second copy", isCompleted: true },
        ]);

        expect(node.state?.[0]).not.toBe(node.state?.[1]);
        expect(node.state?.[0]).toEqual({
            _id: "task-1",
            text: "First copy",
            isCompleted: false,
        });
        expect(node.state?.[1]).toEqual({
            _id: "task-1",
            text: "Second copy",
            isCompleted: true,
        });

        node.state![0].text = "Edited first copy";
        expect(node.state?.[1].text).toBe("Second copy");
    });

    it("reconciles arrays with duplicate ids without aliasing slots", () => {
        const current: { id: string; text: string }[] = [
            { id: "task-1", text: "Buy groceries" },
        ];

        reconcileArray(
            current,
            [
                { id: "task-1", text: "First copy" },
                { id: "task-1", text: "Second copy" },
            ],
            (task) => task.id
        );

        expect(current[0]).not.toBe(current[1]);
        expect(current[0]).toEqual({ id: "task-1", text: "First copy" });
        expect(current[1]).toEqual({ id: "task-1", text: "Second copy" });
    });

    it("keeps server updates when a duplicate id collapses back to one occurrence", () => {
        const current: { id: string; text: string }[] = [];
        reconcileArray(
            current,
            [
                { id: "task-1", text: "First copy" },
                { id: "task-1", text: "Second copy" },
            ],
            (task) => task.id
        );

        // The next emission drops one duplicate; the surviving slot must
        // carry the server's latest value, not a stale earlier copy.
        reconcileArray(current, [{ id: "task-1", text: "Final" }], (task) => {
            return task.id;
        });

        expect(current).toHaveLength(1);
        expect(current[0]).toEqual({ id: "task-1", text: "Final" });
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

    it("passes a raw read view to custom reconcilers (read raw, write current)", () => {
        const client = new FakeConvexClient();
        const seen: {
            current: unknown;
            rawCurrent: unknown;
        }[] = [];
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
                reconcile: {
                    reconcile(current, next, rawCurrent) {
                        seen.push({ current, rawCurrent });
                        if (current === undefined) {
                            return next;
                        }
                        // Read from rawCurrent, write to current.
                        if (rawCurrent?.[0]?.text !== next[0]?.text) {
                            current[0]!.text = next[0]!.text;
                        }
                        return current;
                    },
                },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        const task = node.state?.[0];
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy oat milk", isCompleted: false },
        ]);

        // First call: no current state yet.
        expect(seen[0].current).toBeUndefined();
        expect(seen[0].rawCurrent).toBeUndefined();
        // Second call: rawCurrent is the proxy-free raw view of current.
        expect(seen[1].current).toBeDefined();
        expect(seen[1].rawCurrent).toBe(
            Retree.raw(seen[1].current as { id: string }[])
        );
        expect(getCustomProxyHandler(seen[1].rawCurrent as object)).toBe(
            undefined
        );
        // Writes through current kept identity and applied the diff.
        expect(node.state?.[0]).toBe(task);
        expect(node.state?.[0]?.text).toBe("Buy oat milk");
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

function buildNestedTask(overrides: Partial<INestedTask> = {}): INestedTask {
    return {
        _id: "task-1",
        text: "Buy groceries",
        metadata: { priority: 1, assignee: { name: "Ryan" } },
        tags: ["home", "errand"],
        ...overrides,
    };
}

function subscribeNestedNode(client: FakeConvexClient) {
    const node = Retree.root(
        new ConvexQueryNode(client, nestedTasksQuery, {
            args: { listId: "today" },
        })
    );
    Retree.on(node, "nodeChanged", () => undefined);
    return node;
}

describe("ConvexQueryNode nested document reconciliation", () => {
    it("does not emit for a row when nested values are deep-equal", () => {
        const client = new FakeConvexClient();
        const node = subscribeNestedNode(client);
        client.subscriptions[0].callback([buildNestedTask()]);

        const row = node.state?.[0];
        if (row === undefined) {
            throw new Error(
                "ConvexQueryNode test expected a reconciled nested row."
            );
        }
        const rowChanged = vi.fn();
        const rowTreeChanged = vi.fn();
        Retree.on(row, "nodeChanged", rowChanged);
        Retree.on(row, "treeChanged", rowTreeChanged);

        // Server emissions always produce fresh nested references; deep-equal
        // values must not write (and re-render) anything.
        client.subscriptions[0].callback([buildNestedTask()]);

        expect(rowChanged).not.toHaveBeenCalled();
        expect(rowTreeChanged).not.toHaveBeenCalled();
        expect(node.state?.[0]).toBe(row);
    });

    it("emits for a changed nested object and keeps its identity", () => {
        const client = new FakeConvexClient();
        const node = subscribeNestedNode(client);
        client.subscriptions[0].callback([buildNestedTask()]);

        const row = node.state?.[0];
        const metadata = row?.metadata;
        if (row === undefined) {
            throw new Error(
                "ConvexQueryNode test expected a reconciled nested row."
            );
        }
        if (metadata === null || metadata === undefined) {
            throw new Error(
                "ConvexQueryNode test expected nested metadata to exist."
            );
        }
        const rawMetadata = Retree.raw(metadata);
        const metadataChanged = vi.fn();
        const rowTreeChanged = vi.fn();
        Retree.on(metadata, "nodeChanged", metadataChanged);
        Retree.on(row, "treeChanged", rowTreeChanged);

        client.subscriptions[0].callback([
            buildNestedTask({
                metadata: { priority: 2, assignee: { name: "Ryan" } },
            }),
        ]);

        expect(metadataChanged).toHaveBeenCalled();
        expect(rowTreeChanged).toHaveBeenCalled();
        expect(node.state?.[0].metadata?.priority).toBe(2);
        expect(node.state?.[0].metadata?.assignee.name).toBe("Ryan");
        const nextMetadata = node.state?.[0].metadata;
        if (nextMetadata === null || nextMetadata === undefined) {
            throw new Error(
                "ConvexQueryNode test expected nested metadata to survive reconciliation."
            );
        }
        expect(Retree.raw(nextMetadata)).toBe(rawMetadata);
    });

    it("reconciles nested arrays in place, including length changes", () => {
        const client = new FakeConvexClient();
        const node = subscribeNestedNode(client);
        client.subscriptions[0].callback([buildNestedTask()]);

        const tags = node.state?.[0].tags;
        if (tags === undefined) {
            throw new Error(
                "ConvexQueryNode test expected nested tags to exist."
            );
        }
        const rawTags = Retree.raw(tags);

        client.subscriptions[0].callback([buildNestedTask({ tags: ["home"] })]);
        expect(node.state?.[0].tags).toEqual(["home"]);

        client.subscriptions[0].callback([
            buildNestedTask({ tags: ["home", "errand", "urgent"] }),
        ]);
        expect(node.state?.[0].tags).toEqual(["home", "errand", "urgent"]);

        const nextTags = node.state?.[0].tags;
        if (nextTags === undefined) {
            throw new Error(
                "ConvexQueryNode test expected nested tags to survive reconciliation."
            );
        }
        expect(Retree.raw(nextTags)).toBe(rawTags);
    });

    it("replaces nested values when the shape changes", () => {
        const client = new FakeConvexClient();
        const node = subscribeNestedNode(client);
        client.subscriptions[0].callback([buildNestedTask()]);

        const row = node.state?.[0];
        if (row === undefined) {
            throw new Error(
                "ConvexQueryNode test expected a reconciled nested row."
            );
        }
        const rowChanged = vi.fn();
        Retree.on(row, "nodeChanged", rowChanged);

        client.subscriptions[0].callback([buildNestedTask({ metadata: null })]);
        expect(rowChanged).toHaveBeenCalled();
        expect(node.state?.[0].metadata).toBeNull();

        client.subscriptions[0].callback([
            buildNestedTask({
                metadata: { priority: 5, assignee: { name: "Sam" } },
            }),
        ]);
        expect(node.state?.[0].metadata).toEqual({
            priority: 5,
            assignee: { name: "Sam" },
        });
    });

    it("reconciles nested fields through reconcileArray directly", () => {
        const current: {
            id: string;
            meta: { count: number };
            tags: string[];
        }[] = [{ id: "a", meta: { count: 1 }, tags: ["x", "y"] }];
        const meta = current[0].meta;
        const tags = current[0].tags;

        reconcileArray(
            current,
            [{ id: "a", meta: { count: 2 }, tags: ["x"] }],
            (item) => item.id
        );

        expect(current[0].meta).toBe(meta);
        expect(current[0].meta.count).toBe(2);
        expect(current[0].tags).toBe(tags);
        expect(current[0].tags).toEqual(["x"]);
    });
});

describe("ConvexPaginatedQueryNode reconciliation", () => {
    function subscribePaginatedDocsNode(client: FakeConvexClient) {
        const node = Retree.root(
            new ConvexPaginatedQueryNode(client, paginatedDocsQuery, {
                args: { listId: "today" },
                initialNumItems: 10,
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        return node;
    }

    it("keeps loaded row identity when loadMore lands", () => {
        const client = new FakeConvexClient();
        const node = subscribePaginatedDocsNode(client);
        const firstLoadMore = vi.fn(() => true);
        client.paginatedSubscriptions[0].callback({
            results: [{ _id: "message-1", text: "one" }],
            status: "CanLoadMore",
            loadMore: firstLoadMore,
        });

        const state = node.state;
        const row = node.state?.results[0];
        if (state === undefined) {
            throw new Error(
                "ConvexPaginatedQueryNode test expected paginated state."
            );
        }
        if (row === undefined) {
            throw new Error(
                "ConvexPaginatedQueryNode test expected a loaded row."
            );
        }
        const rawState = Retree.raw(state);
        const secondLoadMore = vi.fn(() => true);

        client.paginatedSubscriptions[0].callback({
            results: [
                { _id: "message-1", text: "one" },
                { _id: "message-2", text: "two" },
            ],
            status: "Exhausted",
            loadMore: secondLoadMore,
        });

        // Rows and the state object keep identity; only diffs were written.
        expect(node.state?.results[0]).toBe(row);
        const nextState = node.state;
        if (nextState === undefined) {
            throw new Error(
                "ConvexPaginatedQueryNode test expected paginated state to survive."
            );
        }
        expect(Retree.raw(nextState)).toBe(rawState);
        expect(node.state?.results).toHaveLength(2);
        expect(node.state?.status).toBe("Exhausted");
        expect(node.result.status).toBe("success");
        if (node.result.status !== "success") {
            throw new Error(
                "ConvexPaginatedQueryNode test expected a success result."
            );
        }
        expect(node.result.data.results).toEqual(node.state?.results);

        node.loadMore(5);
        expect(secondLoadMore).toHaveBeenCalledWith(5);
        expect(firstLoadMore).not.toHaveBeenCalled();
    });

    it("keeps unchanged rows silent when another page row changes", () => {
        const client = new FakeConvexClient();
        const node = subscribePaginatedDocsNode(client);
        const loadMore = vi.fn(() => true);
        client.paginatedSubscriptions[0].callback({
            results: [
                { _id: "message-1", text: "one" },
                { _id: "message-2", text: "two" },
            ],
            status: "CanLoadMore",
            loadMore,
        });

        const unchangedRow = node.state?.results[0];
        if (unchangedRow === undefined) {
            throw new Error(
                "ConvexPaginatedQueryNode test expected a loaded row."
            );
        }
        const unchangedRowChanged = vi.fn();
        Retree.on(unchangedRow, "nodeChanged", unchangedRowChanged);

        client.paginatedSubscriptions[0].callback({
            results: [
                { _id: "message-1", text: "one" },
                { _id: "message-2", text: "two (edited)" },
            ],
            status: "CanLoadMore",
            loadMore,
        });

        expect(unchangedRowChanged).not.toHaveBeenCalled();
        expect(node.state?.results[0]).toBe(unchangedRow);
        expect(node.state?.results[1].text).toBe("two (edited)");
    });
});

describe("Convex query node lifecycle", () => {
    it("disposes a standalone query node when its last observer unsubscribes and resubscribes when observed again", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );

        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(1);

        unsubscribe();
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();

        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(2);
        expect(client.subscriptions[1].args).toEqual({ listId: "today" });
    });

    it("disposes a standalone paginated query node when its last observer unsubscribes and resubscribes when observed again", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexPaginatedQueryNode(client, paginatedTasksQuery, {
                args: { listId: "today" },
                initialNumItems: 10,
            })
        );

        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);
        expect(client.paginatedSubscriptions).toHaveLength(1);

        unsubscribe();
        expect(
            client.paginatedSubscriptions[0].unsubscribe
        ).toHaveBeenCalledOnce();

        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.paginatedSubscriptions).toHaveLength(2);
    });

    it("keeps an independently observed child subscribed when its ConvexNode parent loses observers", () => {
        const client = new FakeConvexClient();

        class IndependentChildState extends ConvexNode {
            public readonly tasks: ConvexQueryNode<TasksQuery>;

            constructor(convexClient: IConvexClient) {
                super(convexClient);
                this.tasks = this.query(tasksQuery, {
                    args: { listId: "today" },
                });
            }

            get dependencies() {
                return [];
            }
        }

        const parent = Retree.root(new IndependentChildState(client));
        const unsubscribeChild = Retree.on(
            parent.tasks,
            "nodeChanged",
            () => undefined
        );
        const unsubscribeParent = Retree.on(
            parent,
            "nodeChanged",
            () => undefined
        );
        expect(client.subscriptions).toHaveLength(1);

        // The parent losing observers must not tear down a child that still
        // has its own observers.
        unsubscribeParent();
        expect(client.subscriptions[0].unsubscribe).not.toHaveBeenCalled();

        unsubscribeChild();
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    });

    it("stays disposed when node changes fire after dispose", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(1);

        node.dispose();
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();

        // Any write triggers onChanged; before disposal was sticky this
        // silently resurrected the Convex subscription.
        node.error = new Error("local write");
        expect(client.subscriptions).toHaveLength(1);
    });

    it("records updateArgs on a disposed node and resubscribes with the latest args on re-observe", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        node.dispose();

        node.updateArgs({ listId: "tomorrow" });
        expect(client.subscriptions).toHaveLength(1);

        Retree.clearListeners(node);
        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(2);
        expect(client.subscriptions[1].args).toEqual({ listId: "tomorrow" });
    });

    it("stops tracking ConvexNode children once they dispose", () => {
        const client = new FakeConvexClient();
        const state = new TestConvexNode(client);
        const child = Retree.root(state.tasksQuery());

        const unsubscribe = Retree.on(child, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(1);

        // Self-disposal on unobserve removes the child from parent tracking.
        unsubscribe();
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();

        // The child revives through observation and now manages its own
        // lifecycle; the parent's manual dispose must not tear it down.
        Retree.on(child, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(2);

        state.dispose();
        expect(client.subscriptions[1].unsubscribe).not.toHaveBeenCalled();
    });

    it("disposes tracked children through ConvexNode dispose for manual shutdown", () => {
        const client = new FakeConvexClient();
        const state = new TestConvexNode(client);
        const child = Retree.root(state.tasksQuery());
        Retree.on(child, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(1);

        state.dispose();
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    });
});

describe("ConvexQueryNode args and result lifecycle", () => {
    it("does not resubscribe when object args are deep-equal", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, filteredTasksQuery, {
                args: { filter: { listId: "today", tags: ["home"] } },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.subscriptions).toHaveLength(1);

        // Fresh object, deep-equal values: no dispose/reopen churn, no
        // pending flash.
        node.updateArgs({ filter: { listId: "today", tags: ["home"] } });
        expect(client.subscriptions).toHaveLength(1);

        node.updateArgs({ filter: { listId: "today", tags: ["work"] } });
        expect(client.subscriptions).toHaveLength(2);
    });

    it("does not resubscribe a paginated node when object args are deep-equal", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexPaginatedQueryNode(client, paginatedTasksQuery, {
                args: { listId: "today" },
                initialNumItems: 10,
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.paginatedSubscriptions).toHaveLength(1);

        node.updateArgs({ listId: "today" });
        expect(client.paginatedSubscriptions).toHaveLength(1);

        node.updateArgs({ listId: "tomorrow" });
        expect(client.paginatedSubscriptions).toHaveLength(2);
    });

    it("resets to pending on updateArgs by default", () => {
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

        node.updateArgs({ listId: "tomorrow" });

        expect(node.state).toBeUndefined();
        expect(node.result).toEqual({ status: "pending" });
    });

    it("keeps previous data marked stale while new args load when keepPreviousData is set", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
                keepPreviousData: true,
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        node.updateArgs({ listId: "tomorrow" });

        expect(client.subscriptions).toHaveLength(2);
        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.result.status).toBe("success");
        if (node.result.status !== "success") {
            throw new Error(
                "ConvexQueryNode test expected a stale success result."
            );
        }
        expect(node.result.isStale).toBe(true);
        expect(node.result.data).toEqual(node.state);

        client.subscriptions[1].callback([
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);
        expect(node.result.status).toBe("success");
        if (node.result.status !== "success") {
            throw new Error(
                "ConvexQueryNode test expected a fresh success result."
            );
        }
        expect(node.result.isStale).toBeUndefined();
        expect(node.state).toEqual([
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);
    });

    it("falls back to pending with keepPreviousData when there is no previous data", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
                keepPreviousData: true,
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);

        node.updateArgs({ listId: "tomorrow" });

        expect(node.result).toEqual({ status: "pending" });
    });

    it("shows the error instead of pending when the new watch's cached value is an error", () => {
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

        client.nextCurrentValueError = new Error("Query failed");
        node.updateArgs({ listId: "tomorrow" });

        expect(node.result.status).toBe("error");
        if (node.result.status !== "error") {
            throw new Error(
                "ConvexQueryNode test expected an error query result."
            );
        }
        expect(node.result.error.message).toBe("Query failed");
        expect(node.error?.message).toBe("Query failed");
    });

    it("retries an errored query with a fresh subscription", () => {
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        client.subscriptions[0].onError?.(new Error("Query failed"));
        expect(node.result.status).toBe("error");

        node.retry();

        expect(client.subscriptions).toHaveLength(2);
        expect(client.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(node.result).toEqual({ status: "pending" });

        client.subscriptions[1].callback([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.result.status).toBe("success");
    });

    it("ignores retry unless the result status is error", () => {
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

        node.retry();

        expect(client.subscriptions).toHaveLength(1);
        expect(node.result.status).toBe("success");
    });

    it("batches optimisticUpdate transform writes into one emission per node", () => {
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

        const task = node.state?.[0];
        if (task === undefined) {
            throw new Error("ConvexQueryNode test expected a task row.");
        }
        const taskChanged = vi.fn();
        Retree.on(task, "nodeChanged", taskChanged);

        node.optimisticUpdate({
            apply(tasks) {
                tasks[0].text = "Buy oat milk";
                tasks[0].isCompleted = true;
            },
        });

        expect(taskChanged).toHaveBeenCalledTimes(1);
        expect(node.state?.[0]).toEqual({
            id: "task-1",
            text: "Buy oat milk",
            isCompleted: true,
        });
    });

    it("warns in dev mode when optimisticUpdate no-ops because state is undefined", () => {
        const warn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        const client = new FakeConvexClient();
        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                args: { listId: "today" },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        const apply = vi.fn();

        node.optimisticUpdate({ apply });

        expect(apply).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain(
            "ConvexQueryNode.optimisticUpdate"
        );
    });
});
