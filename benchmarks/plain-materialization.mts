import { strict as assert } from "node:assert";
import { Retree } from "../packages/retree-core/src/index.js";
import { makeTree, scan } from "../packages/retree-core/src/test-fixtures/materialization.js";
import { installPlainFacades, facadeCount } from "./test-fixtures/plain-object-facade.mjs";
if (process.env.RETREE_PLAIN_FACADES === "1") installPlainFacades();
const fullScan = (tree: ReturnType<typeof makeTree>) => {
    let sum = 0;
    for (const group of tree.groups) for (const item of group.items) {
        sum += item.id + item.score;
        for (const tag of item.tags) sum += tag.weight;
    }
    return sum;
};
interface Link { value: number; next: Link | null; }
function chain(): Link {
    let node: Link = { value: 1, next: null };
    for (let i = 0; i < 5000; i++) node = { value: 1, next: node };
    return node;
}
function scanChain(node: Link) {
    let sum = 0;
    for (let current: Link | null = node; current; current = current.next) sum += current.value;
    return sum;
}
function run<T extends object>(name: string, make: () => T, visit: (root: T) => number) {
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
        samples.push({ warmup: i < 2, rootMs, materializeMs, totalMs: rootMs + materializeMs, warmMs });
        Retree.clearListeners(root);
    }
    console.log(JSON.stringify({ name, samples, facades: facadeCount() }));
}
run("existing first-touch scan 100x100", () => makeTree(100, 100), scan);
run("full materialization 100x100", () => makeTree(100, 100), fullScan);
run("5000-deep full traversal", chain, scanChain);

// Synchronous path from scripts/benchmark-materialization.mjs, 10,000 rows.
const rows = () => ({ sections: Array.from({ length: 100 }, (_, section) => ({
    rows: Array.from({ length: 100 }, (_, row) => ({
        detail: { id: section * 100 + row, label: `Row ${row}` },
    })),
})) });
run("existing synchronous materialization 10k rows", rows, (root) => {
    const result = [];
    for (const section of root.sections) for (const row of section.rows) result.push(row.detail);
    return result.length;
});
