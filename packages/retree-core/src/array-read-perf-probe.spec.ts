/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Targeted perf probe for array read methods (`map`, `filter`, `forEach`,
 * `find`, iteration) through the base proxy and through a view.
 * Prints timings with `--disable-console-intercept`; assertions are loose
 * sanity bounds so this never gates CI on machine speed.
 * See benchmarks/findings-sep-6-2026.md for context.
 */
import { describe, expect, it } from "vitest";
import { Retree } from "./Retree.js";
import {
    collectDependencyAccesses,
    collectDependencyComparisonAccesses,
    getReproxyNode,
} from "./internals/index.js";

interface Row {
    id: number;
    done: boolean;
    value: { classId: string };
}

function makeRows(count: number): Row[] {
    const rows: Row[] = [];
    for (let i = 0; i < count; i++) {
        rows.push({
            id: i,
            done: i % 3 === 0,
            value: { classId: i % 2 === 0 ? "a" : "b" },
        });
    }
    return rows;
}

function median(label: string, fn: () => unknown, runs = 9): number {
    fn(); // warmup
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        fn();
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const ms = samples[Math.floor(samples.length / 2)];
    console.log(`${label}: ${ms.toFixed(3)} ms`);
    return ms;
}

function sumIds(rows: Row[]): number {
    let total = 0;
    for (const row of rows) total += row.id;
    return total;
}

describe("array read perf probe", () => {
    const ROWS = 50_000;

    it("map/filter/forEach/find/iteration via raw, base, and view", () => {
        const root = Retree.root({ rows: makeRows(ROWS) });
        const base = root.rows;
        sumIds(base); // materialize every row once
        // A push/pop pair changes the list itself so it has a view.
        base.push({ id: -1, done: false, value: { classId: "x" } });
        base.pop();
        const view = getReproxyNode(base);
        expect(view).not.toBe(base);
        const raw = Retree.raw(base);
        const expected = sumIds(raw);

        const mapIds = (rows: Row[]) => rows.map((row) => row.id);
        expect(mapIds(base).length).toBe(ROWS);
        expect(mapIds(view).length).toBe(ROWS);
        median("map via raw", () => mapIds(raw));
        median("map via base", () => mapIds(base));
        median("map via view", () => mapIds(view));

        const filterDone = (rows: Row[]) => rows.filter((row) => row.done);
        median("filter via raw", () => filterDone(raw));
        median("filter via base", () => filterDone(base));
        median("filter via view", () => filterDone(view));

        const forEachSum = (rows: Row[]) => {
            let total = 0;
            rows.forEach((row) => {
                total += row.id;
            });
            return total;
        };
        expect(forEachSum(view)).toBe(expected);
        median("forEach via raw", () => forEachSum(raw));
        median("forEach via base", () => forEachSum(base));
        median("forEach via view", () => forEachSum(view));

        const findLast = (rows: Row[]) =>
            rows.find((row) => row.id === ROWS - 1);
        expect(findLast(view)?.id).toBe(ROWS - 1);
        median("find via raw", () => findLast(raw));
        median("find via base", () => findLast(base));
        median("find via view", () => findLast(view));

        expect(sumIds(view)).toBe(expected);
        median("for..of via raw", () => sumIds(raw));
        median("for..of via base", () => sumIds(base));
        median("for..of via view", () => sumIds(view));

        // Elements handed to callbacks keep their proxy identity per read path.
        const baseElements = base.map((row) => row);
        const viewElements = view.map((row) => row);
        expect(Retree.isNode(baseElements[0])).toBe(true);
        expect(Retree.isNode(viewElements[0])).toBe(true);
        expect(Retree.raw(baseElements[0])).toBe(raw[0]);
        expect(Retree.raw(viewElements[0])).toBe(raw[0]);
    });

    it("tracked map via base", () => {
        const root = Retree.root({ rows: makeRows(ROWS) });
        const base = root.rows;
        sumIds(base);
        const mapIds = () => base.map((row) => row.id);
        median(
            "tracked map (dependencies mode)",
            () => collectDependencyAccesses(mapIds),
            5
        );
        median(
            "tracked map (comparisons mode)",
            () => collectDependencyComparisonAccesses(mapIds),
            5
        );
    });
});
