/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Targeted perf probe used during the July 2026 performance work.
 * Prints timings with `--disable-console-intercept`; assertions are
 * intentionally loose sanity bounds so this never gates CI on machine speed.
 * See benchmarks/findings-jul-10-2026.md for context.
 */
import { describe, expect, it } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import {
    collectDependencyComparisonAccesses,
    getUnproxiedNode,
} from "./internals";

interface Item {
    id: number;
    name: string;
    score: number;
    tags: { label: string; weight: number }[];
}

interface Group {
    title: string;
    items: Item[];
}

function makeTree(groups: number, itemsPerGroup: number): { groups: Group[] } {
    const result: { groups: Group[] } = { groups: [] };
    for (let g = 0; g < groups; g++) {
        const items: Item[] = [];
        for (let i = 0; i < itemsPerGroup; i++) {
            items.push({
                id: g * itemsPerGroup + i,
                name: `item-${g}-${i}`,
                score: (g * 31 + i * 7) % 100,
                tags: [
                    { label: "a", weight: i % 5 },
                    { label: "b", weight: g % 3 },
                ],
            });
        }
        result.groups.push({ title: `group-${g}`, items });
    }
    return result;
}

function scan(root: { groups: Group[] }): number {
    let total = 0;
    for (const group of root.groups) {
        for (const item of group.items) {
            if (item.score > 50) {
                total += item.tags[0].weight + item.tags[1].weight;
            }
            total += item.id % 3;
        }
    }
    return total;
}

function time(label: string, fn: () => unknown, iterations = 1): number {
    fn(); // warmup
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const ms = (performance.now() - start) / iterations;

    console.log(`${label}: ${ms.toFixed(3)} ms`);
    return ms;
}

function timeOnce(label: string, fn: () => unknown): number {
    const start = performance.now();
    fn();
    const ms = performance.now() - start;

    console.log(`${label}: ${ms.toFixed(3)} ms`);
    return ms;
}

describe("perf probe", () => {
    it("read paths: raw vs proxy first-touch vs proxy steady-state", () => {
        const GROUPS = 100;
        const ITEMS = 100; // 10k items, ~30k+ nested nodes

        const rawTree = makeTree(GROUPS, ITEMS);
        const rawExpected = scan(rawTree);
        time("raw scan steady", () => scan(rawTree), 5);

        let tree!: { groups: Group[] };
        timeOnce("Retree.root()", () => {
            tree = Retree.root(makeTree(GROUPS, ITEMS));
        });

        let firstTouchTotal = 0;
        timeOnce("proxied scan FIRST touch (materialization)", () => {
            firstTouchTotal = scan(tree);
        });
        expect(firstTouchTotal).toBe(rawExpected);

        time("proxied scan steady-state", () => scan(tree), 5);

        const raw = getUnproxiedNode(tree);
        if (raw === undefined) {
            throw new Error("perf-probe: expected managed tree to unwrap");
        }
        time("scan via getUnproxiedNode", () => scan(raw), 5);
        time("scan via Retree.raw", () => scan(Retree.raw(tree)), 5);
    });

    it("dependency-tracked scan scaling", () => {
        const timings: { items: number; ms: number }[] = [];
        for (const items of [250, 500, 1000, 2000]) {
            const tree = Retree.root(makeTree(10, items / 10));
            scan(tree); // materialize first
            const ms = time(
                `tracked scan, ${items} items`,
                () => collectDependencyComparisonAccesses(() => scan(tree)),
                1
            );
            timings.push({ items, ms });
        }
        const first = timings[0];
        const last = timings[timings.length - 1];
        const scale = last.ms / first.ms;
        const itemScale = last.items / first.items;

        console.log(
            `tracked scan scaling factor for ${itemScale}x items: ${scale.toFixed(
                1
            )}x time`
        );
    });

    it("tracked Retree.select initial + write cost", () => {
        const tree = Retree.root(makeTree(10, 100)); // 1k items
        scan(tree);
        timeOnce("Retree.select(tracked) subscribe, 1k items", () => {
            const unsubscribe = Retree.select(
                () => scan(tree),
                () => {}
            );
            (globalThis as { __probeUnsub?: () => void }).__probeUnsub =
                unsubscribe;
        });
        timeOnce("scalar write w/ tracked select active", () => {
            tree.groups[0].items[0].score = 999;
        });
        timeOnce("second scalar write w/ tracked select active", () => {
            tree.groups[5].items[5].score = 998;
        });
        timeOnce("unrelated write (name) w/ tracked select active", () => {
            tree.groups[3].items[3].name = "renamed";
        });
        timeOnce("100 unrelated writes w/ tracked select active", () => {
            for (let i = 0; i < 100; i++) {
                tree.groups[4].items[i % 100].name = `renamed-${i}`;
            }
        });
        (globalThis as { __probeUnsub?: () => void }).__probeUnsub?.();
        delete (globalThis as { __probeUnsub?: () => void }).__probeUnsub;
    });

    it("reactive node with many dependency edges on one node", () => {
        class ManyEdges extends ReactiveNode {
            public items: number[] = [];

            constructor() {
                super();
                for (let i = 0; i < 50; i++) {
                    this.items.push(i);
                }
            }

            get dependencies() {
                const edges: ReturnType<typeof this.dependency>[] = [];
                for (let i = 0; i < 50; i++) {
                    edges.push(this.dependency(this.items, [this.items[i]]));
                }
                return edges;
            }
        }

        const node = Retree.root(new ManyEdges());
        let notifications = 0;
        const off = Retree.on(node, "nodeChanged", () => {
            notifications++;
        });
        timeOnce("first write w/ 50 edges on one dependency", () => {
            node.items[0] = 1000;
        });
        timeOnce("100 writes w/ 50 edges on one dependency", () => {
            for (let i = 0; i < 100; i++) {
                node.items[i % 50] = 2000 + i;
            }
        });
        expect(notifications).toBeGreaterThan(0);
        off();
    });

    it("write path: push N items, with and without listener", () => {
        const tree = Retree.root({ list: [] as { v: number }[] });
        timeOnce("push 1000 items (no listeners)", () => {
            for (let i = 0; i < 1000; i++) tree.list.push({ v: i });
        });

        const tree2 = Retree.root({ list: [] as { v: number }[] });
        const off = Retree.on(tree2, "treeChanged", () => {});
        timeOnce("push 1000 items (treeChanged on root)", () => {
            for (let i = 0; i < 1000; i++) tree2.list.push({ v: i });
        });
        off();

        const tree3 = Retree.root({ list: [] as { v: number }[] });
        timeOnce("push 1000 items in runTransaction (no listeners)", () => {
            Retree.runTransaction(() => {
                for (let i = 0; i < 1000; i++) tree3.list.push({ v: i });
            });
        });
    });
});
