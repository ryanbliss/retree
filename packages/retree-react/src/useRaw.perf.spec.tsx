/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Wide-table render measurement for the raw-purity spec's performance gates
 * (specs/retree-raw.md §6): `useRaw` vs `useNode` for read-wide renders, and
 * `useRaw` mount with `toManaged` per row vs the `useNode` equivalent.
 * Run with `npm run benchmark:react` on an idle machine. Shared CI runner
 * timing is too variable for this ratio to gate correctness or publishing.
 * Paired scenarios share
 * warmup and sampling conditions, with a 1.5x relative performance limit.
 */
import { cleanup, render } from "@testing-library/react";
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

interface MountScenario {
    label: string;
    setup: () => () => void;
    verify?: () => void;
}

/** Balance scenario order and discard mounted trees between timed samples. */
function time(...scenarios: MountScenario[]): number[] {
    const RUNS = 5;
    const sample = (scenario: MountScenario) => {
        const mount = scenario.setup();
        try {
            const start = performance.now();
            mount();
            const elapsed = performance.now() - start;
            scenario.verify?.();
            return elapsed;
        } finally {
            cleanup();
        }
    };
    const best = scenarios.map(() => Infinity);
    for (let round = 0; round < 3 + RUNS; round++) {
        for (let offset = 0; offset < scenarios.length; offset++) {
            const index = (round + offset) % scenarios.length;
            const elapsed = sample(scenarios[index]);
            if (round >= 3) best[index] = Math.min(best[index], elapsed);
        }
    }
    for (let index = 0; index < scenarios.length; index++) {
        console.log(
            `${scenarios[index].label}: ${best[index].toFixed(
                1
            )} ms (best of ${RUNS})`
        );
    }
    return best;
}

describe("useRaw perf probe", () => {
    it("wide-table render: useRaw vs useNode", () => {
        const ROWS = 200;
        const CELLS = 40;

        const [nodeMs, rawMs] = time(
            {
                label: "useNode wide table (200x40 reads)",
                setup: () => {
                    const nodeRoot = Retree.root({
                        rows: makeRows(ROWS, CELLS),
                    });
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
                },
            },
            {
                label: "useRaw wide table (200x40 reads)",
                setup: () => {
                    const rawRoot = Retree.root({
                        rows: makeRows(ROWS, CELLS),
                    });
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
                },
            }
        );

        // Loose gate: raw reads must not be slower than trapped reads.
        expect(rawMs).toBeLessThanOrEqual(nodeMs * 1.5);
    });

    it("useRaw mount with keyed toManaged per row vs useNode list", () => {
        const ROWS = 2000;

        let resolvedCount = 0;
        const [nodeMs, rawMs] = time(
            {
                label: "useNode list mount (2000 rows)",
                setup: () => {
                    const nodeRoot = Retree.root({ rows: makeRows(ROWS, 1) });
                    function NodeList() {
                        const rows = useNode(nodeRoot.rows);
                        return <div>{rows.map((row) => row.id).join("")}</div>;
                    }
                    return () => {
                        render(<NodeList />);
                    };
                },
            },
            {
                label: "useRaw list mount + keyed toManaged all (2000 rows)",
                setup: () => {
                    const rawRoot = Retree.root({ rows: makeRows(ROWS, 1) });
                    function RawList() {
                        const [rows, toManaged] = useRaw(rawRoot.rows);
                        return (
                            <div>
                                {rows
                                    .map((row, index) => {
                                        const source = toManaged(row, {
                                            key: index,
                                        });
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
                },
                verify: () => expect(resolvedCount).toBe(ROWS),
            },
            {
                label: "useRaw value lookup including raw slot index (2000 rows)",
                setup: () => {
                    const root = Retree.root({ rows: makeRows(ROWS, 1) });
                    function ValueList() {
                        const [rows, toManaged] = useRaw(root.rows);
                        return (
                            <div>
                                {rows.map((row) => toManaged(row)!.id).join("")}
                            </div>
                        );
                    }
                    return () => {
                        render(<ValueList />);
                    };
                },
            }
        );

        // Gate the direct indexed form against managed indexing. The legacy
        // value lookup above also builds a raw slot index and is reported separately.
        expect(rawMs).toBeLessThanOrEqual(nodeMs * 1.5);
    });
});
