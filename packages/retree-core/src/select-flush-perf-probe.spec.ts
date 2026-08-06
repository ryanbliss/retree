/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Targeted perf probe for the August 2026 `@select` caching work.
 * Prints timings with `--disable-console-intercept`; assertions are
 * intentionally loose sanity bounds so this never gates CI on machine speed.
 * Companion deterministic-count coverage lives in select-transaction.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { select } from "./decorators.js";

interface IProbeItem {
    id: number;
    score: number;
}

function makeItems(count: number): IProbeItem[] {
    const items: IProbeItem[] = [];
    for (let index = 0; index < count; index++) {
        items.push({ id: index, score: (index * 7) % 100 });
    }
    return items;
}

function time(label: string, fn: () => unknown, iterations = 1): number {
    fn(); // warmup
    const start = performance.now();
    for (let index = 0; index < iterations; index++) fn();
    const ms = (performance.now() - start) / iterations;

    console.log(`${label}: ${ms.toFixed(3)} ms`);
    return ms;
}

describe("select flush perf probe", () => {
    it("transaction with many writes to an owner with a scanning @select getter", () => {
        class Board extends ReactiveNode {
            public counter = 0;
            public items: IProbeItem[] = makeItems(1000);

            @select()
            public get highScoreTotal(): number {
                let total = this.counter;
                for (const item of this.items) {
                    if (item.score > 50) {
                        total += item.score;
                    }
                }
                return total;
            }
        }

        const board = Retree.root(new Board());
        Retree.on(board, "nodeChanged", () => undefined);
        // Materialize children so the probe measures steady state.
        board.highScoreTotal;

        const ms = time(
            "transaction with 50 own-field writes, @select scanning 1000 items",
            () => {
                Retree.runTransaction(() => {
                    for (let write = 0; write < 50; write++) {
                        board.counter = board.counter + 1;
                    }
                });
            },
            10
        );
        expect(ms).toBeLessThan(2_000);
    });

    it("transaction changing many @select dependencies in one flush", () => {
        interface ICell {
            value: number;
        }
        class Sheet extends ReactiveNode {
            public cells: ICell[] = makeItems(20).map((item) => ({
                value: item.score,
            }));

            @select((self: Sheet) => self.cells.map((cell) => cell))
            public get total(): number {
                let total = 0;
                for (const cell of this.cells) {
                    total += cell.value;
                }
                return total;
            }
        }

        const sheet = Retree.root(new Sheet());
        Retree.on(sheet, "nodeChanged", () => undefined);
        sheet.total;

        const ms = time(
            "transaction writing 20 @select dependencies in one flush",
            () => {
                Retree.runTransaction(() => {
                    for (const cell of sheet.cells) {
                        cell.value = cell.value + 1;
                    }
                });
            },
            10
        );
        expect(ms).toBeLessThan(2_000);
    });

    it("single scalar write with a scanning @select getter active", () => {
        class Tracker extends ReactiveNode {
            public counter = 0;
            public items: IProbeItem[] = makeItems(1000);

            @select()
            public get scanned(): number {
                let total = this.counter;
                for (const item of this.items) {
                    total += item.id % 3;
                }
                return total;
            }
        }

        const tracker = Retree.root(new Tracker());
        Retree.on(tracker, "nodeChanged", () => undefined);
        tracker.scanned;

        const ms = time(
            "single own-field write, @select scanning 1000 items",
            () => {
                tracker.counter = tracker.counter + 1;
            },
            20
        );
        expect(ms).toBeLessThan(1_000);
    });
});
