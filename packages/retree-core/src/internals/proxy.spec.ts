import { describe, expect, it } from "vitest";
import { ReactiveNode } from "../ReactiveNode";
import { Retree } from "../Retree";
import { getBaseProxy, getCustomProxyHandler, getUnproxiedNode } from "./proxy";

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
});
