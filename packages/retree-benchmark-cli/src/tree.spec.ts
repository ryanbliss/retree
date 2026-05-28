import { describe, expect, it } from "vitest";
import { createBenchmarkTree, serializeBenchmarkNode } from "./tree";

describe("benchmark tree generation", () => {
    it("creates deterministic object trees for the same depth and seed", () => {
        const first = createBenchmarkTree({
            depth: 3,
            seed: 123,
            width: 2,
        });
        const second = createBenchmarkTree({
            depth: 3,
            seed: 123,
            width: 2,
        });

        expect(serializeBenchmarkNode(first.root)).toEqual(
            serializeBenchmarkNode(second.root)
        );
    });

    it("varies deterministic object trees when the seed changes", () => {
        const first = createBenchmarkTree({
            depth: 3,
            seed: 123,
            width: 2,
        });
        const second = createBenchmarkTree({
            depth: 3,
            seed: 124,
            width: 2,
        });

        expect(serializeBenchmarkNode(first.root)).not.toEqual(
            serializeBenchmarkNode(second.root)
        );
    });

    it("keeps depth linear while mixing arrays, records, maps, and sets", () => {
        const tree = createBenchmarkTree({
            depth: 4,
            seed: 555,
            width: 3,
        });

        expect(tree.nodesByDepth).toHaveLength(5);
        expect(tree.target).toBe(tree.nodesByDepth[4]);
        expect(tree.root.arrayChildren).toHaveLength(3);
        expect(Object.keys(tree.root.recordChildren)).toHaveLength(3);
        expect(tree.root.mapChildren.size).toBe(3);
        expect(tree.root.setChildren.size).toBe(3);
        expect(tree.root.wideChildren).toHaveLength(3);
        expect(tree.root.wideChildren[0]?.primary).toBeNull();
    });
});
