/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { ignore, memo } from "./decorators.js";
import { CompiledFieldRole } from "./internals/compiled-node.js";
import { BaseProxyHandler, getCustomProxyHandler } from "./internals/proxy.js";

// Runs under the proxy project and the compiled project (see the root
// vitest config); every expectation must hold on both paths.
const expectCompiled = process.env.RETREE_COMPILED_SPECS === "1";

function expectManagedPath(node: object): void {
    const handler = getCustomProxyHandler(node);
    if (!(handler instanceof BaseProxyHandler)) {
        throw new Error("Expected a managed node.");
    }
    expect(handler.compiled !== null).toBe(expectCompiled);
}

afterEach(() => {
    vi.restoreAllMocks();
});

function spyOnWarn() {
    return vi.spyOn(console, "warn").mockImplementation(() => {});
}

// A class expression never compiles, so it stands in for a base from an
// uncompiled package (ConvexNode) with an @ignore field and a
// constructor-assigned property.
const UncompiledBase = class extends ReactiveNode {
    @ignore cache: { hits: number } = { hits: 0 };
    assigned = { value: 1 };
};

class Derived extends UncompiledBase {
    @ignore label = "derived";

    bump(): number {
        this.assigned.value += 1;
        return this.assigned.value;
    }
}

class Slot extends ReactiveNode {
    item: Derived | null = null;
    other: Derived | null = null;
    onPick = (value: number): number => value * 2;
}

class Base extends ReactiveNode {
    count = 1;
    computed = 0;

    @memo((self: Base) => [self.count])
    get doubled(): number {
        this.computed += 1;
        return this.count * 2;
    }
}

class Sub extends Base {
    @memo((self: Sub) => [self.count])
    get doubled(): number {
        return super.doubled + 1;
    }
}

describe("compiled nodes", () => {
    it("manages a subclass whose base the compiler did not see", () => {
        const warn = spyOnWarn();
        const root = Retree.root(new Derived());
        expectManagedPath(root);
        const changed = vi.fn();
        Retree.on(root, "treeChanged", changed);

        expect(root.bump()).toBe(2);
        expect(root.assigned.value).toBe(2);
        expect(changed).toHaveBeenCalledTimes(1);

        root.cache.hits += 1;
        root.label = "other";
        expect(changed).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
        Retree.clearListeners(root);
    });

    it("lets a subclass memo call super on a base memo of the same name", () => {
        const root = Retree.root(new Sub());
        expectManagedPath(root);
        expect(root.doubled).toBe(3);
        expect(root.doubled).toBe(3);
        expect(root.computed).toBe(1);
        root.count = 2;
        expect(root.doubled).toBe(5);
        expect(root.computed).toBe(2);
    });

    it("warns in dev when an undeclared key lands on a compiled node", () => {
        const warn = spyOnWarn();
        const root = Retree.root(new Derived());
        Reflect.set(root, "extra", 1);
        root.assigned = { value: 5 };
        expect(warn).toHaveBeenCalledTimes(expectCompiled ? 1 : 0);
        if (expectCompiled) {
            expect(warn.mock.calls[0][0]).toContain('"extra"');
        }
    });

    it("exposes methods to spies and prototype reflection", () => {
        const root = Retree.root(new Derived());
        const prototype = Object.getPrototypeOf(root);
        expect(Reflect.get(prototype, "bump")).toBe(Derived.prototype.bump);

        const spy = vi.spyOn(root, "bump");
        expect(root.bump()).toBe(2);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(root.assigned.value).toBe(2);

        spy.mockRestore();
        expect(root.bump()).toBe(3);
    });

    it("moves a node out of and into compiled parents", () => {
        const root = Retree.root(new Slot());
        root.item = new Derived();
        const moved = Retree.move(root.item, root, "other");
        expect(root.item).toBeUndefined();
        expect(root.other).toBe(moved);
        expect(Retree.parent(moved)).toBe(root);
        if (!expectCompiled) return;
        const destination: { item: Derived | null; missing?: Derived } = root;
        expect(() => Retree.move(moved, destination, "missing")).toThrow(
            'Retree.move: the destination is a compiled Slot and has no field "missing".'
        );
    });

    it("falls back to the proxy path when a later instance adds an own key", () => {
        const warn = spyOnWarn();
        Retree.root(new Derived());
        const second = new Derived();
        Reflect.set(second, "surprise", 1);
        const root = Retree.root(second);
        const handler = getCustomProxyHandler(root);
        expect(handler instanceof BaseProxyHandler && handler.compiled).toBe(
            null
        );
        expect(warn).toHaveBeenCalledTimes(expectCompiled ? 1 : 0);
        if (expectCompiled) {
            expect(warn.mock.calls[0][0]).toContain("Derived");
        }
    });

    it("serializes the same keys through JSON.stringify as the proxy path", () => {
        const root = Retree.root(new Slot());
        root.item = new Derived();
        const bookkeeping = {
            RETREE_COLLECTED_KEYS_SYMBOL: {},
            RETREE_LINKED_KEYS_SYMBOL: {},
            RETREE_SELECT_GETTERS_SYMBOL: {},
        };
        expect(JSON.parse(JSON.stringify(root))).toEqual({
            ...bookkeeping,
            options: {},
            item: {
                ...bookkeeping,
                options: {},
                cache: { hits: 0 },
                assigned: { value: 1 },
                label: "derived",
            },
            other: null,
        });
    });

    it("lets spies wrap an arrow-function field", () => {
        const root = Retree.root(new Slot());
        const spy = vi.spyOn(root, "onPick").mockReturnValue(7);
        expect(root.onPick(1)).toBe(7);
        spy.mockRestore();
        expect(root.onPick(2)).toBe(4);
    });

    it("pins the field role values the emitted schema uses", () => {
        expect(CompiledFieldRole.Reactive).toBe(0);
        expect(CompiledFieldRole.Ignore).toBe(1);
        expect(CompiledFieldRole.Link).toBe(2);
    });

    it("lets an assigned function shadow a prototype method", () => {
        const root = Retree.root(new Derived());
        const changed = vi.fn();
        Retree.on(root, "nodeChanged", changed);
        Reflect.set(root, "bump", () => 42);
        expect(root.bump()).toBe(42);
        expect(changed).toHaveBeenCalledTimes(1);
        Retree.clearListeners(root);
    });
});
