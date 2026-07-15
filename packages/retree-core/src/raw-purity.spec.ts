/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Raw purity invariant (specs/retree-raw.md §3.2): proxies are reachable only
 * through proxies. Walking `Retree.raw(root)` — including into raw Maps and
 * Sets — finds zero values with proxy metadata, under every write path.
 */
import { describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { ignore, link } from "./decorators.js";
import { getCustomProxyHandler } from "./internals/index.js";
import { COLLECTED_KEYS_SYMBOL, LINKED_KEYS_SYMBOL } from "./ReactiveNode.js";
import { INodeFieldChanges, TreeNode } from "./types.js";

/**
 * Deep-walks a raw tree and returns the paths of every value that carries
 * Retree proxy metadata. Skips `@ignore`/collected and linked keys — those
 * fields are outside the purity domain (users may store managed nodes there
 * deliberately; links point at nodes owned elsewhere).
 */
function findProxiesInRaw(rawRoot: object): string[] {
    const found: string[] = [];
    const seen = new WeakSet<object>();
    const visit = (value: unknown, path: string) => {
        if (value === null || typeof value !== "object") {
            return;
        }
        if (getCustomProxyHandler(value as TreeNode) !== undefined) {
            found.push(path);
            return;
        }
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        if (value instanceof Map) {
            for (const [key, entryValue] of value.entries()) {
                visit(entryValue, `${path}.get(${String(key)})`);
            }
            return;
        }
        if (value instanceof Set) {
            let index = 0;
            for (const entryValue of value.values()) {
                visit(entryValue, `${path}[Set:${index++}]`);
            }
            return;
        }
        if (value instanceof Date) {
            return;
        }
        const collected =
            value instanceof ReactiveNode
                ? value[COLLECTED_KEYS_SYMBOL]
                : undefined;
        const linked =
            value instanceof ReactiveNode
                ? value[LINKED_KEYS_SYMBOL]
                : undefined;
        for (const key of Object.keys(value)) {
            if (key.startsWith("RETREE_")) {
                continue;
            }
            if (collected?.has(key) || linked?.has(key)) {
                continue;
            }
            visit((value as Record<string, unknown>)[key], `${path}.${key}`);
        }
    };
    visit(rawRoot, "$");
    return found;
}

function expectPure(node: TreeNode) {
    expect(findProxiesInRaw(Retree.raw(node))).toEqual([]);
}

describe("raw purity invariant", () => {
    it("plain writes and pushes stay pure", () => {
        const root = Retree.root({ list: [] as { v: number }[], child: {} });
        root.list.push({ v: 1 });
        (root.child as { nested?: object }).nested = { deep: { v: 2 } };
        void root.list[0].v; // materialize
        expectPure(root);
    });

    it("assigning an already-managed node (reparent) stays pure", () => {
        const detached = Retree.root({ v: 2, inner: { x: 1 } });
        const root = Retree.root({ list: [] as { v: number }[] });
        root.list.push(detached);
        void root.list[0].v;
        expectPure(root);
        // The reparented child is still managed: mutating it emits.
        const changed = vi.fn();
        const off = Retree.on(root.list[0], "nodeChanged", changed);
        root.list[0].v = 3;
        expect(changed).toHaveBeenCalledTimes(1);
        off();
    });

    it("Retree.move stays pure on both parents", () => {
        const ws = Retree.root({
            todo: [{ v: 3 }],
            done: [] as { v: number }[],
        });
        void ws.todo[0];
        Retree.move(ws.todo[0], ws.done);
        expectPure(ws);
        expect(Retree.raw(ws).done[0]).toEqual({ v: 3 });
    });

    it("post-construction assignment of non-plain values stays pure", () => {
        class Thing {
            public v = 5;
        }
        const root = Retree.root({
            m: null as Map<string, number> | null,
            s: null as Set<number> | null,
            d: null as Date | null,
            t: null as Thing | null,
        });
        root.m = new Map([["k", 1]]);
        root.s = new Set([1, 2]);
        root.d = new Date(0);
        root.t = new Thing();
        expectPure(root);
        // Managed reads still return managed children.
        expect(getCustomProxyHandler(root.m!)).toBeDefined();
        expect(getCustomProxyHandler(root.t!)).toBeDefined();
    });

    it("defineProperty with a managed node stays pure", () => {
        const detached = Retree.root({ v: 7 });
        const root = Retree.root({} as { child?: { v: number } });
        Object.defineProperty(root, "child", {
            value: detached,
            enumerable: true,
            writable: true,
            configurable: true,
        });
        expectPure(root);
        expect(Retree.raw(root).child).toEqual({ v: 7 });
        expect(getCustomProxyHandler(root.child!)).toBeDefined();
    });

    it("linked fields store raw pointers", () => {
        class Owner extends ReactiveNode {
            @link public target: { v: number } | null = null;
            get dependencies() {
                return [];
            }
        }
        const root = Retree.root({
            data: { v: 9 },
            owner: new Owner(),
        });
        void root.data.v; // materialize target
        root.owner.target = root.data;
        const rawOwner = Retree.raw(root.owner);
        expect(
            getCustomProxyHandler(
                (rawOwner as unknown as { target: object }).target
            )
        ).toBeUndefined();
        // Linked reads still resolve to the managed node.
        expect(getCustomProxyHandler(root.owner.target!)).toBeDefined();
        root.owner.target.v = 10;
        expect(root.data.v).toBe(10);
    });

    it("stays pure through transactions and runSilent", () => {
        const detached = Retree.root({ v: 1 });
        const root = Retree.root({
            list: [] as { v: number }[],
            child: null as { v: number } | null,
        });
        Retree.runTransaction(() => {
            root.list.push(detached);
            root.child = { v: 2 };
        });
        Retree.runSilent(() => {
            root.list.push(Retree.root({ v: 3 }));
        }, false);
        void root.list[0];
        void root.list[1];
        expectPure(root);
    });

    it("Map value reads and writes stay pure", () => {
        const root = Retree.root({
            map: new Map<string, { v: number }>([["a", { v: 1 }]]),
        });
        // Read-materialize the value, iterate, then write more values.
        void root.map.get("a");
        for (const value of root.map.values()) {
            void value;
        }
        root.map.set("b", { v: 2 });
        const managed = Retree.root({ v: 3 });
        root.map.set("c", managed);
        void root.map.get("c");
        expectPure(root);
        // Managed reads still resolve, and mutations still emit.
        const changed = vi.fn();
        const off = Retree.on(root.map.get("c")!, "nodeChanged", changed);
        root.map.get("c")!.v = 4;
        expect(changed).toHaveBeenCalledTimes(1);
        off();
    });

    it("Map values present at root() time stay pure", () => {
        const managed = Retree.root({ v: 5 });
        const inner = new Map<string, { v: number }>([["k", managed]]);
        const root = Retree.root({ map: inner });
        expectPure(root);
        expect(Retree.raw(root.map).get("k")).toBe(Retree.raw(managed));
        expect(Retree.parent(root.map.get("k")!)).toBe(root.map);
    });

    it("Set members stay pure across add, iterate, and root() time", () => {
        const managed = Retree.root({ v: 6 });
        const root = Retree.root({ set: new Set<{ v: number }>([managed]) });
        root.set.add({ v: 7 });
        root.set.add(Retree.root({ v: 8 }));
        for (const member of root.set) {
            void member;
        }
        expectPure(root);
        // Membership works with both raw and managed arguments.
        expect(root.set.has(Retree.raw(managed))).toBe(true);
        for (const member of root.set) {
            expect(root.set.has(member)).toBe(true);
        }
    });

    it("structuredClone(Retree.raw(root)) succeeds after reparents and map reads", () => {
        const detached = Retree.root({ v: 2, inner: { x: 1 } });
        const root = Retree.root({
            list: [] as object[],
            map: new Map<string, { v: number }>([["a", { v: 9 }]]),
        });
        root.list.push(detached);
        void root.list[0];
        void root.map.get("a"); // materialize the map value
        const cloned = structuredClone(Retree.raw(root));
        expect(cloned.list).toEqual([{ v: 2, inner: { x: 1 } }]);
        expect(cloned.map.get("a")).toEqual({ v: 9 });
    });
});

describe("raw change payloads (§9.1: consistently raw)", () => {
    it("previous and new are raw for reparented children", () => {
        const first = Retree.root({ v: 1 });
        const second = Retree.root({ v: 2 });
        const root = Retree.root({ child: null as { v: number } | null });
        root.child = first;
        let captured: INodeFieldChanges[] = [];
        const off = Retree.on(root, "nodeChanged", (_node, changes) => {
            captured = changes;
        });
        root.child = second;
        off();
        expect(captured).toHaveLength(1);
        expect(captured[0].key).toBe("child");
        expect(getCustomProxyHandler(captured[0].previous as TreeNode)).toBe(
            undefined
        );
        expect(getCustomProxyHandler(captured[0].new as TreeNode)).toBe(
            undefined
        );
        expect(captured[0].previous).toBe(Retree.raw(first));
        expect(captured[0].new).toBe(Retree.raw(second));
    });

    it("previous and new are raw for eager non-plain values", () => {
        const root = Retree.root({ m: null as Map<string, number> | null });
        root.m = new Map([["a", 1]]);
        let captured: INodeFieldChanges[] = [];
        const off = Retree.on(root, "nodeChanged", (_node, changes) => {
            captured = changes;
        });
        const nextMap = new Map([["b", 2]]);
        root.m = nextMap;
        off();
        expect(getCustomProxyHandler(captured[0].previous as TreeNode)).toBe(
            undefined
        );
        expect(captured[0].new).toBe(nextMap);
    });

    it("a listener can opt back into the managed node via Retree.managed", () => {
        const first = Retree.root({ v: 1 });
        const root = Retree.root({ child: null as { v: number } | null });
        root.child = first;
        let previousRaw: unknown;
        const off = Retree.on(root, "nodeChanged", (_node, changes) => {
            previousRaw = changes[0].previous;
        });
        root.child = { v: 99 };
        off();
        const managed = Retree.managed(previousRaw as TreeNode);
        expect(managed).toBeDefined();
        expect(Retree.raw(managed!)).toBe(previousRaw);
    });
});

describe("same-node reassignment", () => {
    it("assigning the node already stored at a property is a no-op", () => {
        const detached = Retree.root({ v: 1 });
        const root = Retree.root({ child: null as { v: number } | null });
        root.child = detached;
        const changed = vi.fn();
        const off = Retree.on(root, "nodeChanged", changed);
        root.child = detached; // same base proxy
        const readBack = root.child; // latest managed identity
        root.child = readBack; // read-back assignment
        expect(changed).not.toHaveBeenCalled();
        off();
    });
});
