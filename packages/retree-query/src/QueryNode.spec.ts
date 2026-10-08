import { describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { QueryNode } from "./QueryNode.js";
import { reconcileArrayById } from "./reconcile.js";
import {
    IQuerySubscriptionSource,
    IQuerySubscriptionHandle,
    IStateReconciler,
} from "./types.js";

interface ITaskArgs {
    listId: string;
}

interface ITask {
    id: string;
    text: string;
    isCompleted: boolean;
}

interface ITaskWithMeta {
    id: string;
    meta?: { owner: string };
}

class FakeQuerySource<TArgs, TState>
    implements IQuerySubscriptionSource<TArgs, TState>
{
    public readonly subscriptions: {
        args: TArgs;
        onValue: (value: TState) => void;
        onError: (error: Error) => void;
        unsubscribe: ReturnType<typeof vi.fn>;
    }[] = [];
    /**
     * When set, `getCurrentValue()` on new subscriptions returns this value
     * synchronously, mirroring a backend cache hit.
     */
    public nextCurrentValue: TState | undefined;
    /**
     * When set, `getCurrentValue()` on new subscriptions surfaces this error
     * through the subscription's error callback and returns `undefined`.
     */
    public nextCurrentValueError: Error | undefined;

    public subscribe(
        args: TArgs,
        onValue: (value: TState) => void,
        onError: (error: Error) => void
    ): IQuerySubscriptionHandle<TState> {
        const unsubscribe = vi.fn();
        this.subscriptions.push({ args, onValue, onError, unsubscribe });
        return {
            unsubscribe,
            getCurrentValue: () => {
                if (this.nextCurrentValueError !== undefined) {
                    onError(this.nextCurrentValueError);
                    return undefined;
                }
                return this.nextCurrentValue;
            },
        };
    }
}

function subscribeTasksNode(
    source: FakeQuerySource<ITaskArgs, ITask[]>,
    options?: { keepPreviousData?: boolean }
) {
    const node = Retree.root(
        new QueryNode(source, {
            args: { listId: "today" },
            keepPreviousData: options?.keepPreviousData,
        })
    );
    Retree.on(node, "nodeChanged", () => undefined);
    return node;
}

describe("QueryNode", () => {
    it("subscribes when observed and writes emitted values into state", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = Retree.root(
            new QueryNode(source, { args: { listId: "today" } })
        );
        expect(source.subscriptions).toHaveLength(0);

        const nodeChanged = vi.fn();
        Retree.on(node, "nodeChanged", nodeChanged);
        expect(source.subscriptions).toHaveLength(1);
        expect(source.subscriptions[0].args).toEqual({ listId: "today" });

        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.result).toEqual({
            status: "success",
            data: [{ id: "task-1", text: "Buy groceries", isCompleted: false }],
        });
        expect(nodeChanged).toHaveBeenCalled();
    });

    it("exposes initialState as a success result before the source emits", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = Retree.root(
            new QueryNode(source, {
                args: { listId: "today" },
                initialState: [],
            })
        );

        expect(node.state).toEqual([]);
        expect(node.result).toEqual({ status: "success", data: [] });
    });

    it("uses a synchronously cached value from the new subscription", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        source.nextCurrentValue = [
            { id: "task-1", text: "Cached", isCompleted: false },
        ];
        const node = subscribeTasksNode(source);

        expect(node.result).toEqual({
            status: "success",
            data: [{ id: "task-1", text: "Cached", isCompleted: false }],
        });
    });

    it("tracks pending, success, and error statuses", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source);
        expect(node.result).toEqual({ status: "pending" });

        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.result.status).toBe("success");

        source.subscriptions[0].onError(new Error("Query failed"));
        expect(node.result.status).toBe("error");
        if (node.result.status !== "error") {
            throw new Error("QueryNode test expected an error query result.");
        }
        expect(node.result.error.message).toBe("Query failed");
        expect(node.error?.message).toBe("Query failed");
    });

    it("skips subscriptions from the constructor and updateArgs", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = Retree.root(new QueryNode(source, "skip"));
        Retree.on(node, "nodeChanged", () => undefined);

        expect(source.subscriptions).toHaveLength(0);
        expect(node.result).toEqual({ status: "skipped" });

        node.updateArgs({ listId: "today" });
        expect(source.subscriptions).toHaveLength(1);
        expect(node.result).toEqual({ status: "pending" });

        node.updateArgs("skip");
        expect(source.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(node.state).toBeUndefined();
        expect(node.result).toEqual({ status: "skipped" });
    });

    it("resubscribes when args change and not when they are deep-equal", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source);
        expect(source.subscriptions).toHaveLength(1);

        node.updateArgs({ listId: "today" });
        expect(source.subscriptions).toHaveLength(1);

        node.updateArgs({ listId: "tomorrow" });
        expect(source.subscriptions).toHaveLength(2);
        expect(source.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(source.subscriptions[1].args).toEqual({ listId: "tomorrow" });
    });

    it("keeps previous data marked stale while new args load when keepPreviousData is set", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source, { keepPreviousData: true });
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        node.updateArgs({ listId: "tomorrow" });

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.result.status).toBe("success");
        if (node.result.status !== "success") {
            throw new Error("QueryNode test expected a stale success result.");
        }
        expect(node.result.isStale).toBe(true);

        source.subscriptions[1].onValue([
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);
        expect(node.result.status).toBe("success");
        if (node.result.status !== "success") {
            throw new Error("QueryNode test expected a fresh success result.");
        }
        expect(node.result.isStale).toBeUndefined();
    });

    it("keeps a synchronously surfaced error visible instead of resetting to pending", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        source.nextCurrentValueError = new Error("Query failed");
        node.updateArgs({ listId: "tomorrow" });

        expect(node.result.status).toBe("error");
        if (node.result.status !== "error") {
            throw new Error("QueryNode test expected an error query result.");
        }
        expect(node.result.error.message).toBe("Query failed");
    });

    it("retries an errored query with a fresh subscription and ignores retry otherwise", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        node.retry();
        expect(source.subscriptions).toHaveLength(1);

        source.subscriptions[0].onError(new Error("Query failed"));
        node.retry();

        expect(source.subscriptions).toHaveLength(2);
        expect(source.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
        expect(node.result).toEqual({ status: "pending" });
    });

    it("disposes on last unobserve, stays disposed through writes, and resubscribes when observed again", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = Retree.root(
            new QueryNode(source, { args: { listId: "today" } })
        );

        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);
        expect(source.subscriptions).toHaveLength(1);

        unsubscribe();
        expect(source.subscriptions[0].unsubscribe).toHaveBeenCalledOnce();

        Retree.on(node, "nodeChanged", () => undefined);
        expect(source.subscriptions).toHaveLength(2);

        node.dispose();
        expect(source.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();

        // Any write triggers onChanged; sticky disposal must not resurrect
        // the subscription.
        node.error = new Error("local write");
        expect(source.subscriptions).toHaveLength(2);
    });

    it("records updateArgs on a disposed node and resubscribes with the latest args on re-observe", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source);
        node.dispose();

        node.updateArgs({ listId: "tomorrow" });
        expect(source.subscriptions).toHaveLength(1);

        Retree.clearListeners(node);
        Retree.on(node, "nodeChanged", () => undefined);
        expect(source.subscriptions).toHaveLength(2);
        expect(source.subscriptions[1].args).toEqual({ listId: "tomorrow" });
    });

    it("reconciles emissions through a configured reconciler, preserving item identity", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = Retree.root(
            new QueryNode(source, {
                args: { listId: "today" },
                reconcile: reconcileArrayById("id"),
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);

        const unchangedTask = node.state?.[1];
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
            { id: "task-2", text: "Read docs", isCompleted: false },
        ]);

        expect(node.state?.[0]?.isCompleted).toBe(true);
        expect(node.state?.[1]).toBe(unchangedTask);
    });

    it("passes a raw read view to custom reconcilers (read raw, write current)", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const seen: { current: unknown; rawCurrent: unknown }[] = [];
        const node = Retree.root(
            new QueryNode<ITaskArgs, ITask[]>(source, {
                args: { listId: "today" },
                reconcile: {
                    reconcile(current, next, rawCurrent) {
                        seen.push({ current, rawCurrent });
                        if (current === undefined) {
                            return next;
                        }
                        if (rawCurrent?.[0]?.text !== next[0]?.text) {
                            current[0]!.text = next[0]!.text;
                        }
                        return current;
                    },
                },
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        const task = node.state?.[0];
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy oat milk", isCompleted: false },
        ]);

        expect(seen[0].current).toBeUndefined();
        expect(seen[0].rawCurrent).toBeUndefined();
        expect(seen[1].current).toBeDefined();
        expect(seen[1].rawCurrent).toBe(Retree.raw(seen[1].current as ITask[]));
        expect(node.state?.[0]).toBe(task);
        expect(node.state?.[0]?.text).toBe("Buy oat milk");
    });

    it("supports bigint state through emission and optimistic rollback", async () => {
        const source = new FakeQuerySource<
            Record<string, never>,
            { views: bigint }
        >();
        const node = Retree.root(new QueryNode(source, { args: {} }));
        Retree.on(node, "nodeChanged", () => undefined);

        source.subscriptions[0].onValue({ views: 5n });
        expect(node.state).toEqual({ views: 5n });

        node.optimisticUpdate({
            ctx: { promise: Promise.reject(new Error("Mutation failed")) },
            apply(stats) {
                stats.views = 6n;
            },
        });
        expect(node.state?.views).toBe(6n);

        await Promise.resolve();

        expect(node.state?.views).toBe(5n);
        expect(node.error?.message).toBe("Mutation failed");
    });
});

describe("QueryNode optimistic updates", () => {
    function subscribeWithTask(source: FakeQuerySource<ITaskArgs, ITask[]>) {
        const node = subscribeTasksNode(source);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        return node;
    }

    it("keeps optimistic state when the mutation succeeds", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);

        node.optimisticUpdate({
            ctx: { promise: Promise.resolve(null) },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("rolls optimistic state back when the mutation fails", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);

        node.optimisticUpdate({
            ctx: { promise: Promise.reject(new Error("Mutation failed")) },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        expect(node.state?.[0]?.isCompleted).toBe(true);

        await Promise.resolve();

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);
        expect(node.error?.message).toBe("Mutation failed");
    });

    it("uses a custom revert instead of the default baseline restore", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);
        const revert = vi.fn<(state: ITask[], snapshot: ITask[]) => void>(
            (state, snapshot) => {
                state[0].isCompleted = snapshot[0].isCompleted;
            }
        );

        node.optimisticUpdate({
            ctx: { promise: Promise.reject(new Error("Mutation failed")) },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
            revert,
        });

        await Promise.resolve();

        expect(revert).toHaveBeenCalledOnce();
        expect(node.state?.[0]?.isCompleted).toBe(false);
    });

    it("keeps dirty optimistic state when the server echoes the last clean value", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);

        node.optimisticUpdate({
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ]);
    });

    it("clears dirty optimistic state when the server sends a changed value", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);

        node.optimisticUpdate({
            ctx: { promise: Promise.reject(new Error("Mutation failed")) },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        source.subscriptions[0].onValue([
            { id: "task-1", text: "From the server", isCompleted: false },
        ]);

        await Promise.resolve();

        expect(node.state).toEqual([
            { id: "task-1", text: "From the server", isCompleted: false },
        ]);
        expect(node.error).toBeNull();
    });

    it("keeps newer optimistic state while a newer optimistic mutation is pending", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);
        let resolveFirstMutation!: () => void;
        const firstMutation = new Promise<null>((resolve) => {
            resolveFirstMutation = () => resolve(null);
        });
        const secondMutation = new Promise<null>(() => undefined);

        node.optimisticUpdate({
            ctx: { promise: firstMutation },
            apply(tasks) {
                tasks[0].text = "Buy groceries A";
            },
        });
        node.optimisticUpdate({
            ctx: { promise: secondMutation },
            apply(tasks) {
                tasks[0].text = "Buy groceries B";
            },
        });

        resolveFirstMutation();
        await firstMutation;
        await Promise.resolve();
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries A", isCompleted: false },
        ]);

        expect(node.state).toEqual([
            { id: "task-1", text: "Buy groceries B", isCompleted: false },
        ]);
    });

    it("rolls back to a baseline confirmed mid-window when the newest mutation fails", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);
        let resolveFirstMutation!: () => void;
        const firstMutation = new Promise<null>((resolve) => {
            resolveFirstMutation = () => resolve(null);
        });
        let rejectSecondMutation!: () => void;
        const secondMutation = new Promise<null>((_, reject) => {
            rejectSecondMutation = () => reject(new Error("Mutation failed"));
        });

        node.optimisticUpdate({
            ctx: { promise: firstMutation },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        node.optimisticUpdate({
            ctx: { promise: secondMutation },
            apply(tasks) {
                tasks[0].text = "Optimistic text";
            },
        });

        resolveFirstMutation();
        await firstMutation;
        // Server confirms the first mutation while the second is pending.
        source.subscriptions[0].onValue([
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

    it("re-observes a cached result that an overlapping rollback restored", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const first = Retree.root(
            new QueryNode(source, { args: { listId: "today" } })
        );
        const second = Retree.root(
            new QueryNode(source, { args: { listId: "today" } })
        );
        let resolveFirstMutation!: () => void;
        const firstMutation = new Promise<null>((resolve) => {
            resolveFirstMutation = () => resolve(null);
        });
        let rejectSecondMutation!: () => void;
        const secondMutation = new Promise<null>((_, reject) => {
            rejectSecondMutation = () => reject(new Error("Mutation failed"));
        });
        const stopFirst = Retree.on(first, "nodeChanged", () => undefined);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Buy groceries", isCompleted: false },
        ]);

        first.optimisticUpdate({
            ctx: { promise: firstMutation },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });
        first.optimisticUpdate({
            ctx: { promise: secondMutation },
            apply(tasks) {
                tasks[0].text = "Optimistic text";
            },
        });
        resolveFirstMutation();
        await firstMutation;
        // The backend caches the object it emits, so the next subscriber
        // receives this same instance.
        const cached = [
            { id: "task-1", text: "Buy groceries", isCompleted: true },
        ];
        source.nextCurrentValue = cached;
        source.subscriptions[0].onValue(cached);
        rejectSecondMutation();
        await secondMutation.catch(() => undefined);
        stopFirst();

        Retree.on(second, "nodeChanged", () => undefined);

        expect(first.state).toEqual(cached);
        expect(second.state).toEqual(cached);
        expect(source.subscriptions).toHaveLength(2);
    });

    it("warns in dev mode when optimisticUpdate no-ops because state is undefined", () => {
        const warn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeTasksNode(source);
        const apply = vi.fn();

        node.optimisticUpdate({ apply });

        expect(apply).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain("QueryNode.optimisticUpdate");
    });

    it("wraps non-Error rejections in a pinpointed error", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const node = subscribeWithTask(source);

        node.optimisticUpdate({
            ctx: { promise: Promise.reject("boom") },
            apply(tasks) {
                tasks[0].isCompleted = true;
            },
        });

        await Promise.resolve();

        expect(node.error?.message).toBe(
            "QueryNode.optimisticUpdate: mutation failed with a non-Error rejection: boom"
        );
    });
});

describe("QueryNode shared source values", () => {
    function subscribeTwo(
        source: FakeQuerySource<ITaskArgs, ITask[]>,
        reconcile?: IStateReconciler<ITask[]>
    ) {
        const nodes = [0, 1].map(() =>
            Retree.root(
                new QueryNode(source, { args: { listId: "today" }, reconcile })
            )
        );
        for (const node of nodes) {
            Retree.on(node, "nodeChanged", () => undefined);
        }
        return nodes;
    }

    it("observes one cached result from two queries without sharing it", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const cached = [{ id: "task-1", text: "Server", isCompleted: false }];
        source.nextCurrentValue = cached;
        const [first, second] = subscribeTwo(source);

        first.state![0].text = "Edited";

        expect(first.state![0].text).toBe("Edited");
        expect(second.state![0].text).toBe("Server");
        expect(cached[0].text).toBe("Server");
    });

    it("copies rows that reconciliation inserts", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const [first, second] = subscribeTwo(source, reconcileArrayById("id"));
        const initial = { id: "task-1", text: "First", isCompleted: false };
        source.subscriptions[0].onValue([{ ...initial }]);
        source.subscriptions[1].onValue([{ ...initial }]);

        const next = [
            initial,
            { id: "task-2", text: "Second", isCompleted: false },
        ];
        source.subscriptions[0].onValue(next);
        source.subscriptions[1].onValue(next);
        first.state![1].text = "Edited";

        expect(second.state![1].text).toBe("Second");
        expect(next[1].text).toBe("Second");
    });

    it("copies objects that reconciliation writes into existing rows", () => {
        const source = new FakeQuerySource<ITaskArgs, ITaskWithMeta[]>();
        const nodes = [0, 1].map(() =>
            Retree.root(
                new QueryNode(source, {
                    args: { listId: "today" },
                    reconcile: reconcileArrayById<ITaskWithMeta, "id">("id"),
                })
            )
        );
        for (const node of nodes) {
            Retree.on(node, "nodeChanged", () => undefined);
        }
        source.subscriptions[0].onValue([{ id: "task-1" }]);
        source.subscriptions[1].onValue([{ id: "task-1" }]);

        const next = [{ id: "task-1", meta: { owner: "Ada" } }];
        source.subscriptions[0].onValue(next);
        source.subscriptions[1].onValue(next);
        nodes[0].state![0].meta!.owner = "Grace";

        expect(nodes[1].state![0].meta?.owner).toBe("Ada");
        expect(next[0].meta.owner).toBe("Ada");
    });

    it("copies a replacement value but keeps rows it reuses", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const replaceById: IStateReconciler<ITask[]> = {
            reconcile(current, next) {
                return next.map(
                    (task) => current?.find((row) => row.id === task.id) ?? task
                );
            },
        };
        const [first, second] = subscribeTwo(source, replaceById);
        const initial = { id: "task-1", text: "First", isCompleted: false };
        source.subscriptions[0].onValue([{ ...initial }]);
        source.subscriptions[1].onValue([{ ...initial }]);
        const row = first.state![0];

        const next = [
            initial,
            { id: "task-2", text: "Second", isCompleted: false },
        ];
        source.subscriptions[0].onValue(next);
        source.subscriptions[1].onValue(next);
        first.state![1].text = "Edited";

        expect(first.state![0]).toBe(row);
        expect(second.state![1].text).toBe("Second");
    });

    it("rolls back when a custom reconciler adopts emitted rows", async () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const adoptRows: IStateReconciler<ITask[]> = {
            reconcile(current, next) {
                if (current === undefined) return next;
                next.forEach((task, index) => {
                    current[index] = task;
                });
                return current;
            },
        };
        const node = Retree.root(
            new QueryNode(source, {
                args: { listId: "today" },
                reconcile: adoptRows,
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Server", isCompleted: false },
        ]);
        source.subscriptions[0].onValue([
            { id: "task-1", text: "Server", isCompleted: true },
        ]);
        const mutation = Promise.reject(new Error("Mutation failed"));

        node.optimisticUpdate({
            ctx: { promise: mutation },
            apply(tasks) {
                tasks[0].text = "Optimistic";
            },
        });
        await mutation.catch(() => undefined);

        expect(node.state![0].text).toBe("Server");
    });

    it("gives each query its own copy of a shared initial state", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const empty: ITask[] = [];
        const [first, second] = [0, 1].map(() =>
            Retree.root(
                new QueryNode(source, {
                    args: { listId: "today" },
                    initialState: empty,
                })
            )
        );

        first.state!.push({ id: "task-1", text: "Local", isCompleted: false });

        expect(second.state).toEqual([]);
        expect(empty).toEqual([]);
    });

    it("keeps state when the source repeats the emission it mirrors", () => {
        const source = new FakeQuerySource<ITaskArgs, ITask[]>();
        const cached = [{ id: "task-1", text: "Server", isCompleted: false }];
        source.nextCurrentValue = cached;
        const node = Retree.root(
            new QueryNode(source, { args: { listId: "today" } })
        );
        Retree.on(node, "nodeChanged", () => undefined)();
        const state = node.state;

        Retree.on(node, "nodeChanged", () => undefined);

        expect(node.state).toBe(state);
    });

    it("shares frozen leaves instead of copying them", () => {
        const source = new FakeQuerySource<ITaskArgs, { task: ITask }>();
        const task = Object.freeze({
            id: "task-1",
            text: "Server",
            isCompleted: false,
        });
        source.nextCurrentValue = { task };
        const node = Retree.root(
            new QueryNode(source, { args: { listId: "today" } })
        );
        Retree.on(node, "nodeChanged", () => undefined);

        expect(node.state?.task).toBe(task);
    });
});
