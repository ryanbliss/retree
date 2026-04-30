import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree";
import { Transactions } from "./internals/transactions";

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    Retree.clearListeners(node as never);
    if (node instanceof Map) {
        for (const value of node.values()) {
            clearListenersRecursively(value, seen);
        }
        return;
    }
    if (node instanceof Set) {
        for (const value of node.values()) {
            clearListenersRecursively(value, seen);
        }
        return;
    }
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

describe("Map within Retree proxy", () => {
    describe("as a child of the root", () => {
        it("supports set/get/has/size on a Map child", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );

            root.map.set("a", 1);
            root.map.set("b", 2);

            expect(root.map.get("a")).toBe(1);
            expect(root.map.get("b")).toBe(2);
            expect(root.map.has("a")).toBe(true);
            expect(root.map.has("missing")).toBe(false);
            expect(root.map.size).toBe(2);
        });

        it("supports delete and clear on a Map child", () => {
            const root = trackRoot(
                Retree.root({
                    map: new Map<string, number>([
                        ["a", 1],
                        ["b", 2],
                    ]),
                })
            );

            expect(root.map.delete("a")).toBe(true);
            expect(root.map.has("a")).toBe(false);
            expect(root.map.size).toBe(1);

            root.map.clear();
            expect(root.map.size).toBe(0);
        });

        it("supports iteration on a Map child", () => {
            const root = trackRoot(
                Retree.root({
                    map: new Map<string, number>([
                        ["a", 1],
                        ["b", 2],
                    ]),
                })
            );

            const entries = Array.from(root.map.entries());
            expect(entries).toEqual([
                ["a", 1],
                ["b", 2],
            ]);
            const keys = Array.from(root.map.keys());
            expect(keys).toEqual(["a", "b"]);
            const values = Array.from(root.map.values());
            expect(values).toEqual([1, 2]);

            const forEachKeys: string[] = [];
            root.map.forEach((_value, key) => forEachKeys.push(key));
            expect(forEachKeys).toEqual(["a", "b"]);

            const spreadKeys = [...root.map].map(([key]) => key);
            expect(spreadKeys).toEqual(["a", "b"]);
        });
    });

    describe("listener emission", () => {
        it("emits nodeChanged when a Map child is mutated via set", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            const nodeChanged = vi.fn();
            Retree.on(root.map, "nodeChanged", nodeChanged);

            root.map.set("a", 1);

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            const reproxy = nodeChanged.mock.calls[0]?.[0] as Map<
                string,
                number
            >;
            expect(reproxy.get("a")).toBe(1);
        });

        it("emits nodeChanged when a Map child is mutated via delete", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>([["a", 1]]) })
            );
            const nodeChanged = vi.fn();
            Retree.on(root.map, "nodeChanged", nodeChanged);

            root.map.delete("a");

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(root.map.has("a")).toBe(false);
        });

        it("emits nodeChanged when a Map child is cleared", () => {
            const root = trackRoot(
                Retree.root({
                    map: new Map<string, number>([
                        ["a", 1],
                        ["b", 2],
                    ]),
                })
            );
            const nodeChanged = vi.fn();
            Retree.on(root.map, "nodeChanged", nodeChanged);

            root.map.clear();

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(root.map.size).toBe(0);
        });

        it("emits treeChanged on the parent when a Map child is mutated", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            const treeChanged = vi.fn();
            Retree.on(root, "treeChanged", treeChanged);

            root.map.set("a", 1);

            expect(treeChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe("object values", () => {
        it("proxies object values stored in a Map", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, { count: number }>() })
            );
            const inner = { count: 0 };
            root.map.set("a", inner);

            const stored = root.map.get("a")!;
            // Parent of an object value should be the map it was set into.
            expect(Retree.parent(stored)).toBe(root.map);
        });

        it("emits treeChanged on the parent when a Map's object value mutates", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, { count: number }>() })
            );
            root.map.set("a", { count: 0 });

            const treeChanged = vi.fn();
            Retree.on(root, "treeChanged", treeChanged);

            const inner = root.map.get("a")!;
            inner.count = 1;

            expect(treeChanged).toHaveBeenCalledTimes(1);
        });

        it("proxies object values that were already in the Map at root time", () => {
            const inner = { count: 0 };
            const root = trackRoot(
                Retree.root({
                    map: new Map<string, { count: number }>([["a", inner]]),
                })
            );

            const stored = root.map.get("a")!;
            expect(Retree.parent(stored)).toBe(root.map);

            const treeChanged = vi.fn();
            Retree.on(root, "treeChanged", treeChanged);
            stored.count = 1;
            expect(treeChanged).toHaveBeenCalledTimes(1);
        });

        it("emits nodeRemoved when an object value is replaced via set", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, { count: number }>() })
            );
            root.map.set("a", { count: 0 });
            const original = root.map.get("a")!;

            const removed = vi.fn();
            Retree.on(original, "nodeRemoved", removed);

            root.map.set("a", { count: 5 });
            expect(removed).toHaveBeenCalledTimes(1);
        });

        it("emits nodeRemoved when an object value is removed via delete", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, { count: number }>() })
            );
            root.map.set("a", { count: 0 });
            const original = root.map.get("a")!;

            const removed = vi.fn();
            Retree.on(original, "nodeRemoved", removed);

            root.map.delete("a");
            expect(removed).toHaveBeenCalledTimes(1);
        });

        it("returns the same proxy reference for repeated reads", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, { count: number }>() })
            );
            root.map.set("a", { count: 0 });

            const first = root.map.get("a");
            const second = root.map.get("a");
            expect(first).toBe(second);
        });
    });

    describe("chaining and identity", () => {
        it("supports chaining Map.set calls", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );

            root.map.set("a", 1).set("b", 2).set("c", 3);
            expect(root.map.size).toBe(3);
            expect(root.map.get("c")).toBe(3);
        });

        it("does not emit when delete is called on a missing key", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            const nodeChanged = vi.fn();
            Retree.on(root.map, "nodeChanged", nodeChanged);

            const result = root.map.delete("missing");
            expect(result).toBe(false);
            expect(nodeChanged).not.toHaveBeenCalled();
        });

        it("does not emit when clear is called on an empty Map", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            const nodeChanged = vi.fn();
            Retree.on(root.map, "nodeChanged", nodeChanged);

            root.map.clear();
            expect(nodeChanged).not.toHaveBeenCalled();
        });
    });

    describe("transactions and root usage", () => {
        it("batches multiple Map mutations in a transaction", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            const nodeChanged = vi.fn();
            Retree.on(root.map, "nodeChanged", nodeChanged);

            Retree.runTransaction(() => {
                root.map.set("a", 1);
                root.map.set("b", 2);
                root.map.set("c", 3);
            });

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(root.map.size).toBe(3);
        });

        it("works when a Map is the root node", () => {
            const root = trackRoot(Retree.root(new Map<string, number>()));
            const nodeChanged = vi.fn();
            Retree.on(root, "nodeChanged", nodeChanged);

            root.set("a", 1);
            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(root.get("a")).toBe(1);
        });

        it("allows mutating the Map via the reproxy passed to listeners", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            let lastReproxy: Map<string, number> | undefined;
            Retree.on(root.map, "nodeChanged", (reproxy) => {
                lastReproxy = reproxy as Map<string, number>;
            });

            root.map.set("a", 1);
            expect(lastReproxy).toBeDefined();
            // Calling a Map method on the reproxy should not throw.
            expect(lastReproxy!.get("a")).toBe(1);
        });
    });

    describe("Set within Retree proxy", () => {
        it("supports add/has/delete/clear on a Set child", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));

            root.set.add(1);
            root.set.add(2);
            expect(root.set.has(1)).toBe(true);
            expect(root.set.size).toBe(2);

            expect(root.set.delete(1)).toBe(true);
            expect(root.set.has(1)).toBe(false);

            root.set.clear();
            expect(root.set.size).toBe(0);
        });

        it("emits nodeChanged on Set add/delete/clear", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            const nodeChanged = vi.fn();
            Retree.on(root.set, "nodeChanged", nodeChanged);

            root.set.add(1);
            root.set.add(1); // duplicate, no emit
            root.set.delete(1);
            root.set.delete(1); // missing, no emit
            root.set.add(2);
            root.set.clear();

            expect(nodeChanged).toHaveBeenCalledTimes(4);
        });
    });
});
