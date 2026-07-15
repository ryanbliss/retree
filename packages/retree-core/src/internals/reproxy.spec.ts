import { describe, expect, it } from "vitest";
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

    it("returns stable bound methods from the same reproxy", () => {
        const root = Retree.root(new MethodNode());
        const reproxy = getReproxyNode(root);
        const increment = reproxy.increment;

        expect(reproxy.increment).toBe(increment);

        increment();

        expect(root.value).toBe(1);
    });
});
