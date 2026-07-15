/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { INodeFieldChanges } from "./types.js";
import { getCustomProxyHandler } from "./internals/proxy.js";

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    if (getCustomProxyHandler(node)) {
        Retree.clearListeners(node as never);
    }
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

/**
 * Capture each treeChanged batch emitted under `root`, exactly as an undo
 * consumer would receive it.
 */
function captureBatches<T extends object>(root: T): INodeFieldChanges[][] {
    const batches: INodeFieldChanges[][] = [];
    Retree.on(root, "treeChanged", (_node, changes) => {
        batches.push(changes);
    });
    return batches;
}

function lastBatch(batches: INodeFieldChanges[][]): INodeFieldChanges[] {
    const batch = batches[batches.length - 1];
    if (batch === undefined) {
        throw new Error("expected at least one captured change batch");
    }
    return batch;
}

describe("Retree.applyInverse", () => {
    it("restores a plain property write", () => {
        const root = trackRoot(Retree.root({ count: 1, label: "a" }));
        const batches = captureBatches(root);

        root.count = 2;
        Retree.applyInverse(lastBatch(batches));

        expect(root.count).toBe(1);
        expect(root.label).toBe("a");
    });

    it("deletes a key created by a write (add marker)", () => {
        const root = trackRoot(
            Retree.root({ existing: 1 } as {
                existing: number;
                created?: number;
            })
        );
        const batches = captureBatches(root);

        root.created = 5;
        expect(lastBatch(batches)[0]?.op).toBe("add");
        Retree.applyInverse(lastBatch(batches));

        expect("created" in root).toBe(false);
        expect(root.existing).toBe(1);
    });

    it("restores a deleted key (delete marker)", () => {
        const root = trackRoot(
            Retree.root({ value: 42 } as { value?: number })
        );
        const batches = captureBatches(root);

        delete root.value;
        expect("value" in root).toBe(false);
        expect(lastBatch(batches)[0]?.op).toBe("delete");
        Retree.applyInverse(lastBatch(batches));

        expect(root.value).toBe(42);
    });

    it("emits normally while applying, inside one transaction", () => {
        const root = trackRoot(Retree.root({ a: 0, b: 0 }));
        const batches = captureBatches(root);
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        Retree.runTransaction(() => {
            root.a = 1;
            root.b = 2;
        });
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        Retree.applyInverse(lastBatch(batches));

        expect(root.a).toBe(0);
        expect(root.b).toBe(0);
        // The whole inverse flushed as one batched emission.
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    describe("arrays", () => {
        it("inverts push", () => {
            const root = trackRoot(Retree.root({ list: [1, 2] }));
            const batches = captureBatches(root);

            root.list.push(3, 4);
            Retree.applyInverse(lastBatch(batches));

            expect(Retree.raw(root.list)).toEqual([1, 2]);
        });

        it("inverts pop and shift", () => {
            const root = trackRoot(Retree.root({ list: ["a", "b", "c"] }));
            const batches = captureBatches(root);

            root.list.pop();
            Retree.applyInverse(lastBatch(batches));
            expect(Retree.raw(root.list)).toEqual(["a", "b", "c"]);

            root.list.shift();
            Retree.applyInverse(lastBatch(batches));
            expect(Retree.raw(root.list)).toEqual(["a", "b", "c"]);
        });

        it("inverts unshift", () => {
            const root = trackRoot(Retree.root({ list: [3, 4] }));
            const batches = captureBatches(root);

            root.list.unshift(1, 2);
            Retree.applyInverse(lastBatch(batches));

            expect(Retree.raw(root.list)).toEqual([3, 4]);
        });

        it("inverts a splice that removes and inserts", () => {
            const root = trackRoot(Retree.root({ list: ["a", "b", "c", "d"] }));
            const batches = captureBatches(root);

            root.list.splice(1, 2, "x");
            expect(Retree.raw(root.list)).toEqual(["a", "x", "d"]);
            Retree.applyInverse(lastBatch(batches));

            expect(Retree.raw(root.list)).toEqual(["a", "b", "c", "d"]);
        });

        it("inverts a multi-element removal run in the exact order", () => {
            const root = trackRoot(Retree.root({ list: [0, 1, 2, 3, 4, 5] }));
            const batches = captureBatches(root);

            root.list.splice(2, 3);
            expect(Retree.raw(root.list)).toEqual([0, 1, 5]);
            Retree.applyInverse(lastBatch(batches));

            expect(Retree.raw(root.list)).toEqual([0, 1, 2, 3, 4, 5]);
        });

        it("restores object elements as the same nodes", () => {
            const root = trackRoot(Retree.root({ list: [{ v: 0 }, { v: 1 }] }));
            const removedRaw = Retree.raw(root.list[0]);
            const batches = captureBatches(root);

            root.list.splice(0, 1);
            Retree.applyInverse(lastBatch(batches));

            expect(root.list).toHaveLength(2);
            expect(Retree.raw(root.list[0])).toBe(removedRaw);
            // The restored node is managed again: mutating it emits.
            const nodeChanged = vi.fn();
            Retree.on(root.list[0], "nodeChanged", nodeChanged);
            root.list[0].v = 100;
            expect(nodeChanged).toHaveBeenCalledTimes(1);
        });

        it("inverts sort and reverse exactly", () => {
            const root = trackRoot(Retree.root({ list: [3, 1, 2] }));
            const batches = captureBatches(root);

            root.list.sort((a, b) => a - b);
            expect(Retree.raw(root.list)).toEqual([1, 2, 3]);
            Retree.applyInverse(lastBatch(batches));
            expect(Retree.raw(root.list)).toEqual([3, 1, 2]);

            root.list.reverse();
            Retree.applyInverse(lastBatch(batches));
            expect(Retree.raw(root.list)).toEqual([3, 1, 2]);
        });

        it("inverts fill", () => {
            const root = trackRoot(Retree.root({ list: [1, 2, 3] }));
            const batches = captureBatches(root);

            root.list.fill(0, 1);
            expect(Retree.raw(root.list)).toEqual([1, 0, 0]);
            Retree.applyInverse(lastBatch(batches));

            expect(Retree.raw(root.list)).toEqual([1, 2, 3]);
        });

        it("inverts a direct index write", () => {
            const root = trackRoot(Retree.root({ list: [1, 2, 3] }));
            const batches = captureBatches(root);

            root.list[1] = 20;
            Retree.applyInverse(lastBatch(batches));

            expect(Retree.raw(root.list)).toEqual([1, 2, 3]);
        });
    });

    describe("Map and Set", () => {
        it("inverts Map set/overwrite/delete with object keys", () => {
            const objectKey = { id: 1 };
            const root = trackRoot(
                Retree.root({ map: new Map<object, number>() })
            );
            const batches = captureBatches(root);

            root.map.set(objectKey, 1);
            Retree.applyInverse(lastBatch(batches));
            expect(root.map.has(objectKey)).toBe(false);

            root.map.set(objectKey, 1);
            root.map.set(objectKey, 2);
            Retree.applyInverse(lastBatch(batches));
            expect(root.map.get(objectKey)).toBe(1);

            root.map.delete(objectKey);
            Retree.applyInverse(lastBatch(batches));
            expect(root.map.get(objectKey)).toBe(1);
        });

        it("inverts Map.clear, restoring every entry", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            root.map.set("a", 1);
            root.map.set("b", 2);
            const batches = captureBatches(root);

            root.map.clear();
            expect(root.map.size).toBe(0);
            Retree.applyInverse(lastBatch(batches));

            expect(root.map.get("a")).toBe(1);
            expect(root.map.get("b")).toBe(2);
            // Iteration order is observable: the per-entry delete records
            // must re-insert in forward (original insertion) order.
            expect([...root.map.keys()]).toEqual(["a", "b"]);
        });

        it("re-inserts cleared Set members in the original insertion order", () => {
            const root = trackRoot(
                Retree.root({ set: new Set(["x", "y", "z"]) })
            );
            const batches = captureBatches(root);

            root.set.clear();
            Retree.applyInverse(lastBatch(batches));

            expect([...root.set]).toEqual(["x", "y", "z"]);
        });

        it("does not confuse a literal 'clear' Map key with the clear summary record", () => {
            const root = trackRoot(
                Retree.root({ map: new Map<string, number>() })
            );
            root.map.set("clear", 1);
            const batches = captureBatches(root);

            root.map.set("clear", 2);
            Retree.applyInverse(lastBatch(batches));

            expect(root.map.get("clear")).toBe(1);
        });

        it("inverts Set add/delete/clear, including object members", () => {
            const member = { id: 1 };
            const root = trackRoot(Retree.root({ set: new Set<object>() }));
            const batches = captureBatches(root);

            root.set.add(member);
            Retree.applyInverse(lastBatch(batches));
            expect(root.set.size).toBe(0);

            root.set.add(member);
            const rawMember = [...Retree.raw(root.set).values()][0];
            root.set.delete(member);
            Retree.applyInverse(lastBatch(batches));
            expect(Retree.raw(root.set).has(rawMember as object)).toBe(true);

            root.set.clear();
            Retree.applyInverse(lastBatch(batches));
            expect(Retree.raw(root.set).has(rawMember as object)).toBe(true);
        });
    });

    it("inverts Date mutations", () => {
        const root = trackRoot(Retree.root({ when: new Date(1000) }));
        const batches = captureBatches(root);

        root.when.setTime(5000);
        Retree.applyInverse(lastBatch(batches));

        expect(root.when.getTime()).toBe(1000);
    });

    it("throws a pinpointed error when a record's node is not managed", () => {
        const detached = { value: 1 };
        expect(() =>
            Retree.applyInverse([
                { node: detached, key: "value", previous: 0, new: 1 },
            ])
        ).toThrow(
            /Retree\.applyInverse: the change record for key 'value' targets a node that is not Retree-managed/
        );
    });
});

describe("Retree.applyChanges", () => {
    it("replays a plain write forward", () => {
        const root = trackRoot(Retree.root({ count: 1 }));
        const batches = captureBatches(root);

        root.count = 2;
        const batch = lastBatch(batches);
        Retree.applyInverse(batch);
        expect(root.count).toBe(1);
        Retree.applyChanges(batch);

        expect(root.count).toBe(2);
    });

    it("replays array structural changes forward", () => {
        const root = trackRoot(Retree.root({ list: ["a", "b", "c", "d"] }));
        const batches = captureBatches(root);

        root.list.splice(1, 2, "x");
        const batch = lastBatch(batches);
        Retree.applyInverse(batch);
        expect(Retree.raw(root.list)).toEqual(["a", "b", "c", "d"]);
        Retree.applyChanges(batch);

        expect(Retree.raw(root.list)).toEqual(["a", "x", "d"]);
    });

    it("replays key deletes and creations forward", () => {
        const root = trackRoot(
            Retree.root({ value: 42 } as { value?: number; added?: string })
        );
        const batches = captureBatches(root);

        delete root.value;
        root.added = "yes";
        const deleteBatch = batches[batches.length - 2];
        const addBatch = batches[batches.length - 1];
        if (deleteBatch === undefined || addBatch === undefined) {
            throw new Error("expected two captured change batches");
        }
        Retree.applyInverse(addBatch);
        Retree.applyInverse(deleteBatch);
        expect(root.value).toBe(42);
        expect("added" in root).toBe(false);

        Retree.applyChanges(deleteBatch);
        Retree.applyChanges(addBatch);
        expect("value" in root).toBe(false);
        expect(root.added).toBe("yes");
    });

    it("replays Map.clear and Set.clear forward", () => {
        const root = trackRoot(
            Retree.root({
                map: new Map<string, number>(),
                set: new Set<number>(),
            })
        );
        root.map.set("a", 1);
        root.set.add(1);
        const batches = captureBatches(root);

        root.map.clear();
        const mapBatch = lastBatch(batches);
        root.set.clear();
        const setBatch = lastBatch(batches);
        Retree.applyInverse(setBatch);
        Retree.applyInverse(mapBatch);
        expect(root.map.size).toBe(1);
        expect(root.set.size).toBe(1);

        Retree.applyChanges(mapBatch);
        Retree.applyChanges(setBatch);
        expect(root.map.size).toBe(0);
        expect(root.set.size).toBe(0);
    });
});
