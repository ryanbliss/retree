// Cost split for reading a real project document through Retree: JSON parse,
// raw walk, first walk (materialization), warm untracked and tracked reads,
// enumeration and stringify through proxies versus through Retree.raw.
// Run with `RETREE_PLAIN_FIXTURE=<path to .json or .json.gz>`.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Retree } from "../packages/retree-core/src/index.js";
import { collectDependencyAccesses } from "../packages/retree-core/src/internals/index.js";

const fixturePath = process.env.RETREE_PLAIN_FIXTURE;
if (fixturePath === undefined) {
    throw new Error(
        "benchmarks/corpus-cost.mts: set RETREE_PLAIN_FIXTURE to a JSON document (optionally gzipped)."
    );
}
const bytes = readFileSync(fixturePath);
const text = (
    fixturePath.endsWith(".gz") ? gunzipSync(bytes) : bytes
).toString("utf8");

/** Reads every value through `root`; keys come from the raw node so only the reads go through traps. */
function walkReads(root: object): number {
    const pending: object[] = [root];
    let checksum = 0;
    while (pending.length) {
        const node = pending.pop()!;
        const keys = Object.keys(Retree.isNode(node) ? Retree.raw(node) : node);
        for (const key of keys) {
            const value: unknown = Reflect.get(node, key);
            if (value !== null && typeof value === "object") pending.push(value);
            else if (typeof value === "string") checksum += value.length;
            else if (typeof value === "number") checksum += value;
        }
    }
    return checksum;
}

/** Enumerates every node through `root` itself, the way `Object.keys` on a managed node does. */
function walkKeys(root: object): number {
    const pending: object[] = [root];
    let checksum = 0;
    while (pending.length) {
        const node = pending.pop()!;
        for (const key of Object.keys(node)) {
            checksum += key.length;
            const value: unknown = Reflect.get(node, key);
            if (value !== null && typeof value === "object") pending.push(value);
        }
    }
    return checksum;
}

function timeIt(fn: () => unknown): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
}

const rounds = 7;
const warmup = 2;
const samples = new Map<string, number[]>();
function record(name: string, ms: number): void {
    let list = samples.get(name);
    if (list === undefined) {
        list = [];
        samples.set(name, list);
    }
    list.push(ms);
}

for (let round = 0; round < rounds; round++) {
    const raw = JSON.parse(text) as object;
    global.gc?.();
    record("JSON.parse", timeIt(() => JSON.parse(text)));
    record("raw: walk reads", timeIt(() => walkReads(raw)));
    record("raw: walk keys", timeIt(() => walkKeys(raw)));
    record("raw: JSON.stringify", timeIt(() => JSON.stringify(raw)));
    const root = Retree.root(raw);
    record("retree: first walk reads (materialize)", timeIt(() => walkReads(root)));
    record("retree: warm walk reads, untracked", timeIt(() => walkReads(root)));
    record(
        "retree: warm walk reads, tracked frame",
        timeIt(() => collectDependencyAccesses(() => walkReads(root)))
    );
    record("retree: walk keys through proxies, untracked", timeIt(() => walkKeys(root)));
    record(
        "retree: walk keys through proxies, tracked frame",
        timeIt(() => collectDependencyAccesses(() => walkKeys(root)))
    );
    record("retree: JSON.stringify through proxies", timeIt(() => JSON.stringify(root)));
    record("retree: JSON.stringify(Retree.raw(root))", timeIt(() => JSON.stringify(Retree.raw(root))));
}

const results: Record<string, { medianMs: number; minMs: number }> = {};
for (const [name, list] of samples) {
    const sorted = list.slice(warmup).sort((a, b) => a - b);
    results[name] = {
        medianMs: sorted[Math.floor(sorted.length / 2)],
        minMs: sorted[0],
    };
    console.log(
        name.padEnd(52),
        results[name].medianMs.toFixed(2).padStart(8),
        "ms  (min",
        results[name].minMs.toFixed(2) + ")"
    );
}
console.log(JSON.stringify({ fixture: fixturePath, rounds, warmup, results }));
