/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Wide-table render measurement for the raw-purity spec's performance gates
 * (specs/retree-raw.md §6): `useRaw` vs `useNode` for read-wide renders, and
 * `useRaw` mount with `toManaged` per row vs the `useNode` equivalent.
 * Prints timings with `--disable-console-intercept`; assertions are loose
 * sanity bounds so machine speed never gates CI.
 */
import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import { useNode } from "./useNode.js";
import { useRaw } from "./useRaw.js";

interface WideRow {
    id: number;
    cells: number[];
}

function makeRows(rows: number, cells: number): WideRow[] {
    const result: WideRow[] = [];
    for (let r = 0; r < rows; r++) {
        const rowCells: number[] = [];
        for (let c = 0; c < cells; c++) {
            rowCells.push(r * cells + c);
        }
        result.push({ id: r, cells: rowCells });
    }
    return result;
}

/**
 * Best-of-N timing: mounts via `setup` several times and keeps the fastest
 * run. Single-shot timings on shared CI runners are too noisy to gate on;
 * the minimum is the closest observable to the true cost.
 */
function time(label: string, setup: () => () => void): number {
    const RUNS = 5;
    // Warmup run so first-render module/JIT costs don't bias whichever
    // scenario is measured first.
    setup()();

    let best = Infinity;
    for (let i = 0; i < RUNS; i++) {
        const fn = setup();
        const start = performance.now();
        fn();
        const ms = performance.now() - start;
        if (ms < best) {
            best = ms;
        }
    }

    console.log(`${label}: ${best.toFixed(1)} ms (best of ${RUNS})`);
    return best;
}

describe("useRaw perf probe", () => {
    it("wide-table render: useRaw vs useNode", () => {
        const ROWS = 200;
        const CELLS = 40;

        const nodeMs = time("useNode wide table (200x40 reads)", () => {
            const nodeRoot = Retree.root({ rows: makeRows(ROWS, CELLS) });
            function NodeTable() {
                const rows = useNode(nodeRoot.rows);
                let total = 0;
                for (const row of rows) {
                    for (const cell of row.cells) {
                        total += cell;
                    }
                }
                return <div>{total}</div>;
            }
            return () => {
                render(<NodeTable />);
            };
        });

        const rawMs = time("useRaw wide table (200x40 reads)", () => {
            const rawRoot = Retree.root({ rows: makeRows(ROWS, CELLS) });
            function RawTable() {
                const [rows] = useRaw(rawRoot.rows);
                let total = 0;
                for (const row of rows) {
                    for (const cell of row.cells) {
                        total += cell;
                    }
                }
                return <div>{total}</div>;
            }
            return () => {
                render(<RawTable />);
            };
        });

        // Loose gate: raw reads must not be slower than trapped reads.
        expect(rawMs).toBeLessThanOrEqual(nodeMs * 1.5);
    });

    it("useRaw mount with toManaged per row vs useNode list", () => {
        const ROWS = 2000;

        const nodeMs = time("useNode list mount (2000 rows)", () => {
            const nodeRoot = Retree.root({ rows: makeRows(ROWS, 1) });
            function NodeList() {
                const rows = useNode(nodeRoot.rows);
                return <div>{rows.map((row) => row.id).join("")}</div>;
            }
            return () => {
                render(<NodeList />);
            };
        });

        let resolvedCount = 0;
        const rawMs = time(
            "useRaw list mount + toManaged all (2000 rows)",
            () => {
                const rawRoot = Retree.root({ rows: makeRows(ROWS, 1) });
                function RawList() {
                    const [rows, toManaged] = useRaw(rawRoot.rows);
                    return (
                        <div>
                            {rows
                                .map((row) => {
                                    const source = toManaged(row);
                                    if (source !== undefined) {
                                        resolvedCount++;
                                    }
                                    return row.id;
                                })
                                .join("")}
                        </div>
                    );
                }
                resolvedCount = 0;
                return () => {
                    render(<RawList />);
                };
            }
        );

        expect(resolvedCount).toBe(ROWS);
        // Gate (specs/retree-raw.md §6): ≤ the useNode equivalent, with slack
        // for jsdom noise.
        expect(rawMs).toBeLessThanOrEqual(nodeMs * 1.5);
    });
});
