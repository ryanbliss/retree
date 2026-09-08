/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Structural cycles are rejected where the closing edge is materialized.
 * Class instances and collections attach eagerly when their holder is
 * built; plain objects and arrays attach on first read, managed or not.
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
    it("rejects a self-reference when the closing edge is first read", () => {
        const input: SelfRef = {};
        input.self = input;
        const root = Retree.root(input);
        expect(() => root.self).toThrow(CYCLE);
    });

    it("rejects a deeper plain cycle when the closing edge is first read, not its holder", () => {
        const input: SelfRef = { nested: {} };
        input.nested!.back = input;
        const root = Retree.root(input);
        const nested = root.nested!;
        expect(() => nested.back).toThrow(CYCLE);
    });

    it("rejects a closing edge after materializing a long unmanaged chain", () => {
        interface Chain {
            next: Chain | null;
        }
        const input: Chain = { next: null };
        let tail = input;
        for (let i = 0; i < 512; i++) {
            tail.next = { next: null };
            tail = tail.next;
        }
        tail.next = input;
        const root = Retree.root(input);
        expect(() => {
            let current = root;
            for (let i = 0; i < 513; i++) current = current.next!;
        }).toThrow(CYCLE);
        Retree.clearListeners(root);
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
