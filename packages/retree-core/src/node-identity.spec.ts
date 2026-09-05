/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode } from "./ReactiveNode.js";
import { getBaseProxy } from "./internals/proxy.js";

interface IShape {
    child: { value: number };
    list: { v: number }[];
    map: Map<string, { count: number }>;
    other: number;
}

function makeRoot() {
    return Retree.root<IShape>({
        child: { value: 0 },
        list: [{ v: 0 }, { v: 1 }],
        map: new Map(),
        other: 0,
    });
}

function latest<T extends object>(root: T): { view: () => T; off: () => void } {
    let view = root;
    const off = Retree.on(root, "nodeChanged", (next) => {
        view = next;
    });
    return { view: () => view, off };
}

describe("node identity", () => {
    it("returns one identity for a child whatever the receiver", () => {
        const root = makeRoot();
        const { view, off } = latest(root);
        root.other = 1;
        expect(view()).not.toBe(root);

        const child = root.child;
        expect(view().child).toBe(child);
        expect(child).toBe(getBaseProxy(child));

        root.other = 2;
        expect(root.child).toBe(child);

        root.child.value = 1;
        expect(root.child).not.toBe(child);
        expect(view().child).toBe(root.child);
        expect(Retree.raw(root.child)).toBe(Retree.raw(child));
        off();
    });

    it("keeps the root handle and the method receiver stable", () => {
        class Owner extends ReactiveNode {
            public count = 0;
            public self(): Owner {
                return this;
            }
            get dependencies() {
                return [];
            }
        }
        const owner = Retree.root(new Owner());
        owner.count = 1;
        owner.count = 2;
        expect(owner.self()).toBe(owner);
        expect(Retree.managed(owner)).not.toBe(owner);
    });

    it("returns the latest identity from Retree.parent and from mutators", () => {
        const root = makeRoot();
        root.list.push({ v: 2 });
        expect(Retree.parent(root.list[0]!)).toBe(root.list);
        expect(root.list.sort((a, b) => b.v - a.v)).toBe(root.list);
        expect(root.list.push).toBe(root.list.push);

        root.map.set("a", { count: 0 });
        expect(root.map.set("b", { count: 1 })).toBe(root.map);
        expect(Retree.parent(root.map.get("a")!)).toBe(root.map);
    });
});

describe("Retree.version", () => {
    it("advances on the node's own writes and treeVersion on descendant writes", () => {
        const root = makeRoot();
        const childVersion = Retree.version(root.child);
        const rootVersion = Retree.version(root);
        const rootTreeVersion = Retree.treeVersion(root);

        root.child.value = 1;
        expect(Retree.version(root.child)).toBeGreaterThan(childVersion);
        expect(Retree.version(root)).toBe(rootVersion);
        expect(Retree.treeVersion(root)).toBeGreaterThan(rootTreeVersion);

        const afterChild = Retree.version(root.child);
        root.other = 1;
        expect(Retree.version(root.child)).toBe(afterChild);
        expect(Retree.version(root)).toBeGreaterThan(rootVersion);
    });

    it("agrees with identity and accepts the raw object", () => {
        const root = makeRoot();
        const before = root.child;
        const version = Retree.version(before);
        expect(Retree.version(Retree.raw(before))).toBe(version);

        root.other = 1;
        expect(root.child).toBe(before);
        expect(Retree.version(root.child)).toBe(version);

        root.child.value = 1;
        expect(root.child).not.toBe(before);
        expect(Retree.version(root.child)).not.toBe(version);
        expect(Retree.version(before)).toBe(Retree.version(root.child));
    });

    it("follows runSilent's reproxy mode", () => {
        const root = makeRoot();
        const version = Retree.version(root.child);
        const treeVersion = Retree.treeVersion(root);
        Retree.runSilent(() => {
            root.child.value = 1;
        });
        expect(Retree.version(root.child)).toBe(version);
        expect(Retree.treeVersion(root)).toBe(treeVersion);
        Retree.runSilent(() => {
            root.child.value = 2;
        }, false);
        expect(Retree.version(root.child)).toBeGreaterThan(version);
        expect(Retree.treeVersion(root)).toBeGreaterThan(treeVersion);
    });

    it("throws for values that are not Retree nodes", () => {
        expect(() => Retree.version({})).toThrow(
            "Retree.version: expected a Retree-managed node or the raw object behind one, but the value has never been materialized as a Retree node."
        );
        expect(() => Retree.treeVersion(null as unknown as object)).toThrow(
            "Retree.treeVersion: expected a Retree-managed node or the raw object behind one but received a object."
        );
    });
});
