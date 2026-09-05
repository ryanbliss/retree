/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Targeted perf probe for the September 2026 audit, covering paths the other
 * probes did not measure: change-record accumulation across one transaction,
 * the deferred ReactiveNode lifecycle drain at N nodes, deep writes under a
 * root `treeChanged` listener, and tracked `Retree.select` re-evaluation as
 * the read set grows. Prints timings with `--disable-console-intercept`; the
 * assertions are loose scaling bounds that catch a return to quadratic
 * behavior without gating CI on machine speed.
 */
import { describe, expect, it } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";

interface ISizedTiming {
    size: number;
    ms: number;
}

function timeOnce(label: string, fn: () => void): number {
    const start = performance.now();
    fn();
    const ms = performance.now() - start;
    console.log(`${label}: ${ms.toFixed(3)} ms`);
    return ms;
}

/**
 * Time-per-size ratio between the smallest and largest sample. Linear work
 * tracks the size ratio; the quadratic paths this probe guards against
 * measured 4-8x above it.
 */
function scalingFactor(label: string, timings: ISizedTiming[]): number {
    const from = timings[0];
    const to = timings[timings.length - 1];
    const sizeScale = to.size / from.size;
    const timeScale = to.ms / Math.max(from.ms, 0.05);
    console.log(
        `${label} scaling for ${sizeScale}x size: ${timeScale.toFixed(1)}x time`
    );
    return timeScale;
}

const SIZES = [1000, 8000];
const LINEAR_SCALING_BOUND = 24;

describe("transaction scaling perf probe", () => {
    it("accumulates change records linearly across one transaction", () => {
        const writeTimings: ISizedTiming[] = [];
        for (const size of SIZES) {
            const tree = Retree.root({ count: 0 });
            let changesSeen = 0;
            let emissions = 0;
            const off = Retree.on(tree, "nodeChanged", (_node, changes) => {
                emissions++;
                changesSeen = changes.length;
            });
            const ms = timeOnce(
                `transaction with ${size} writes to one listened node`,
                () => {
                    Retree.runTransaction(() => {
                        for (let write = 1; write <= size; write++) {
                            tree.count = write;
                        }
                    });
                }
            );
            off();
            expect(emissions).toBe(1);
            expect(changesSeen).toBe(size);
            writeTimings.push({ size, ms });
        }
        expect(
            scalingFactor("one-node transaction writes", writeTimings)
        ).toBeLessThan(LINEAR_SCALING_BOUND);

        const pushTimings: ISizedTiming[] = [];
        for (const size of SIZES) {
            const tree = Retree.root({ list: [] as number[] });
            let emissions = 0;
            const off = Retree.on(tree, "treeChanged", () => {
                emissions++;
            });
            const ms = timeOnce(
                `transaction with ${size} pushes under a root treeChanged listener`,
                () => {
                    Retree.runTransaction(() => {
                        for (let index = 0; index < size; index++) {
                            tree.list.push(index);
                        }
                    });
                }
            );
            off();
            expect(emissions).toBe(1);
            pushTimings.push({ size, ms });
        }
        expect(
            scalingFactor("treeChanged transaction pushes", pushTimings)
        ).toBeLessThan(LINEAR_SCALING_BOUND);
    });

    it("drains deferred ReactiveNode lifecycles linearly in written nodes", () => {
        class Row extends ReactiveNode {
            public value = 0;
        }
        const timings: ISizedTiming[] = [];
        for (const size of SIZES) {
            const table = Retree.root({ rows: [] as Row[] });
            for (let index = 0; index < size; index++) {
                table.rows.push(new Row());
            }
            let notifications = 0;
            const offs = table.rows.map((row) =>
                Retree.on(row, "nodeChanged", () => {
                    notifications++;
                })
            );
            const ms = timeOnce(
                `transaction writing ${size} listened ReactiveNodes`,
                () => {
                    Retree.runTransaction(() => {
                        for (const row of table.rows) {
                            row.value += 1;
                        }
                    });
                }
            );
            offs.forEach((off) => off());
            expect(notifications).toBe(size);
            timings.push({ size, ms });
        }
        expect(scalingFactor("lifecycle drain", timings)).toBeLessThan(
            LINEAR_SCALING_BOUND
        );
    });

    it("keeps deep writes under a root treeChanged listener cheap", () => {
        const DEPTH = 20;
        const WRITES = 10_000;
        interface IChain {
            value: number;
            child?: IChain;
        }
        const makeChain = (): IChain => {
            const root: IChain = { value: 0 };
            let current = root;
            for (let level = 1; level < DEPTH; level++) {
                current.child = { value: 0 };
                current = current.child;
            }
            return root;
        };
        const leafOf = (root: IChain): IChain => {
            let current = root;
            while (current.child !== undefined) {
                current = current.child;
            }
            return current;
        };

        const listened = Retree.root(makeChain());
        const listenedLeaf = leafOf(listened);
        let treeChanges = 0;
        const offTree = Retree.on(listened, "treeChanged", () => {
            treeChanges++;
        });
        const offLeaf = Retree.on(listenedLeaf, "nodeChanged", () => undefined);
        const listenedMs = timeOnce(
            `${WRITES} leaf writes at depth ${DEPTH}, root treeChanged + leaf nodeChanged`,
            () => {
                for (let write = 1; write <= WRITES; write++) {
                    listenedLeaf.value = write;
                }
            }
        );
        offTree();
        offLeaf();
        expect(treeChanges).toBe(WRITES);

        const unlistened = Retree.root(makeChain());
        const unlistenedLeaf = leafOf(unlistened);
        const offUnlistenedLeaf = Retree.on(
            unlistenedLeaf,
            "nodeChanged",
            () => undefined
        );
        timeOnce(
            `${WRITES} leaf writes at depth ${DEPTH}, leaf nodeChanged only`,
            () => {
                for (let write = 1; write <= WRITES; write++) {
                    unlistenedLeaf.value = write;
                }
            }
        );
        offUnlistenedLeaf();
        expect(listenedMs).toBeLessThan(5_000);
    });

    it("re-evaluates a tracked Retree.select linearly in items read", () => {
        interface IItem {
            id: number;
            score: number;
        }
        const timings: ISizedTiming[] = [];
        for (const size of [500, 2000]) {
            const items: IItem[] = [];
            for (let index = 0; index < size; index++) {
                items.push({ id: index, score: index % 100 });
            }
            const tree = Retree.root({ items });
            let notifications = 0;
            const off = Retree.select(
                () => {
                    let total = 0;
                    for (const item of tree.items) {
                        total += item.score;
                    }
                    return total;
                },
                () => {
                    notifications++;
                }
            );
            const middle = size >> 1;
            const RELATED_WRITES = 20;
            const ms =
                timeOnce(
                    `${RELATED_WRITES} related writes, tracked select over ${size} items`,
                    () => {
                        for (let write = 1; write <= RELATED_WRITES; write++) {
                            tree.items[middle].score = 1000 + write;
                        }
                    }
                ) / RELATED_WRITES;
            off();
            expect(notifications).toBe(RELATED_WRITES);
            timings.push({ size, ms });
        }
        expect(
            scalingFactor("tracked select related write", timings)
        ).toBeLessThan(10);
    });
});
