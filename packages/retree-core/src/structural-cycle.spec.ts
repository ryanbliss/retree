/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Structural cycles are rejected where the closing edge is materialized.
 * Class instances, collections, and already-managed values attach eagerly
 * when their holder is built; plain objects and arrays attach on first read.
 * Raw input is never walked up front.
 */
import { describe, expect, it } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";

const CYCLE = /cannot own a structural cycle/;

interface SelfRef {
    self?: SelfRef;
    nested?: { back?: SelfRef };
}

describe("structural cycles", () => {
    it("rejects a self-reference at root() because the root is managed when its fields attach", () => {
        const input: SelfRef = {};
        input.self = input;
        expect(() => Retree.root(input)).toThrow(CYCLE);
    });

    it("rejects a deeper plain cycle when the holder of the closing edge is first read", () => {
        const input: SelfRef = { nested: {} };
        input.nested!.back = input;
        const root = Retree.root(input);
        expect(() => root.nested).toThrow(CYCLE);
    });

    it("rejects a class-instance cycle at root() because class fields are eager", () => {
        class Node extends ReactiveNode {
            public self: Node | null = null;
            get dependencies() {
                return [];
            }
        }
        const node = new Node();
        node.self = node;
        expect(() => Retree.root(node)).toThrow(CYCLE);
    });

    it("rejects a cycle through a Map value at root() because collections are eager", () => {
        const input: { map: Map<string, object> } = { map: new Map() };
        input.map.set("back", input);
        expect(() => Retree.root(input)).toThrow(CYCLE);
    });

    it("rejects an assignment that would make an ancestor its own descendant", () => {
        const root = Retree.root({ a: { b: {} as { back?: object } } });
        expect(() => {
            root.a.b.back = root.a;
        }).toThrow(CYCLE);
    });

    it("allows a back-reference through Retree.link", () => {
        const root = Retree.root({
            a: { b: {} as { back?: ReturnType<typeof Retree.link> } },
        });
        expect(() => {
            root.a.b.back = Retree.link(root.a);
        }).not.toThrow();
        expect(root.a.b.back!.current).toBe(root.a);
    });

    it("does not walk plain input at root(): a cycle no one reads is never visited", () => {
        const input: SelfRef = { nested: {} };
        input.nested!.back = input;
        expect(() => Retree.root(input)).not.toThrow();
    });
});
