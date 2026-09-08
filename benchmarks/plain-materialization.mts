import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { strict as assert } from "node:assert";
import { ReactiveNode, Retree } from "../packages/retree-core/src/index.js";
import {
    makeTree,
    scan,
} from "../packages/retree-core/src/test-fixtures/materialization.js";
const fullScan = (tree: ReturnType<typeof makeTree>) => {
    let sum = 0;
    for (const group of tree.groups)
        for (const item of group.items) {
            sum += item.id + item.score;
            for (const tag of item.tags) sum += tag.weight;
        }
    return sum;
};
interface Link {
    value: number;
    next: Link | null;
}
function chain(depth = 5000): Link {
    let node: Link = { value: 1, next: null };
    for (let i = 0; i < depth; i++) node = { value: 1, next: node };
    return node;
}
function scanChain(node: Link) {
    let sum = 0;
    for (let current: Link | null = node; current; current = current.next)
        sum += current.value;
    return sum;
}
const filter = process.env.RETREE_MATERIALIZATION_SCENARIO;
function run<T extends object>(
    name: string,
    make: () => T,
    visit: (root: T) => number
) {
    if (filter && !name.includes(filter)) return;
    const expected = visit(make());
    const samples = [];
    for (let i = 0; i < 7; i++) {
        const raw = make();
        global.gc?.();
        const start = performance.now();
        const root = Retree.root(raw);
        const rootMs = performance.now() - start;
        const first = performance.now();
        assert.equal(visit(root), expected);
        const materializeMs = performance.now() - first;
        const warm = performance.now();
        assert.equal(visit(root), expected);
        const warmMs = performance.now() - warm;
        samples.push({
            warmup: i < 2,
            rootMs,
            materializeMs,
            totalMs: rootMs + materializeMs,
            warmMs,
        });
        Retree.clearListeners(root);
    }
    console.log(JSON.stringify({ name, samples }));
}
run("existing first-touch scan 100x100", () => makeTree(100, 100), scan);
run("full materialization 100x100", () => makeTree(100, 100), fullScan);
run("5000-deep full traversal", chain, scanChain);

// Synchronous path from scripts/benchmark-materialization.mjs, 10,000 rows.
const rows = () => ({
    sections: Array.from({ length: 100 }, (_, section) => ({
        rows: Array.from({ length: 100 }, (_, row) => ({
            detail: { id: section * 100 + row, label: `Row ${row}` },
        })),
    })),
});
run("existing synchronous materialization 10k rows", rows, (root) => {
    const result = [];
    for (const section of root.sections)
        for (const row of section.rows) result.push(row.detail);
    return result.length;
});

for (const depth of [16, 64, 256, 1024]) {
    const count = Math.floor(16384 / (depth + 1));
    run(
        `plain forest depth ${depth}, ${count * (depth + 1)} nodes`,
        () => ({ roots: Array.from({ length: count }, () => chain(depth)) }),
        (root) => {
            let sum = 0;
            for (const node of root.roots) sum += scanChain(node);
            return sum;
        }
    );
}

class PreparedTree extends ReactiveNode {
    roots = Array.from({ length: 63 }, () => chain(256));
}
run(
    "explicit prepareTree, 16191 plain nodes",
    () => new PreparedTree(),
    (root) => {
        root.prepareTree();
        let sum = 0;
        for (const node of root.roots) sum += scanChain(node);
        return sum;
    }
);

// Steady state: a live tree stays mounted while fresh raw rows replace old
// ones, as server updates arrive. Rounds are timed individually; the garbage
// from replaced rows is collected on the engine's own schedule, never forced.
const churnName = "churn: 30 rounds of 1k fresh rows into a 40k-node live tree";
if (!filter || churnName.includes(filter)) {
    const liveSections = 200;
    const churnSections = 10;
    const rounds = 30;
    const makeRows = (section: number) =>
        Array.from({ length: 100 }, (_, row) => ({
            detail: { id: section * 100 + row, label: `Row ${row}` },
        }));
    const readRows = (rows: { detail: { id: number } }[]) => {
        let sum = 0;
        for (const row of rows) sum += row.detail.id;
        return sum;
    };
    const samples = [];
    for (let i = 0; i < 7; i++) {
        global.gc?.();
        const start = performance.now();
        const root = Retree.root({
            sections: Array.from({ length: liveSections }, (_, section) => ({
                rows: makeRows(section),
            })),
        });
        for (const section of root.sections) readRows(section.rows);
        const rootMs = performance.now() - start;
        let churnMs = 0;
        let worstRoundMs = 0;
        for (let round = 0; round < rounds; round++) {
            const first = (round * churnSections) % liveSections;
            const fresh = Array.from({ length: churnSections }, (_, k) =>
                makeRows(first + k)
            );
            const roundStart = performance.now();
            for (let k = 0; k < churnSections; k++) {
                const section = root.sections[first + k];
                section.rows = fresh[k];
                readRows(section.rows);
            }
            const roundMs = performance.now() - roundStart;
            churnMs += roundMs;
            worstRoundMs = Math.max(worstRoundMs, roundMs);
        }
        const warm = performance.now();
        let sum = 0;
        for (const section of root.sections) sum += readRows(section.rows);
        const warmMs = performance.now() - warm;
        assert.ok(sum > 0);
        samples.push({
            warmup: i < 2,
            rootMs,
            materializeMs: churnMs,
            totalMs: rootMs + churnMs,
            warmMs,
            worstRoundMs,
        });
        Retree.clearListeners(root);
    }
    console.log(JSON.stringify({ name: churnName, samples }));
}

const fixturePath = process.env.RETREE_PLAIN_FIXTURE;
if (fixturePath) {
    const bytes = readFileSync(fixturePath);
    const fixture: object = JSON.parse(
        (fixturePath.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString(
            "utf8"
        )
    );
    run(
        "Neowyn fixture exhaustive plain traversal",
        () => structuredClone(fixture),
        (root) => {
            const pending: object[] = [root];
            let checksum = 0;
            while (pending.length) {
                const node = pending.pop()!;
                for (const key of Object.keys(node)) {
                    checksum += key.length;
                    const value: unknown = Reflect.get(node, key);
                    if (value !== null && typeof value === "object")
                        pending.push(value);
                    else if (typeof value === "string")
                        checksum += value.length;
                }
            }
            return checksum;
        }
    );
}
