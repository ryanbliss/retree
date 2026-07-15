/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { INodeFieldChanges } from "./types.js";
import { Transactions } from "./internals/transactions.js";
import { getReproxyNode } from "./internals/reproxy.js";

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
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

interface Item {
    v: number;
}

function makeList(count: number): { list: Item[] } {
    const list: Item[] = [];
    for (let i = 0; i < count; i++) {
        list.push({ v: i });
    }
    return { list };
}

function listenTo(node: object): {
    calls: () => number;
    lastChanges: () => INodeFieldChanges[] | undefined;
} {
    const listener = vi.fn();
    Retree.on(node as never, "nodeChanged", listener);
    return {
        calls: () => listener.mock.calls.length,
        lastChanges: () =>
            listener.mock.calls[listener.mock.calls.length - 1]?.[1] as
                | INodeFieldChanges[]
                | undefined,
    };
}

describe("Array mutating methods within Retree proxy", () => {
    describe("single emission per call", () => {
        it("push emits once with per-item and length records", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const probe = listenTo(tree.list);

            const result = tree.list.push({ v: 3 }, { v: 4 });

            expect(result).toBe(5);
            expect(probe.calls()).toBe(1);
            const changes = probe.lastChanges();
            expect(changes).toHaveLength(3);
            expect(changes?.[0]).toMatchObject({
                key: "3",
                previous: undefined,
            });
            expect(changes?.[1]).toMatchObject({
                key: "4",
                previous: undefined,
            });
            expect(changes?.[2]).toEqual({
                node: Retree.raw(tree.list),
                key: "length",
                previous: 3,
                new: 5,
                op: "length",
            });
            expect(changes?.[0]?.new).toEqual({ v: 3 });
            expect(tree.list[3].v).toBe(3);
            expect(tree.list[4].v).toBe(4);
        });

        it("pop emits once and returns the managed removed node", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const last = tree.list[2];
            const probe = listenTo(tree.list);

            const removed = tree.list.pop();

            expect(removed).toBe(last);
            expect(probe.calls()).toBe(1);
            expect(probe.lastChanges()).toEqual([
                {
                    node: Retree.raw(tree.list),
                    key: "2",
                    previous: Retree.raw(last),
                    new: undefined,
                    op: "remove",
                },
                {
                    node: Retree.raw(tree.list),
                    key: "length",
                    previous: 3,
                    new: 2,
                    op: "length",
                },
            ]);
            expect(tree.list).toHaveLength(2);
        });

        it("shift emits once and returns the managed removed node", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const first = tree.list[0];
            const probe = listenTo(tree.list);

            const removed = tree.list.shift();

            expect(removed).toBe(first);
            expect(probe.calls()).toBe(1);
            expect(probe.lastChanges()).toEqual([
                {
                    node: Retree.raw(tree.list),
                    key: "0",
                    previous: Retree.raw(first),
                    new: undefined,
                    op: "remove",
                },
                {
                    node: Retree.raw(tree.list),
                    key: "length",
                    previous: 3,
                    new: 2,
                    op: "length",
                },
            ]);
            expect(tree.list[0].v).toBe(1);
        });

        it("unshift emits once with per-item and length records", () => {
            const tree = trackRoot(Retree.root(makeList(2)));
            const probe = listenTo(tree.list);

            const result = tree.list.unshift({ v: -1 });

            expect(result).toBe(3);
            expect(probe.calls()).toBe(1);
            const changes = probe.lastChanges();
            expect(changes).toHaveLength(2);
            expect(changes?.[0]).toMatchObject({
                key: "0",
                previous: undefined,
            });
            expect(changes?.[1]).toEqual({
                node: Retree.raw(tree.list),
                key: "length",
                previous: 2,
                new: 3,
                op: "length",
            });
            expect(tree.list[0].v).toBe(-1);
            expect(tree.list[1].v).toBe(0);
        });

        it("splice emits once with removed, inserted, and length records", () => {
            const tree = trackRoot(Retree.root(makeList(4)));
            const removedNode = tree.list[1];
            const probe = listenTo(tree.list);

            const removed = tree.list.splice(1, 1, { v: 100 }, { v: 101 });

            expect(removed).toEqual([removedNode]);
            expect(removed[0]).toBe(removedNode);
            expect(probe.calls()).toBe(1);
            const changes = probe.lastChanges();
            expect(changes).toHaveLength(4);
            expect(changes?.[0]).toEqual({
                node: Retree.raw(tree.list),
                key: "1",
                previous: Retree.raw(removedNode),
                new: undefined,
                op: "remove",
            });
            expect(changes?.[1]).toMatchObject({
                key: "1",
                previous: undefined,
            });
            expect(changes?.[2]).toMatchObject({
                key: "2",
                previous: undefined,
            });
            expect(changes?.[3]).toEqual({
                node: Retree.raw(tree.list),
                key: "length",
                previous: 4,
                new: 5,
                op: "length",
            });
            expect(tree.list.map((item) => item.v)).toEqual([
                0, 100, 101, 2, 3,
            ]);
        });

        it("sort emits once with per-index records for moved values", () => {
            const tree = trackRoot(Retree.root({ list: [3, 1, 2] }));
            const probe = listenTo(tree.list);

            const result = tree.list.sort((a, b) => a - b);

            expect(result).toBe(tree.list);
            expect(probe.calls()).toBe(1);
            const rawList = Retree.raw(tree.list);
            expect(probe.lastChanges()).toEqual([
                { node: rawList, key: "0", previous: 3, new: 1 },
                { node: rawList, key: "1", previous: 1, new: 2 },
                { node: rawList, key: "2", previous: 2, new: 3 },
            ]);
            expect(Retree.raw(tree.list)).toEqual([1, 2, 3]);
        });

        it("reverse emits once with per-index records", () => {
            const tree = trackRoot(Retree.root({ list: [1, 2, 3] }));
            const probe = listenTo(tree.list);

            tree.list.reverse();

            expect(probe.calls()).toBe(1);
            const rawList = Retree.raw(tree.list);
            expect(probe.lastChanges()).toEqual([
                { node: rawList, key: "0", previous: 1, new: 3 },
                { node: rawList, key: "2", previous: 3, new: 1 },
            ]);
            expect(Retree.raw(tree.list)).toEqual([3, 2, 1]);
        });

        it("fill emits once with per-changed-index records", () => {
            const tree = trackRoot(Retree.root({ list: [1, 2, 3, 4] }));
            const probe = listenTo(tree.list);

            tree.list.fill(9, 1, 3);

            expect(probe.calls()).toBe(1);
            const rawList = Retree.raw(tree.list);
            expect(probe.lastChanges()).toEqual([
                { node: rawList, key: "1", previous: 2, new: 9 },
                { node: rawList, key: "2", previous: 3, new: 9 },
            ]);
            expect(Retree.raw(tree.list)).toEqual([1, 9, 9, 4]);
        });

        it("copyWithin emits once with per-changed-index records", () => {
            const tree = trackRoot(Retree.root({ list: [1, 2, 3, 4] }));
            const probe = listenTo(tree.list);

            tree.list.copyWithin(0, 2);

            expect(probe.calls()).toBe(1);
            const rawList = Retree.raw(tree.list);
            expect(probe.lastChanges()).toEqual([
                { node: rawList, key: "0", previous: 1, new: 3 },
                { node: rawList, key: "1", previous: 2, new: 4 },
            ]);
            expect(Retree.raw(tree.list)).toEqual([3, 4, 3, 4]);
        });
    });

    describe("reproxy identity", () => {
        it("advances the array node identity exactly once per mutating call", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const observed: object[] = [];
            Retree.on(tree.list, "nodeChanged", (reproxied) => {
                observed.push(reproxied);
            });

            tree.list.splice(0, 1);
            tree.list.push({ v: 10 });

            expect(observed).toHaveLength(2);
            expect(observed[0]).not.toBe(tree.list);
            expect(observed[1]).not.toBe(observed[0]);
            expect(Retree.raw(observed[0] as Item[])).toBe(
                Retree.raw(tree.list)
            );
            expect(Retree.raw(observed[1] as Item[])).toBe(
                Retree.raw(tree.list)
            );
        });
    });

    describe("mutator identity", () => {
        it("returns the same wrapper for repeated mutator reads on the base proxy", () => {
            const tree = trackRoot(Retree.root(makeList(2)));

            expect(tree.list.push).toBe(tree.list.push);
            expect(tree.list.splice).toBe(tree.list.splice);
            expect(tree.list.sort).toBe(tree.list.sort);
        });

        it("keeps mutator identity stable after mutations on the base proxy", () => {
            const tree = trackRoot(Retree.root(makeList(2)));
            const pushBefore = tree.list.push;

            tree.list.push({ v: 2 });

            expect(tree.list.push).toBe(pushBefore);
        });

        it("returns the same wrapper for repeated mutator reads on a reproxy, across generations", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            tree.list.pop();
            const firstReproxy = getReproxyNode(tree.list);
            expect(firstReproxy).not.toBe(tree.list);

            expect(firstReproxy.push).toBe(firstReproxy.push);

            const firstPush = firstReproxy.push;
            tree.list.pop();
            const secondReproxy = getReproxyNode(tree.list);
            expect(secondReproxy).not.toBe(firstReproxy);

            // The wrapper cache lives on the base handler, so identity holds
            // across reproxy generations too.
            expect(secondReproxy.push).toBe(firstPush);
        });

        it("still resolves reproxy-returning mutators to the latest reproxy", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            tree.list.pop();
            const reproxy = getReproxyNode(tree.list);

            const sorted = reproxy.sort((a, b) => b.v - a.v);

            expect(sorted).toBe(getReproxyNode(tree.list));
            expect(sorted).not.toBe(reproxy);
        });

        it("does not perpetually re-run a tracked selector that reads a mutator method", () => {
            const tree = trackRoot(Retree.root(makeList(2)));
            const callback = vi.fn();
            const unsubscribe = Retree.select(() => tree.list.push, callback);

            tree.list.push({ v: 2 });
            tree.list.push({ v: 3 });

            // The selected value is the cached mutator wrapper, whose
            // identity is stable, so the selection never "changes".
            expect(callback).not.toHaveBeenCalled();
            unsubscribe();
        });
    });

    describe("mutations through a reproxy", () => {
        function makeReproxiedList(count: number) {
            const tree = trackRoot(Retree.root(makeList(count + 1)));
            // Any mutation forces a reproxy; pop keeps `count` items.
            tree.list.pop();
            const reproxy = getReproxyNode(tree.list);
            expect(reproxy).not.toBe(tree.list);
            return { tree, reproxy };
        }

        it("splice through a reproxy emits exactly once", () => {
            const { tree, reproxy } = makeReproxiedList(11);
            const probe = listenTo(tree.list);

            const removed = reproxy.splice(0, 1);

            expect(removed).toHaveLength(1);
            expect(probe.calls()).toBe(1);
            expect(tree.list).toHaveLength(10);
            expect(tree.list[0].v).toBe(1);
        });

        it("splice through a listener-captured reproxy emits exactly once", () => {
            const tree = trackRoot(Retree.root(makeList(11)));
            let captured: Item[] | undefined;
            Retree.on(tree.list, "nodeChanged", (reproxied) => {
                captured ??= reproxied as Item[];
            });
            tree.list.push({ v: 11 });
            expect(captured).toBeDefined();
            const probe = listenTo(tree.list);

            captured?.splice(0, 1);

            expect(probe.calls()).toBe(1);
        });

        it("push through a reproxy emits exactly once", () => {
            const { tree, reproxy } = makeReproxiedList(3);
            const probe = listenTo(tree.list);

            const result = reproxy.push({ v: 100 }, { v: 101 });

            expect(result).toBe(5);
            expect(probe.calls()).toBe(1);
            expect(tree.list[3].v).toBe(100);
            expect(tree.list[4].v).toBe(101);
        });

        it("sort through a reproxy emits once and returns the latest reproxy", () => {
            const { tree, reproxy } = makeReproxiedList(3);
            const probe = listenTo(tree.list);

            const result = reproxy.sort((a, b) => b.v - a.v);

            expect(probe.calls()).toBe(1);
            expect(result).toBe(getReproxyNode(tree.list));
            expect(result).not.toBe(tree.list);
            expect(Retree.raw(result)).toBe(Retree.raw(tree.list));
            expect(tree.list.map((item) => item.v)).toEqual([2, 1, 0]);
        });

        it("returns the same reproxy for a no-op sort through a reproxy", () => {
            const { reproxy } = makeReproxiedList(3);

            const result = reproxy.sort((a, b) => a.v - b.v);

            expect(result).toBe(reproxy);
        });

        it("keeps child identity at new indices after splice through a reproxy", () => {
            const { tree, reproxy } = makeReproxiedList(5);
            const before = tree.list.map((item) => item);

            reproxy.splice(1, 2);

            expect(tree.list[0]).toBe(before[0]);
            expect(tree.list[1]).toBe(before[3]);
            expect(tree.list[2]).toBe(before[4]);
            expect(Retree.parent(tree.list[1])).toBe(tree.list);
        });

        it("keeps overridden array methods on the per-property write path through a reproxy", () => {
            class CustomList extends Array<number> {
                public pushCalls = 0;
                public push(...items: number[]): number {
                    this.pushCalls++;
                    return super.push(...items);
                }
            }
            const list = new CustomList();
            const tree = trackRoot(Retree.root({ list }));
            tree.list.push(1);
            const reproxy = getReproxyNode(tree.list);
            expect(reproxy).not.toBe(tree.list);

            reproxy.push(2);

            expect(tree.list.pushCalls).toBe(2);
            expect(tree.list[1]).toBe(2);
        });
    });

    describe("throwing sort comparator", () => {
        it("emits nothing and keeps bookkeeping consistent when the comparator throws", () => {
            const tree = trackRoot(Retree.root(makeList(4)));
            const probe = listenTo(tree.list);

            expect(() =>
                tree.list.sort(() => {
                    throw new Error("comparator boom");
                })
            ).toThrow("comparator boom");

            expect(probe.calls()).toBe(0);
            // Children cache and parent edges match the raw target,
            // whatever order the aborted sort left it in.
            const raw = Retree.raw(tree.list);
            expect(tree.list).toHaveLength(raw.length);
            for (let i = 0; i < raw.length; i++) {
                expect(Retree.raw(tree.list[i])).toBe(raw[i]);
                expect(Retree.parent(tree.list[i])).toBe(tree.list);
            }
        });

        it("emits nothing when the comparator throws partway through", () => {
            const tree = trackRoot(Retree.root(makeList(6)));
            const probe = listenTo(tree.list);
            let comparisons = 0;

            expect(() =>
                tree.list.sort((a, b) => {
                    comparisons++;
                    if (comparisons === 3) {
                        throw new Error("mid-sort boom");
                    }
                    return b.v - a.v;
                })
            ).toThrow("mid-sort boom");

            expect(probe.calls()).toBe(0);
            const raw = Retree.raw(tree.list);
            for (let i = 0; i < raw.length; i++) {
                expect(Retree.raw(tree.list[i])).toBe(raw[i]);
                expect(Retree.parent(tree.list[i])).toBe(tree.list);
            }
        });

        it("sorts, emits once, and keeps identities after a prior throwing sort", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const before = tree.list.map((item) => item);
            const probe = listenTo(tree.list);

            expect(() =>
                tree.list.sort(() => {
                    throw new Error("comparator boom");
                })
            ).toThrow("comparator boom");
            expect(probe.calls()).toBe(0);

            tree.list.sort((a, b) => b.v - a.v);

            expect(probe.calls()).toBe(1);
            expect(tree.list.map((item) => item.v)).toEqual([2, 1, 0]);
            expect(tree.list[0]).toBe(before[2]);
            expect(tree.list[2]).toBe(before[0]);
        });

        it("emits nothing and stays consistent when the comparator throws through a reproxy", () => {
            const tree = trackRoot(Retree.root(makeList(4)));
            tree.list.pop();
            const reproxy = getReproxyNode(tree.list);
            expect(reproxy).not.toBe(tree.list);
            const probe = listenTo(tree.list);

            expect(() =>
                reproxy.sort(() => {
                    throw new Error("comparator boom");
                })
            ).toThrow("comparator boom");

            expect(probe.calls()).toBe(0);
            const raw = Retree.raw(tree.list);
            for (let i = 0; i < raw.length; i++) {
                expect(Retree.raw(tree.list[i])).toBe(raw[i]);
                expect(Retree.parent(tree.list[i])).toBe(tree.list);
            }
        });
    });

    describe("no-op calls emit nothing", () => {
        it("does not emit for push(), splice(0,0), pop/shift on empty, or sorted sort", () => {
            const tree = trackRoot(Retree.root({ list: [1, 2, 3] }));
            const empty = trackRoot(Retree.root({ list: [] as number[] }));
            const probe = listenTo(tree.list);
            const emptyProbe = listenTo(empty.list);

            tree.list.push();
            tree.list.splice(0, 0);
            tree.list.splice(1);
            expect(probe.calls()).toBe(1); // splice(1) removes; reset baseline
            tree.list.sort();
            tree.list.reverse(); // single element after splice(1)? no: [1]
            tree.list.fill(1, 0, 1);
            tree.list.copyWithin(0, 0);
            expect(probe.calls()).toBe(1);

            expect(empty.list.pop()).toBeUndefined();
            expect(empty.list.shift()).toBeUndefined();
            expect(empty.list.splice(0, 5)).toEqual([]);
            expect(emptyProbe.calls()).toBe(0);
        });

        it("does not emit when sort leaves every index unchanged", () => {
            const tree = trackRoot(Retree.root({ list: [1, 2, 3] }));
            const probe = listenTo(tree.list);

            tree.list.sort((a, b) => a - b);

            expect(probe.calls()).toBe(0);
        });
    });

    describe("child identity and reparenting", () => {
        it("keeps surviving node identity at new indices after splice", () => {
            const tree = trackRoot(Retree.root(makeList(5)));
            const before = tree.list.map((item) => item);

            tree.list.splice(1, 2);

            expect(tree.list[0]).toBe(before[0]);
            expect(tree.list[1]).toBe(before[3]);
            expect(tree.list[2]).toBe(before[4]);
        });

        it("keeps node identity at new indices after sort", () => {
            const tree = trackRoot(Retree.root(makeList(4)));
            const before = tree.list.map((item) => item);

            tree.list.sort((a, b) => b.v - a.v);

            expect(tree.list[0]).toBe(before[3]);
            expect(tree.list[1]).toBe(before[2]);
            expect(tree.list[2]).toBe(before[1]);
            expect(tree.list[3]).toBe(before[0]);
        });

        it("keeps node identity after unshift and reverse", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const before = tree.list.map((item) => item);

            tree.list.unshift({ v: -1 });
            expect(tree.list[1]).toBe(before[0]);
            expect(tree.list[3]).toBe(before[2]);

            tree.list.reverse();
            expect(tree.list[0]).toBe(before[2]);
            expect(tree.list[3].v).toBe(-1);
        });

        it("passes managed nodes to the sort comparator", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const managed = new Set(tree.list.map((item) => item));

            tree.list.sort((a, b) => {
                expect(managed.has(a)).toBe(true);
                expect(managed.has(b)).toBe(true);
                return b.v - a.v;
            });

            expect(tree.list.map((item) => item.v)).toEqual([2, 1, 0]);
        });

        it("updates parent bookkeeping so a shifted node can still be removed", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const second = tree.list[1];
            const nodeRemoved = vi.fn();
            Retree.on(second, "nodeRemoved", nodeRemoved);

            tree.list.splice(0, 1); // `second` moves to index 0
            expect(tree.list[0]).toBe(second);
            expect(Retree.parent(second)).toBe(tree.list);

            tree.list.splice(0, 1); // now remove it at its new index
            expect(nodeRemoved).toHaveBeenCalledTimes(1);
            expect(Retree.parent(second)).toBeNull();
        });

        it("emits nodeChanged on a child written after the parent array was spliced", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            tree.list.splice(0, 1);
            const moved = tree.list[0];
            const nodeChanged = vi.fn();
            Retree.on(moved, "nodeChanged", nodeChanged);

            moved.v = 99;

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(tree.list[0].v).toBe(99);
        });
    });

    describe("nodeRemoved emission", () => {
        it("emits nodeRemoved for object children removed by pop, shift, and splice", () => {
            const tree = trackRoot(Retree.root(makeList(4)));
            const [first, second, , fourth] = tree.list.map((item) => item);
            const removedFirst = vi.fn();
            const removedSecond = vi.fn();
            const removedFourth = vi.fn();
            Retree.on(first, "nodeRemoved", removedFirst);
            Retree.on(second, "nodeRemoved", removedSecond);
            Retree.on(fourth, "nodeRemoved", removedFourth);

            tree.list.pop();
            expect(removedFourth).toHaveBeenCalledTimes(1);

            tree.list.shift();
            expect(removedFirst).toHaveBeenCalledTimes(1);

            tree.list.splice(0, 1);
            expect(removedSecond).toHaveBeenCalledTimes(1);
        });

        it("emits nodeRemoved for an object child overwritten by fill", () => {
            const tree = trackRoot(Retree.root(makeList(2)));
            const first = tree.list[0];
            const nodeRemoved = vi.fn();
            Retree.on(first, "nodeRemoved", nodeRemoved);

            tree.list.fill({ v: 42 } as Item, 0, 1);

            expect(nodeRemoved).toHaveBeenCalledTimes(1);
            expect(tree.list[0].v).toBe(42);
        });
    });

    describe("tree propagation and transactions", () => {
        it("still notifies a treeChanged listener on the root once per call", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const treeChanged = vi.fn();
            Retree.on(tree, "treeChanged", treeChanged);

            tree.list.splice(0, 1);
            expect(treeChanged).toHaveBeenCalledTimes(1);

            tree.list.push({ v: 10 }, { v: 11 });
            expect(treeChanged).toHaveBeenCalledTimes(2);
        });

        it("batches multiple array mutations inside runTransaction", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const nodeChanged = vi.fn();
            Retree.on(tree.list, "nodeChanged", nodeChanged);

            Retree.runTransaction(() => {
                tree.list.push({ v: 3 });
                tree.list.splice(0, 1);
                tree.list.reverse();
                expect(nodeChanged).not.toHaveBeenCalled();
            });

            expect(nodeChanged).toHaveBeenCalledTimes(1);
            expect(tree.list.map((item) => item.v)).toEqual([3, 2, 1]);
        });

        it("applies mutations without emitting inside runSilent", () => {
            const tree = trackRoot(Retree.root(makeList(3)));
            const nodeChanged = vi.fn();
            Retree.on(tree.list, "nodeChanged", nodeChanged);

            Retree.runSilent(() => {
                tree.list.splice(0, 1);
                tree.list.push({ v: 50 });
            });

            expect(nodeChanged).not.toHaveBeenCalled();
            expect(tree.list.map((item) => item.v)).toEqual([1, 2, 50]);
        });
    });

    describe("raw purity", () => {
        it("stores raw values in the raw target for inserted managed nodes", () => {
            const tree = trackRoot(Retree.root(makeList(2)));
            const moved = tree.list[0];

            tree.list.splice(0, 1);
            tree.list.push(moved);

            const raw = Retree.raw(tree.list);
            expect(raw[raw.length - 1]).toBe(Retree.raw(moved));
            expect(tree.list[tree.list.length - 1]).toBe(moved);
        });

        it("keeps overridden array methods on the per-property write path", () => {
            class CustomList extends Array<number> {
                public pushCalls = 0;
                public push(...items: number[]): number {
                    this.pushCalls++;
                    return super.push(...items);
                }
            }
            const list = new CustomList();
            const tree = trackRoot(Retree.root({ list }));

            tree.list.push(1);

            expect(tree.list.pushCalls).toBe(1);
            expect(tree.list[0]).toBe(1);
        });
    });
});
