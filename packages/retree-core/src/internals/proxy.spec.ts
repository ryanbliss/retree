import { describe, expect, it } from "vitest";
import { Retree } from "../Retree";
import {
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
} from "./proxy";

describe("proxy internals", () => {
    it("exposes proxy metadata for managed nodes", () => {
        const root = Retree.use({ child: { value: 1 } });
        const handler = getCustomProxyHandler(root.child);

        expect(handler).toBeDefined();
        expect(getBaseProxy(root.child)).toBe(root.child);
        expect(getUnproxiedNode(root.child)).not.toBe(root.child);
        expect(handler?.["[[Target]]" as never]).toBeUndefined();
    });
});