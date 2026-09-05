import { describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "../ReactiveNode.js";
import { Retree } from "../Retree.js";
import { getBaseProxy } from "./proxy.js";
import { isCustomProxy } from "./proxy-types.js";
import { getReproxyNode, updateReproxyNode } from "./reproxy.js";

class MethodNode extends ReactiveNode {
    public value = 0;

    public increment() {
        this.value += 1;
    }

    get dependencies() {
        return [];
    }
}

describe("reproxy internals", () => {
    it("allocates views only for observed ancestors and preserves intervening reads", () => {
        type Node = { value: number; child?: Node };
        let input: Node = { value: 0 };
        for (let depth = 0; depth < 100; depth++)
            input = { value: 0, child: input };
        const root = Retree.root(input);
        const middle = root.child!;
        let leaf = middle;
        while (leaf.child) leaf = leaf.child;
        const rootViews: object[] = [];
        const off = Retree.on(root, "treeChanged", (view) =>
            rootViews.push(view)
        );
        let allocations = 0;
        const NativeProxy = Proxy;
        vi.stubGlobal(
            "Proxy",
            new NativeProxy(NativeProxy, {
                construct(target, args) {
                    allocations++;
                    return Reflect.construct(target, args);
                },
            })
        );
        try {
            for (let count = 0; count < 10; count++) leaf.value++;
            expect(allocations).toBe(20);
            expect(new Set(rootViews).size).toBe(10);
            const beforeRead = allocations;
            const first = getReproxyNode(middle);
            expect(allocations - beforeRead).toBe(1);
            expect(getReproxyNode(middle)).toBe(first);
            Retree.runTransaction(() => {
                leaf.value++;
                const during = getReproxyNode(middle);
                expect(during).not.toBe(first);
                leaf.value++;
                expect(getReproxyNode(middle)).not.toBe(during);
            });
            expect(getBaseProxy(getReproxyNode(middle))).toBe(middle);
        } finally {
            vi.unstubAllGlobals();
            off();
        }
    });

    it("keeps base and retained views on the same live parent edge", () => {
        const child = Retree.root({ value: 0 });
        child.value++;
        const view = getReproxyNode(child);
        const root = Retree.root({ list: [] as { value: number }[] });
        root.list.push(view);
        expect(Retree.parent(child)).toBe(root.list);
        expect(Retree.parent(view)).toBe(root.list);
        const changed = vi.fn();
        const stop = Retree.on(root, "treeChanged", changed);
        view.value++;
        expect(changed).toHaveBeenCalledTimes(1);
        root.list.pop();
        expect(Retree.parent(child)).toBeNull();
        expect(Retree.parent(view)).toBeNull();
        stop();
    });

    it("creates a fresh snapshot and preserves access to the base proxy", () => {
        const root = Retree.root({ child: { value: 1 } });
        const original = getReproxyNode(root.child);

        root.child.value = 2;

        const updated = getReproxyNode(root.child);
        expect(updated).not.toBe(original);
        expect(getBaseProxy(updated)).toBe(root.child);

        if (!isCustomProxy<{ value: number }>(root.child)) {
            throw new Error(
                "Expected root.child to be a custom proxy before manually updating its reproxy."
            );
        }
        const manual = updateReproxyNode(root.child);
        expect(manual).not.toBe(updated);
        expect(manual.value).toBe(2);
    });

    it("runs write, delete, and define traps on a view once through the base handler", () => {
        const root = Retree.root({
            record: { a: 1, b: 2 } as Record<string, number>,
        });
        root.record.a = 10;
        const view = getReproxyNode(getBaseProxy(root.record));
        expect(view).not.toBe(root.record);
        const changed = vi.fn();
        const stop = Retree.on(root.record, "nodeChanged", changed);

        view.c = 3;
        expect(changed).toHaveBeenCalledTimes(1);
        expect(Retree.raw(root.record).c).toBe(3);

        delete view.a;
        expect(changed).toHaveBeenCalledTimes(2);
        expect("a" in view).toBe(false);
        expect(Object.keys(view)).toEqual(["b", "c"]);

        Object.defineProperty(view, "d", {
            value: 4,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        expect(changed).toHaveBeenCalledTimes(3);
        expect(getReproxyNode(root.record).d).toBe(4);
        stop();
    });

    it("returns stable bound methods from the same reproxy", () => {
        const root = Retree.root(new MethodNode());
        const reproxy = getReproxyNode(root);
        const increment = reproxy.increment;

        expect(reproxy.increment).toBe(increment);

        increment();

        expect(root.value).toBe(1);
    });
});
