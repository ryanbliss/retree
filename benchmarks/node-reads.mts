import { strict as assert } from "node:assert";
import { Retree, ReactiveNode } from "../packages/retree-core/src/index.js";
import { getReproxyNode } from "../packages/retree-core/src/internals/index.js";
import { summarizeDurations } from "../packages/retree-benchmark-cli/src/stats.js";

/**
 * Scalar field reads through the get traps next to the engine floor: the
 * same loop over the raw object, an empty Proxy, and a trivial get trap.
 * Run with `npm run benchmark:node-reads`.
 * See benchmarks/findings-sep-6-2026-node-reads.md for context.
 */

const rounds = 9;
const ROUNDS = 180_000; // 1.8M scalar reads per sample, the Sep 5 shape
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

interface TenFields {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
    g: number;
    h: number;
    i: number;
    j: number;
}
function sumTen(node: TenFields): number {
    let total = 0;
    for (let r = 0; r < ROUNDS; r++) {
        total +=
            node.a +
            node.b +
            node.c +
            node.d +
            node.e +
            node.f +
            node.g +
            node.h +
            node.i +
            node.j;
    }
    return total;
}
function trivialTrap<T extends object>(target: T): T {
    return new Proxy(target, {
        get(t, prop, receiver) {
            return Reflect.get(t, prop, receiver);
        },
    });
}

class Counter extends ReactiveNode implements TenFields {
    public a = 1;
    public b = 2;
    public c = 3;
    public d = 4;
    public e = 5;
    public f = 6;
    public g = 7;
    public h = 8;
    public i = 9;
    public j = 10;
    public child = { n: 1 };
    public bump(): void {
        this.a++;
    }
}

console.log(
    JSON.stringify({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        rounds,
        reads: ROUNDS * 10,
        mode: "production source bundle, GC outside timed samples",
    })
);

{
    const raw = new Counter();
    const base = Retree.root(raw);
    base.bump();
    const view = getReproxyNode(base);
    assert.notEqual(view, base);
    const expected = sumTen(raw);
    assert.equal(sumTen(base), expected);
    assert.equal(sumTen(view), expected);
    measure("ReactiveNode scalar reads via raw", () => sumTen(raw));
    measure("ReactiveNode scalar reads via empty Proxy", () =>
        sumTen(new Proxy(raw, {}))
    );
    measure("ReactiveNode scalar reads via trivial trap", () =>
        sumTen(trivialTrap(raw))
    );
    measure("ReactiveNode scalar reads via base", () => sumTen(base));
    measure("ReactiveNode scalar reads via view", () => sumTen(view));
}

{
    const raw: TenFields = {
        a: 1,
        b: 2,
        c: 3,
        d: 4,
        e: 5,
        f: 6,
        g: 7,
        h: 8,
        i: 9,
        j: 10,
    };
    const base = Retree.root({ node: raw }).node;
    base.a = 2;
    base.a = 1;
    const view = getReproxyNode(base);
    assert.notEqual(view, base);
    const expected = sumTen(raw);
    assert.equal(sumTen(base), expected);
    assert.equal(sumTen(view), expected);
    measure("plain scalar reads via raw", () => sumTen(raw));
    measure("plain scalar reads via trivial trap", () =>
        sumTen(trivialTrap(raw))
    );
    measure("plain scalar reads via base", () => sumTen(base));
    measure("plain scalar reads via view", () => sumTen(view));
}

{
    interface Row {
        id: number;
        done: boolean;
        value: { classId: string };
    }
    const raw: Row[] = [];
    for (let i = 0; i < ROWS; i++) {
        raw.push({
            id: i,
            done: i % 3 === 0,
            value: { classId: i % 2 === 0 ? "a" : "b" },
        });
    }
    const base = Retree.root({ rows: raw }).rows;
    const scan = (rows: Row[]) => {
        let total = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            total += row.id;
            if (row.done) total += 1;
        }
        return total;
    };
    const mapIds = (rows: Row[]) => rows.map((row) => row.id);
    scan(base); // materialize every row
    base.push({ id: -1, done: false, value: { classId: "x" } });
    base.pop();
    const view = getReproxyNode(base);
    assert.notEqual(view, base);
    assert.equal(scan(base), scan(raw));
    assert.equal(scan(view), scan(raw));
    measure("50k row scan via raw", () => scan(raw));
    measure("50k row scan via base", () => scan(base));
    measure("50k row scan via view", () => scan(view));
    measure("50k row map(row => row.id) via raw", () => mapIds(raw));
    measure("50k row map(row => row.id) via base", () => mapIds(base));
    measure("50k row map(row => row.id) via view", () => mapIds(view));
}
