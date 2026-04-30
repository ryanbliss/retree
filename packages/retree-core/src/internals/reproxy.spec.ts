import { describe, expect, it } from "vitest";
import { Retree } from "../Retree";
import { getBaseProxy } from "./proxy";
import { getReproxyNode, updateReproxyNode } from "./reproxy";

describe("reproxy internals", () => {
    it("creates a fresh snapshot and preserves access to the base proxy", () => {
        const root = Retree.use({ child: { value: 1 } });
        const original = getReproxyNode(root.child);

        root.child.value = 2;

        const updated = getReproxyNode(root.child);
        expect(updated).not.toBe(original);
        expect(getBaseProxy(updated)).toBe(root.child);

        const manual = updateReproxyNode(root.child);
        expect(manual).not.toBe(updated);
        expect(manual.value).toBe(2);
    });
});