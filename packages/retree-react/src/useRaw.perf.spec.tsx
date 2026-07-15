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

function time(label: string, fn: () => void): number {
    const start = performance.now();
    fn();
    const ms = performance.now() - start;

    console.log(`${label}: ${ms.toFixed(1)} ms`);
    return ms;
}

describe("useRaw perf probe", () => {
    it("wide-table render: useRaw vs useNode", () => {
        const ROWS = 200;
        const CELLS = 40;

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
        const nodeMs = time("useNode wide table (200x40 reads)", () => {
            render(<NodeTable />);
        });

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
        const rawMs = time("useRaw wide table (200x40 reads)", () => {
            render(<RawTable />);
        });

        // Loose gate: raw reads must not be slower than trapped reads.
        expect(rawMs).toBeLessThanOrEqual(nodeMs * 1.5);
    });

    it("useRaw mount with toManaged per row vs useNode list", () => {
        const ROWS = 2000;

        const nodeRoot = Retree.root({ rows: makeRows(ROWS, 1) });
        function NodeList() {
            const rows = useNode(nodeRoot.rows);
            return <div>{rows.map((row) => row.id).join("")}</div>;
        }
        const nodeMs = time("useNode list mount (2000 rows)", () => {
            render(<NodeList />);
        });

        const rawRoot = Retree.root({ rows: makeRows(ROWS, 1) });
        let resolvedCount = 0;
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
        const rawMs = time(
            "useRaw list mount + toManaged all (2000 rows)",
            () => {
                render(<RawList />);
            }
        );

        expect(resolvedCount).toBe(ROWS);
        // Gate (specs/retree-raw.md §6): ≤ the useNode equivalent, with slack
        // for jsdom noise.
        expect(rawMs).toBeLessThanOrEqual(nodeMs * 1.5);
    });
});
