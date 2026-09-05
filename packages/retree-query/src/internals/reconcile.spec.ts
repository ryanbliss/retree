import { describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import { reconcileArray } from "./reconcile.js";

describe("raw reconciliation traversal", () => {
    it("visits a deep changed branch once without using the call stack", () => {
        let reads = 0;
        interface Branch {
            child?: Branch;
            value?: number;
        }
        let previous: Branch = { value: 0 };
        let next: Branch = { value: 1 };
        for (let depth = 0; depth < 5000; depth++) {
            previous = { child: previous };
            const child = next;
            next = {
                get child() {
                    reads++;
                    return child;
                },
            };
        }
        const current = Retree.root([{ id: 1, branch: previous }]);
        Retree.runTransaction(() =>
            reconcileArray(current, [{ id: 1, branch: next }], (row) => row.id)
        );
        let leaf = Retree.raw(current)[0].branch;
        while (leaf.child !== undefined) leaf = leaf.child;
        expect(leaf.value).toBe(1);
        expect(reads).toBe(5000);
    });

    it("materializes only changed rows and branches of a fresh result", () => {
        const original = Array.from({ length: 1000 }, (_, id) => ({
            id,
            nested: { value: id },
            untouched: { label: "same" },
        }));
        const current = Retree.root(original);
        const next = structuredClone(original);
        next[500].nested.value = -1;
        Retree.runTransaction(() =>
            reconcileArray(current, next, (row) => row.id)
        );
        expect(
            original.filter((row) => Retree.managed(row) !== undefined)
        ).toEqual([original[500]]);
        expect(Retree.managed(original[500].nested)).toBeDefined();
        expect(Retree.managed(original[500].untouched)).toBeUndefined();
        expect(original[500].nested.value).toBe(-1);
        const unchanged = structuredClone(original);
        Retree.runTransaction(() =>
            reconcileArray(current, unchanged, (row) => row.id)
        );
        expect(
            original.filter((row) => Retree.managed(row) !== undefined)
        ).toEqual([original[500]]);
    });
});
