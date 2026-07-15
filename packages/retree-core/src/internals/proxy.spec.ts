import { describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "../ReactiveNode.js";
import { Retree } from "../Retree.js";
import {
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
} from "./proxy.js";

class MethodNode extends ReactiveNode {
    public value = 0;

    public increment() {
        this.value += 1;
    }

    get dependencies() {
        return [];
    }
}

describe("proxy internals", () => {
    it("exposes proxy metadata for managed nodes", () => {
        const root = Retree.root({ child: { value: 1 } });
        const handler = getCustomProxyHandler(root.child);

        expect(handler).toBeDefined();
        expect(getBaseProxy(root.child)).toBe(root.child);
        expect(getUnproxiedNode(root.child)).not.toBe(root.child);
        expect(handler?.["[[Target]]" as never]).toBeUndefined();
    });

    it("returns stable bound methods from the same base proxy", () => {
        const root = Retree.root(new MethodNode());
        const increment = root.increment;

        expect(root.increment).toBe(increment);

        increment();

        expect(root.value).toBe(1);
    });

    it("does not emit nodeChanged when deleting a key that does not exist", () => {
        const root = Retree.root({
            obj: { a: 1 } as Record<string, number>,
        });
        const nodeChanged = vi.fn();
        const unsubscribe = Retree.on(root.obj, "nodeChanged", nodeChanged);

        const missingResult = delete root.obj.missing;
        expect(missingResult).toBe(true);
        expect(nodeChanged).not.toHaveBeenCalled();

        const existingResult = delete root.obj.a;
        expect(existingResult).toBe(true);
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it("does not emit nodeChanged when writing NaN over NaN", () => {
        const root = Retree.root({ value: NaN });
        const nodeChanged = vi.fn();
        const unsubscribe = Retree.on(root, "nodeChanged", nodeChanged);

        root.value = NaN;
        expect(nodeChanged).not.toHaveBeenCalled();

        root.value = 1;
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it("resolves children stored under Object.prototype member names", () => {
        // The children cache has a null prototype: a key like
        // "hasOwnProperty" must resolve to the stored child, never to the
        // Object.prototype function as a phantom cache hit.
        const root = Retree.root({
            box: {
                first: { v: 0 },
                hasOwnProperty: { v: 1 },
                toString: { v: 2 },
            },
        });
        // Materialize another child first so the cache record exists before
        // the prototype-named keys are read.
        void root.box.first;

        expect(typeof root.box.hasOwnProperty).toBe("object");
        expect(root.box.hasOwnProperty.v).toBe(1);
        expect(typeof root.box.toString).toBe("object");
        expect(root.box.toString.v).toBe(2);

        const nodeChanged = vi.fn();
        const unsubscribe = Retree.on(
            root.box.hasOwnProperty,
            "nodeChanged",
            nodeChanged
        );
        root.box.hasOwnProperty.v = 10;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it("resolves prototype-named children through reproxies", () => {
        const root = Retree.root({
            box: { first: { v: 0 }, valueOf: { v: 3 } },
        });
        void root.box.first;

        let observedValue: number | undefined;
        const unsubscribe = Retree.on(root.box, "treeChanged", (reproxy) => {
            observedValue = reproxy.valueOf.v;
        });
        root.box.valueOf.v = 30;
        expect(observedValue).toBe(30);
        unsubscribe();
    });
});
