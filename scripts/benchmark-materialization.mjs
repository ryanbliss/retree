import assert from "node:assert/strict";
import { Retree } from "../packages/retree-core/bin/index.js";

const count = 10000;
const budgetMs = 2;
const input = () => ({
    sections: Array.from({ length: 100 }, (_, section) => ({
        rows: Array.from({ length: count / 100 }, (_, row) => ({
            detail: { id: section * (count / 100) + row, label: `Row ${row}` },
        })),
    })),
});

function* build(source) {
    const result = [];
    for (const section of source.sections) {
        for (const row of section.rows) {
            result.push(row.detail);
            yield;
        }
    }
    return result;
}

const syncRoot = Retree.root(input());
const syncStart = performance.now();
const iterator = build(syncRoot);
let sync;
do {
    sync = iterator.next();
} while (!sync.done);
const syncMs = performance.now() - syncStart;

const rootStart = performance.now();
const root = Retree.root(input());
const rootMs = performance.now() - rootStart;
const sliceTimes = [];
let sliceStart;
const start = performance.now();
const result = await Retree.materializeAsync(root, build, {
    budgetMs,
    schedule: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = performance.now();
    },
    onProgress: () => sliceTimes.push(performance.now() - sliceStart),
});
const elapsedMs = performance.now() - start;
assert.deepEqual(result, sync.value);
assert.equal(result[5000], root.sections[50].rows[0].detail);

const controller = new AbortController();
let cancelledSteps = 0;
const cancelRoot = Retree.root(input());
const cancelStart = performance.now();
await assert.rejects(
    Retree.materializeAsync(cancelRoot, build, {
        budgetMs,
        signal: controller.signal,
        onProgress: (progress) => {
            cancelledSteps = progress.steps;
            controller.abort();
        },
    }),
    { name: "AbortError" }
);
const cancelMs = performance.now() - cancelStart;
assert.ok(cancelledSteps < count);
sliceTimes.sort((a, b) => a - b);
console.log(
    JSON.stringify(
        {
            node: process.version,
            rows: count,
            budgetMs,
            rootMs,
            syncMs,
            elapsedMs,
            slices: sliceTimes.length,
            p95SliceMs: sliceTimes[Math.floor(sliceTimes.length * 0.95)],
            maxSliceMs: sliceTimes.at(-1),
            cancelledSteps,
            cancelMs,
            identicalResults: true,
        },
        null,
        2
    )
);
