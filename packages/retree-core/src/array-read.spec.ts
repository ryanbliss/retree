/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { getReproxyNode } from "./internals/index.js";

interface Item {
    id: number;
    child?: { n: number };
}

function makeList(): { items: Item[] } {
    return Retree.root({
        items: [
            { id: 0, child: { n: 0 } },
            { id: 1, child: { n: 1 } },
            { id: 2 },
        ],
    });
}

/** A view of `items`: a push/pop pair changes the list itself. */
function viewOf(root: { items: Item[] }): Item[] {
    root.items.push({ id: -1 });
    root.items.pop();
    const view = getReproxyNode(root.items);
    expect(view).not.toBe(root.items);
    return view;
}

describe("array read methods", () => {
    it("hands callbacks base proxies from the base and latest views from a view", () => {
        const root = makeList();
        const base = root.items;
        const baseElements = base.map((item) => item);
        expect(baseElements[0]).toBe(base[0]);

        const view = viewOf(root);
        view[0].id = 10;
        const viewElements = view.map((item) => item);
        expect(viewElements[0]).toBe(getReproxyNode(base[0]));
        expect(viewElements[0]).not.toBe(base[0]);
        expect(Retree.raw(viewElements[0])).toBe(Retree.raw(base[0]));
        // The view's callback array argument is the latest view.
        let seen: Item[] | undefined;
        view.forEach((_item, _index, array) => {
            seen = array;
        });
        expect(seen).toBe(getReproxyNode(base));
    });

    it("materializes untouched elements through the parent edge", () => {
        const root = Retree.root({ items: [{ id: 0 }, { id: 1 }] });
        const found = root.items.find((item) => item.id === 1);
        expect(Retree.isNode(found)).toBe(true);
        expect(Retree.parent(found!)).toBe(root.items);
        expect(root.items[1]).toBe(found);
    });

    it("skips holes in callback methods and yields them from the iterator", () => {
        const holey: (number | undefined)[] = [1, 2, 3];
        delete holey[1];
        const root = Retree.root({ items: holey });
        const visited: number[] = [];
        root.items.forEach((_value, index) => visited.push(index));
        expect(visited).toEqual([0, 2]);
        const mapped = root.items.map((value) => value);
        expect(mapped.length).toBe(3);
        expect(Object.hasOwn(mapped, 1)).toBe(false);
        expect([...root.items]).toEqual([1, undefined, 3]);
        expect(Array.from(root.items.values())).toEqual([1, undefined, 3]);
    });

    it("reads the length once and elements live like the natives", () => {
        const root = Retree.root({ items: [1, 2, 3] });
        const seen: number[] = [];
        root.items.forEach((value, index) => {
            if (index === 0) {
                root.items[2] = 30;
                root.items.push(4);
            }
            seen.push(value);
        });
        expect(seen).toEqual([1, 2, 30]);
    });

    it("matches native reduce, some, every, and findIndex edge cases", () => {
        const root = Retree.root({
            items: [1, 2, 3] as number[],
            empty: [] as number[],
        });
        expect(root.items.reduce((sum, value) => sum + value)).toBe(6);
        expect(root.items.reduce((sum, value) => sum + value, 10)).toBe(16);
        expect(() => root.empty.reduce((sum, value) => sum + value)).toThrow(
            TypeError
        );
        expect(root.items.some((value) => value > 2)).toBe(true);
        expect(root.items.every((value) => value > 2)).toBe(false);
        expect(root.items.findIndex((value) => value === 2)).toBe(1);
        expect(root.items.findIndex((value) => value === 9)).toBe(-1);
        // @ts-expect-error a non-callable callback throws like the native
        expect(() => root.items.map(undefined)).toThrow(TypeError);
    });

    it("tracks the length and every element for selectors", () => {
        const root = Retree.root({ items: [{ id: 0 }, { id: 1 }] });
        const callback = vi.fn();
        Retree.select(
            () => root.items.map((item) => item.id).join(","),
            callback
        );
        root.items[1].id = 5;
        expect(callback).toHaveBeenCalledTimes(1);
        root.items.push({ id: 2 });
        expect(callback).toHaveBeenCalledTimes(2);
        root.items[0] = { id: 9 };
        expect(callback).toHaveBeenCalledTimes(3);
    });

    it("tracks iteration for selectors", () => {
        const root = Retree.root({ items: [1, 2] });
        const callback = vi.fn();
        Retree.select(() => {
            let total = 0;
            for (const value of root.items) total += value;
            return total;
        }, callback);
        root.items[0] = 10;
        expect(callback).toHaveBeenCalledTimes(1);
        root.items.push(1);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it("resolves at, slice, entries, and flatMap elements per read path", () => {
        const root = makeList();
        const base = root.items;
        expect(base.at(-1)).toBe(base[2]);
        expect(base.slice(1)[0]).toBe(base[1]);
        expect(base.slice(-2, -1)).toEqual([base[1]]);
        expect([...base.entries()][0]).toEqual([0, base[0]]);
        expect(base.flatMap((item) => [item])[0]).toBe(base[0]);
        expect([...base.keys()]).toEqual([0, 1, 2]);

        const view = viewOf(root);
        view[0].id = 10;
        const latest = getReproxyNode(base[0]);
        expect(view.at(0)).toBe(latest);
        expect(view.slice(0, 1)[0]).toBe(latest);
        expect([...view.entries()][0][1]).toBe(latest);
        expect(view.flatMap((item) => [item])[0]).toBe(latest);
    });

    it("searches by the identity each read path serves", () => {
        const root = makeList();
        const base = root.items;
        const view = viewOf(root);
        view[0].id = 10;
        expect(base.indexOf(base[0])).toBe(0);
        expect(base.includes(base[0])).toBe(true);
        expect(view.indexOf(view[0])).toBe(0);
        // The base proxy is not the identity the view serves.
        expect(view.indexOf(base[0])).toBe(-1);
        expect(base.includes(view[0])).toBe(false);
        expect(base.indexOf(Retree.raw(base[0]))).toBe(-1);
    });

    it("matches native indexOf and includes on primitives and holes", () => {
        const holey: (number | undefined)[] = [1, 2, 3, NaN, 2];
        delete holey[1];
        const root = Retree.root({ items: holey });
        expect(root.items.indexOf(2)).toBe(4);
        expect(root.items.indexOf(2, -1)).toBe(4);
        expect(root.items.indexOf(2, 5)).toBe(-1);
        expect(root.items.indexOf(NaN)).toBe(-1);
        expect(root.items.includes(NaN)).toBe(true);
        expect(root.items.indexOf(undefined)).toBe(-1);
        expect(root.items.includes(undefined)).toBe(true);
        expect(root.items.flatMap((value) => value).length).toBe(4);
    });

    it("flattens one level like the native", () => {
        const root = Retree.root({ items: [{ id: 0 }, { id: 1 }] });
        const flat = root.items.flatMap((item) => [item.id, [item.id]]);
        expect(flat).toEqual([0, [0], 1, [1]]);
    });

    it("tracks searches, slices, at, and filled holes for selectors", () => {
        const holey: (number | undefined)[] = [1, 2, 3];
        delete holey[1];
        const root = Retree.root({ nums: [1, 2, 3], holey });
        const search = vi.fn();
        Retree.select(() => root.nums.indexOf(9), search);
        root.nums.push(9);
        expect(search).toHaveBeenCalledTimes(1);
        root.nums[0] = 9;
        expect(search).toHaveBeenCalledTimes(2);

        const sliced = vi.fn();
        Retree.select(() => root.nums.slice(1).join(","), sliced);
        root.nums[2] = 30;
        expect(sliced).toHaveBeenCalledTimes(1);

        const last = vi.fn();
        Retree.select(() => root.nums.at(-1), last);
        root.nums.push(4);
        expect(last).toHaveBeenCalledTimes(1);

        const filled = vi.fn();
        Retree.select(
            () => root.holey.filter((value) => value !== undefined).length,
            filled
        );
        root.holey[1] = 5;
        expect(filled).toHaveBeenCalledTimes(1);
    });

    it("leaves overridden methods and array subclasses on the native path", () => {
        class Tagged extends Array<number> {
            public tag = "tagged";
        }
        const tagged = new Tagged();
        tagged.push(1, 2);
        const overridden = Object.assign([1, 2], {
            map: () => "overridden",
        });
        const root = Retree.root({ tagged, overridden });
        expect(root.tagged.map((value) => value * 2)).toBeInstanceOf(Tagged);
        expect(root.overridden.map(() => 0)).toBe("overridden");
    });
});
