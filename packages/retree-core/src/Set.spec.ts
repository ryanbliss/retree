import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { INodeFieldChanges } from "./types.js";
import { Transactions } from "./internals/transactions.js";

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

describe("Set within Retree proxy", () => {
    describe("as a child of the root", () => {
        it("supports add/has/delete/clear/size on a Set child", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));

            root.set.add(1);
            root.set.add(2);
            expect(root.set.has(1)).toBe(true);
            expect(root.set.has(3)).toBe(false);
            expect(root.set.size).toBe(2);

            expect(root.set.delete(1)).toBe(true);
            expect(root.set.has(1)).toBe(false);
            expect(root.set.size).toBe(1);

            root.set.clear();
            expect(root.set.size).toBe(0);
        });

        it("supports iteration on a Set child", () => {
            const root = trackRoot(
                Retree.root({ set: new Set<number>([1, 2]) })
            );

            expect(Array.from(root.set.values())).toEqual([1, 2]);
            expect(Array.from(root.set.keys())).toEqual([1, 2]);
            expect(Array.from(root.set.entries())).toEqual([
                [1, 1],
                [2, 2],
            ]);

            const forEachValues: number[] = [];
            root.set.forEach((value, valueAgain) => {
                expect(valueAgain).toBe(value);
                forEachValues.push(value);
            });
            expect(forEachValues).toEqual([1, 2]);

            expect([...root.set]).toEqual([1, 2]);
        });
    });

    describe("listener emission", () => {
        it("emits nodeChanged once per add/delete/clear and skips no-ops", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            const nodeChanged = vi.fn();
            Retree.on(root.set, "nodeChanged", nodeChanged);

            root.set.add(1);
            root.set.add(1); // duplicate, no emit
            root.set.delete(1);
            root.set.delete(1); // missing, no emit
            root.set.add(2);
            root.set.clear();
            root.set.clear(); // already empty, no emit

            expect(nodeChanged).toHaveBeenCalledTimes(4);
        });

        it("emits change records naming the operation and raw set", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            const received: INodeFieldChanges[][] = [];
            Retree.on(root.set, "nodeChanged", (_node, changes) => {
                received.push(changes);
            });

            root.set.add(1);
            root.set.delete(1);
            root.set.add(2);
            root.set.clear();

            const rawSet = Retree.raw(root.set);
            expect(received[0]).toEqual([
                { node: rawSet, key: "add", previous: undefined, new: 1 },
            ]);
            expect(received[1]).toEqual([
                { node: rawSet, key: "delete", previous: 1, new: undefined },
            ]);
            // clear emits one "delete" record per discarded member (exact
            // inversion metadata) followed by the summary record.
            expect(received[3]).toEqual([
                { node: rawSet, key: "delete", previous: 2, new: undefined },
                {
                    node: rawSet,
                    key: "clear",
                    previous: 1,
                    new: 0,
                    op: "clear",
                },
            ]);
        });

        it("emits treeChanged on the parent when a Set child is mutated", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            const treeChanged = vi.fn();
            Retree.on(root, "treeChanged", treeChanged);

            root.set.add(1);

            expect(treeChanged).toHaveBeenCalledTimes(1);
        });

        it("works when a Set is the root node", () => {
            const root = trackRoot(Retree.root(new Set<string>()));
            const nodeChanged = vi.fn();
            Retree.on(root, "nodeChanged", nodeChanged);

            root.add("a");
            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(root.has("a")).toBe(true);
        });
    });

    describe("object members", () => {
        it("parents object values added to a Set", () => {
            const root = trackRoot(
                Retree.root({ set: new Set<{ count: number }>() })
            );
            const raw = { count: 0 };

            root.set.add(raw);

            const stored = [...root.set][0];
            if (stored === undefined) {
                throw new Error("Expected an added Set object value.");
            }
            expect(stored).not.toBe(raw);
            expect(root.set.has(raw)).toBe(true);
            expect(root.set.has(stored)).toBe(true);
            expect(Retree.parent(stored)).toBe(root.set);
        });

        it("keeps the raw set pure: raw members only, managed reads via cache", () => {
            const raw = { count: 0 };
            const sourceSet = new Set<{ count: number }>([raw]);
            const root = trackRoot(Retree.root({ set: sourceSet }));

            const stored = [...root.set][0];
            if (stored === undefined) {
                throw new Error("Expected an original Set object value.");
            }
            expect(stored).not.toBe(raw);
            // Raw purity: the raw set keeps the raw member.
            expect(sourceSet.has(raw)).toBe(true);
            expect(sourceSet.has(stored)).toBe(false);
            expect(Retree.raw(stored)).toBe(raw);
            // Repeated reads serve the same managed member.
            expect([...root.set][0]).toBe(stored);
        });

        it("adding a managed node stores its raw value in the raw set", () => {
            const root = trackRoot(
                Retree.root({
                    item: { count: 1 },
                    set: new Set<{ count: number }>(),
                })
            );

            // Reparenting an owned node into the set is invalid; move it.
            Retree.move(root.item, root.set);

            const rawSet = Retree.raw(root.set);
            expect(rawSet.size).toBe(1);
            expect([...rawSet][0]).toBe(Retree.raw([...root.set][0]!));
            expect(Retree.parent([...root.set][0]!)).toBe(root.set);
        });

        it("emits treeChanged on the parent when a Set object member mutates", () => {
            const root = trackRoot(
                Retree.root({ set: new Set<{ count: number }>() })
            );
            root.set.add({ count: 0 });
            const stored = [...root.set][0];
            if (stored === undefined) {
                throw new Error("Expected an added Set object value.");
            }
            const treeChanged = vi.fn();
            Retree.on(root, "treeChanged", treeChanged);

            stored.count = 1;

            expect(treeChanged).toHaveBeenCalledTimes(1);
        });

        it("emits nodeRemoved and clears parent links when object members are deleted", () => {
            const raw = { count: 0 };
            const root = trackRoot(
                Retree.root({ set: new Set<{ count: number }>([raw]) })
            );
            const stored = [...root.set][0];
            if (stored === undefined) {
                throw new Error("Expected a lazily proxied Set value.");
            }
            const removed = vi.fn();
            Retree.on(stored, "nodeRemoved", removed);

            // Deleting via the managed member or the raw value both work.
            expect(root.set.delete(raw)).toBe(true);

            expect(removed).toHaveBeenCalledTimes(1);
            expect(root.set.size).toBe(0);
            expect(Retree.parent(stored)).toBeNull();
        });

        it("deletes by managed member identity as well as raw identity", () => {
            const raw = { count: 0 };
            const root = trackRoot(
                Retree.root({ set: new Set<{ count: number }>([raw]) })
            );
            const stored = [...root.set][0];
            if (stored === undefined) {
                throw new Error("Expected a lazily proxied Set value.");
            }
            const removed = vi.fn();
            Retree.on(stored, "nodeRemoved", removed);

            expect(root.set.has(stored)).toBe(true);
            expect(root.set.delete(stored)).toBe(true);

            expect(removed).toHaveBeenCalledTimes(1);
            expect(Retree.parent(stored)).toBeNull();
        });

        it("emits nodeRemoved for object members on clear", () => {
            const root = trackRoot(
                Retree.root({ set: new Set<{ count: number }>() })
            );
            root.set.add({ count: 0 });
            root.set.add({ count: 1 });
            const members = [...root.set];
            const removed = vi.fn();
            for (const member of members) {
                Retree.on(member, "nodeRemoved", removed);
            }

            root.set.clear();

            expect(removed).toHaveBeenCalledTimes(2);
            expect(Retree.parent(members[0]!)).toBeNull();
            expect(Retree.parent(members[1]!)).toBeNull();
        });

        it("iterates managed members through values/entries/forEach", () => {
            const first = { count: 1 };
            const second = { count: 2 };
            const root = trackRoot(
                Retree.root({
                    set: new Set<{ count: number }>([first, second]),
                })
            );

            const values = [...root.set.values()];
            expect(values[0]).not.toBe(first);
            expect(values[1]).not.toBe(second);
            expect(Retree.parent(values[0]!)).toBe(root.set);
            expect(Retree.parent(values[1]!)).toBe(root.set);

            const entries = [...root.set.entries()];
            expect(entries[0]?.[0]).toBe(values[0]);
            expect(entries[0]?.[1]).toBe(values[0]);

            const forEachValues: { count: number }[] = [];
            root.set.forEach((value) => forEachValues.push(value));
            expect(forEachValues).toEqual(values);
        });

        it("reacts after replacing a Set with fresh object values and then mutating a value", () => {
            const root = trackRoot(
                Retree.root({
                    set: new Set<{ count: number }>([{ count: 0 }]),
                })
            );
            const treeChanged = vi.fn();
            Retree.on(root, "treeChanged", treeChanged);

            root.set = new Set<{ count: number }>([{ count: 1 }]);
            treeChanged.mockClear();
            const stored = [...root.set][0];
            if (stored === undefined) {
                throw new Error("Expected replacement Set value to exist.");
            }
            stored.count = 2;

            expect(treeChanged).toHaveBeenCalledTimes(1);
            expect(Retree.parent(stored)).toBe(root.set);
        });
    });

    describe("chaining, transactions, and silence", () => {
        it("supports chaining Set.add calls", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));

            root.set.add(1).add(2).add(3);

            expect(root.set.size).toBe(3);
            expect(root.set.has(3)).toBe(true);
        });

        it("batches multiple Set mutations in a transaction", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            const nodeChanged = vi.fn();
            Retree.on(root.set, "nodeChanged", nodeChanged);

            Retree.runTransaction(() => {
                root.set.add(1);
                root.set.add(2);
                root.set.delete(1);
            });

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect([...root.set]).toEqual([2]);
        });

        it("applies mutations without emitting inside runSilent", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            const nodeChanged = vi.fn();
            Retree.on(root.set, "nodeChanged", nodeChanged);

            Retree.runSilent(() => {
                root.set.add(1);
            });

            expect(nodeChanged).not.toHaveBeenCalled();
            expect(root.set.has(1)).toBe(true);
        });

        it("allows mutating the Set via the reproxy passed to listeners", () => {
            const root = trackRoot(Retree.root({ set: new Set<number>() }));
            let lastReproxy: Set<number> | undefined;
            Retree.on(root.set, "nodeChanged", (reproxy) => {
                lastReproxy = reproxy as Set<number>;
            });

            root.set.add(1);
            expect(lastReproxy).toBeDefined();
            expect(lastReproxy!.has(1)).toBe(true);
        });
    });
});
