import { memo, ReactiveNode, Retree, select } from "../packages/retree-core/src/index.js";
import { getReproxyNode } from "../packages/retree-core/src/internals/index.js";
import { summarizeDurations } from "../packages/retree-benchmark-cli/src/stats.js";

/**
 * What a ReactiveNode compiler could change, measured against an idealized
 * hand-written "compiled" shape: prototype accessors over a slot record,
 * static dependency lists, and a shared forwarding view class for identity.
 * The compiled side is an upper bound: it keeps tracking hooks, versions,
 * listeners, change records, and per-change identity, but not undo history
 * or transaction batching. Every loop cycles over many instances so V8
 * cannot keep one object's fields in registers, and every measurement gets
 * its own instances: an object used as a prototype receives a unique map in
 * V8, so `Object.create(node)` views poison every read site that sees the
 * node (measured below).
 * Run with `node --expose-gc scripts/run-sdk-scaling.mjs benchmarks/compiled-node-shapes.mts`.
 */

const rounds = 9;
const INSTANCES = 1024;
const MASK = INSTANCES - 1;
function report(name: string, samples: number[], ops: number) {
    const s = summarizeDurations(samples);
    console.log(`${name.padEnd(66)} median ${s.medianMs.toFixed(2).padStart(8)} ms  ${((s.medianMs * 1e6) / ops).toFixed(1).padStart(7)} ns/op`);
}
function measure(name: string, ops: number, run: () => unknown) {
    for (let warmup = 0; warmup < 3; warmup++) run();
    const samples: number[] = [];
    for (let round = 0; round < rounds; round++) {
        global.gc?.();
        const start = performance.now();
        run();
        samples.push(performance.now() - start);
    }
    report(name, samples, ops);
}
function fill<T>(make: () => T): T[] {
    const out: T[] = [];
    for (let k = 0; k < INSTANCES; k++) out.push(make());
    return out;
}

// ---------------------------------------------------------------- compiled model
type Listener = (view: object, changes: ChangeRecord[]) => void;
interface ChangeRecord { key: string; previous: unknown; next: unknown; }
let trackingFrame: Set<string> | null = null;
interface Slots {
    a: number; b: number; c: number; d: number; e: number;
    f: number; g: number; h: number; i: number; j: number;
}
type ViewFactory = (node: CompiledVM) => object;
class CompiledVM {
    protected readonly s: Slots = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 };
    public version = 0;
    public listeners: Listener[] | null = null;
    public makeView: ViewFactory = (node) => new CompiledVMView(node);
    private sumVersion = -1;
    private sumValue = 0;
    private notify(key: string, previous: unknown, next: unknown) {
        this.version++;
        const listeners = this.listeners;
        if (listeners === null) return;
        const view = this.makeView(this);
        const changes: ChangeRecord[] = [{ key, previous, next }];
        for (let k = 0; k < listeners.length; k++) listeners[k]!(view, changes);
    }
    get a() { if (trackingFrame !== null) trackingFrame.add("a"); return this.s.a; }
    get b() { if (trackingFrame !== null) trackingFrame.add("b"); return this.s.b; }
    get c() { if (trackingFrame !== null) trackingFrame.add("c"); return this.s.c; }
    get d() { if (trackingFrame !== null) trackingFrame.add("d"); return this.s.d; }
    get e() { if (trackingFrame !== null) trackingFrame.add("e"); return this.s.e; }
    get f() { if (trackingFrame !== null) trackingFrame.add("f"); return this.s.f; }
    get g() { if (trackingFrame !== null) trackingFrame.add("g"); return this.s.g; }
    get h() { if (trackingFrame !== null) trackingFrame.add("h"); return this.s.h; }
    get i() { if (trackingFrame !== null) trackingFrame.add("i"); return this.s.i; }
    get j() { if (trackingFrame !== null) trackingFrame.add("j"); return this.s.j; }
    set a(v: number) { const previous = this.s.a; if (previous === v) return; this.s.a = v; this.notify("a", previous, v); }
    // Static dependency list [a..j] compiled to a version check.
    get sum() {
        if (this.sumVersion === this.version) return this.sumValue;
        const s = this.s;
        this.sumValue = s.a + s.b + s.c + s.d + s.e + s.f + s.g + s.h + s.i + s.j;
        this.sumVersion = this.version;
        return this.sumValue;
    }
}
// One view class per node class: every view shares a map, reads forward.
class CompiledVMView {
    constructor(public readonly node: CompiledVM) {}
    get a() { return this.node.a; }
    get b() { return this.node.b; }
    get c() { return this.node.c; }
    get d() { return this.node.d; }
    get e() { return this.node.e; }
    get f() { return this.node.f; }
    get g() { return this.node.g; }
    get h() { return this.node.h; }
    get i() { return this.node.i; }
    get j() { return this.node.j; }
    set a(v: number) { this.node.a = v; }
    get sum() { return this.node.sum; }
}
class CompiledRow {
    public parent: object | null = null;
    constructor(public id: string, public value: number, public seed: number) {}
}
class CompiledList {
    public rows: CompiledRow[] = [];
    public version = 0;
    push(row: CompiledRow) { row.parent = this; this.rows.push(row); this.version++; }
}

// ------------------------------------------------------------------ retree model
class FieldsVM extends ReactiveNode {
    public a = 1; public b = 2; public c = 3; public d = 4; public e = 5;
    public f = 6; public g = 7; public h = 8; public i = 9; public j = 10;
    get dependencies() { return []; }
}
class MemoVM extends FieldsVM {
    @memo((self: MemoVM) => [self.a, self.b, self.c, self.d, self.e, self.f, self.g, self.h, self.i, self.j])
    get sum() { return this.a + this.b + this.c + this.d + this.e + this.f + this.g + this.h + this.i + this.j; }
}
class SelectVM extends FieldsVM {
    @select
    get sum() { return this.a + this.b + this.c + this.d + this.e + this.f + this.g + this.h + this.i + this.j; }
}
class Row extends ReactiveNode {
    constructor(public id: string, public value: number, public seed: number) { super(); }
    get dependencies() { return []; }
}
class Holder extends ReactiveNode {
    public rows: Row[] = [];
    get dependencies() { return []; }
}

interface TenFields { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; i: number; j: number; }
const READ_ROUNDS = 180_000;
function sumTen(nodes: TenFields[]): number {
    let total = 0;
    for (let r = 0; r < READ_ROUNDS; r++) {
        const node = nodes[r & MASK]!;
        total += node.a + node.b + node.c + node.d + node.e + node.f + node.g + node.h + node.i + node.j;
    }
    return total;
}

console.log("\n# Reads: 1.8M untracked scalar field reads across 1,024 nodes");
{
    const ops = READ_ROUNDS * 10;
    measure("raw object", ops, (() => { const raw = fill(() => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 })); return () => sumTen(raw); })());
    measure("ReactiveNode via proxy (today)", ops, (() => { const nodes = fill(() => Retree.root(new FieldsVM())); return () => sumTen(nodes); })());
    measure("ReactiveNode via latest view (today)", ops, (() => { const nodes = fill(() => { const n = Retree.root(new FieldsVM()); Retree.on(n, "nodeChanged", () => {}); n.a = 2; return n; }); const views = nodes.map((n) => getReproxyNode(n)); return () => sumTen(views); })());
    measure("compiled accessors", ops, (() => { const nodes = fill(() => new CompiledVM()); return () => sumTen(nodes); })());
    measure("compiled accessors through a forwarding view", ops, (() => { const views = fill(() => new CompiledVMView(new CompiledVM())); return () => sumTen(views); })());
    measure("compiled accessors after Object.create(node) views exist", ops, (() => { const nodes = fill(() => new CompiledVM()); nodes.forEach((n) => Object.create(n)); return () => sumTen(nodes); })());
    measure("compiled accessors through Object.create(node) views", ops, (() => { const views = fill(() => Object.create(new CompiledVM()) as CompiledVM); return () => sumTen(views); })());
}

console.log("\n# Derived value after a write: 200k x (write one field, read the memoized sum)");
{
    const WRITES = 200_000;
    measure("@memo with 10-field key (today)", WRITES, (() => { const nodes = fill(() => Retree.root(new MemoVM())); return () => { let t = 0; for (let k = 0; k < WRITES; k++) { const n = nodes[k & MASK]!; n.a = k; t += n.sum; } return t; }; })());
    measure("@select auto-tracked, one listener (today)", WRITES, (() => { const nodes = fill(() => { const n = Retree.root(new SelectVM()); Retree.on(n, "nodeChanged", () => {}); return n; }); return () => { let t = 0; for (let k = 0; k < WRITES; k++) { const n = nodes[k & MASK]!; n.a = k; t += n.sum; } return t; }; })());
    measure("compiled static deps + version check", WRITES, (() => { const nodes = fill(() => new CompiledVM()); return () => { let t = 0; for (let k = 0; k < WRITES; k++) { const n = nodes[k & MASK]!; n.a = k; t += n.sum; } return t; }; })());
}

console.log("\n# Writes: 1M scalar writes spread over 1,024 nodes");
{
    const WRITES = 1_000_000;
    let seen = 0;
    measure("raw object", WRITES, (() => { const raw = fill(() => ({ a: 0 })); return () => { for (let k = 0; k < WRITES; k++) raw[k & MASK]!.a = k; }; })());
    measure("plain object node via proxy (today)", WRITES, (() => { const nodes = fill(() => Retree.root({ a: 0 })); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("ReactiveNode fields only, no listener (today)", WRITES, (() => { const nodes = fill(() => Retree.root(new FieldsVM())); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("ReactiveNode fields only, one nodeChanged listener (today)", WRITES, (() => { const nodes = fill(() => { const n = Retree.root(new FieldsVM()); Retree.on(n, "nodeChanged", () => { seen++; }); return n; }); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("ReactiveNode fields only, 1,000 writes per transaction (today)", WRITES, (() => { const nodes = fill(() => Retree.root(new FieldsVM())); return () => { for (let batch = 0; batch < WRITES / 1000; batch++) Retree.runTransaction(() => { for (let k = 0; k < 1000; k++) nodes[k & MASK]!.a = batch * 1000 + k; }); }; })());
    measure("ReactiveNode with @memo getter, no listener (today)", WRITES, (() => { const nodes = fill(() => Retree.root(new MemoVM())); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("ReactiveNode with @select getter, one listener (today)", WRITES, (() => { const nodes = fill(() => { const n = Retree.root(new SelectVM()); Retree.on(n, "nodeChanged", () => { seen++; }); return n; }); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("compiled setter, no listener", WRITES, (() => { const nodes = fill(() => new CompiledVM()); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("compiled setter, one listener + forwarding view + change record", WRITES, (() => { const nodes = fill(() => { const n = new CompiledVM(); n.listeners = [() => { seen++; }]; return n; }); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    measure("compiled setter, one listener + Object.create view + change record", WRITES, (() => { const nodes = fill(() => { const n = new CompiledVM(); n.listeners = [() => { seen++; }]; n.makeView = (node) => Object.create(node); return n; }); return () => { for (let k = 0; k < WRITES; k++) nodes[k & MASK]!.a = k; }; })());
    void seen;
}

console.log("\n# Materialization: 50 x (push 2,000 fresh rows into a managed list, read one field of each)");
{
    const LEAVES = 2_000;
    const COMMITS = 50;
    const ops = LEAVES * COMMITS;
    measure("ReactiveNode rows via Retree (today)", ops, () => {
        const root = Retree.root(new Holder());
        let total = 0;
        for (let commit = 0; commit < COMMITS; commit++) {
            Retree.runTransaction(() => {
                const rows = root.rows;
                for (let k = 0; k < LEAVES; k++) rows.push(new Row(`c${commit}-${k}`, k, commit + k));
            });
            const rows = root.rows;
            for (let k = 0; k < rows.length; k++) total += rows[k]!.value;
            Retree.runTransaction(() => { root.rows = []; });
        }
        return total;
    });
    measure("compiled rows: construct + parent link + list version", ops, () => {
        let list = new CompiledList();
        let total = 0;
        for (let commit = 0; commit < COMMITS; commit++) {
            for (let k = 0; k < LEAVES; k++) list.push(new CompiledRow(`c${commit}-${k}`, k, commit + k));
            const rows = list.rows;
            for (let k = 0; k < rows.length; k++) total += rows[k]!.value;
            list = new CompiledList();
        }
        return total;
    });
}

console.log("\n# Identity per change: 1M fresh identities spread over 1,024 nodes");
{
    const N = 1_000_000;
    const sink: object[] = new Array(INSTANCES).fill(null);
    measure("forwarding view (new CompiledVMView(node))", N, (() => { const nodes = fill(() => new CompiledVM()); return () => { for (let k = 0; k < N; k++) sink[k & MASK] = new CompiledVMView(nodes[k & MASK]!); return sink; }; })());
    measure("Object.create(node) view shell", N, (() => { const nodes = fill(() => new CompiledVM()); return () => { for (let k = 0; k < N; k++) sink[k & MASK] = Object.create(nodes[k & MASK]!); return sink; }; })());
    measure("10-field snapshot copy", N, () => { for (let k = 0; k < N; k++) sink[k & MASK] = { a: k, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 }; return sink; });
}
