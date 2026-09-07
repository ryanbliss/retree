import { strict as assert } from "node:assert";
import { Retree } from "../packages/retree-core/src/index.js";
import { getReproxyNode } from "../packages/retree-core/src/internals/index.js";
import { summarizeDurations } from "../packages/retree-benchmark-cli/src/stats.js";

/**
 * Array read methods through the base proxy and a view next to the same
 * calls on the raw array. Run with `npm run benchmark:array-reads`.
 * See benchmarks/findings-sep-6-2026-array-reads.md for context.
 */

const rounds = 9;
const ROWS = 50_000;

function report(name: string, samples: number[]) {
    console.log(JSON.stringify({ name, ...summarizeDurations(samples) }));
}
function measure(name: string, run: () => unknown) {
    for (let warmup = 0; warmup < 3; warmup++) run();
    const samples: number[] = [];
    for (let round = 0; round < rounds; round++) {
        global.gc?.();
        const start = performance.now();
        run();
        samples.push(performance.now() - start);
    }
    report(name, samples);
}

interface Row {
    id: number;
    done: boolean;
    value: { classId: string };
}
const rawRows: Row[] = [];
const rawIds: number[] = [];
for (let i = 0; i < ROWS; i++) {
    rawRows.push({
        id: i,
        done: i % 3 === 0,
        value: { classId: i % 2 === 0 ? "a" : "b" },
    });
    rawIds.push(i);
}
const root = Retree.root({ rows: rawRows, ids: rawIds });
const baseRows = root.rows;
const baseIds = root.ids;
baseRows.forEach(() => undefined); // materialize every row
baseRows.push({ id: -1, done: false, value: { classId: "x" } });
baseRows.pop();
baseIds.push(-1);
baseIds.pop();
const viewRows = getReproxyNode(baseRows);
const viewIds = getReproxyNode(baseIds);
assert.notEqual(viewRows, baseRows);
assert.notEqual(viewIds, baseIds);
const LAST = ROWS - 1;

console.log(
    JSON.stringify({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        rounds,
        rows: ROWS,
        mode: "production source bundle, GC outside timed samples",
    })
);

const paths: [string, Row[], number[]][] = [
    ["raw", rawRows, rawIds],
    ["base", baseRows, baseIds],
    ["view", viewRows, viewIds],
];
for (const [path, rows, ids] of paths) {
    const lastRow = rows[LAST];
    assert.equal(ids.indexOf(LAST), LAST);
    assert.equal(ids.includes(LAST), true);
    assert.equal(rows.indexOf(lastRow), LAST);
    assert.equal(rows.slice().length, ROWS);
    assert.equal(rows.at(-1), lastRow);
    measure(`ids.indexOf(last) via ${path}`, () => ids.indexOf(LAST));
    measure(`ids.includes(last) via ${path}`, () => ids.includes(LAST));
    measure(`rows.indexOf(lastRow) via ${path}`, () => rows.indexOf(lastRow));
    measure(`rows.slice() via ${path}`, () => rows.slice());
    measure(`rows.at(i) x50k via ${path}`, () => {
        let found = 0;
        for (let i = 0; i < ROWS; i++) {
            if (rows.at(i) !== undefined) found++;
        }
        return found;
    });
    measure(`rows.flatMap(row => [row.id, row.done]) via ${path}`, () =>
        rows.flatMap((row) => [row.id, row.done])
    );
    measure(`for..of rows.entries() via ${path}`, () => {
        let total = 0;
        for (const [index, row] of rows.entries()) {
            total += index + row.id;
        }
        return total;
    });
    measure(`for..of rows.keys() via ${path}`, () => {
        let total = 0;
        for (const index of rows.keys()) {
            total += index;
        }
        return total;
    });
}
