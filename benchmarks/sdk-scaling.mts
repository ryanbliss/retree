import { strict as assert } from "node:assert";
import { Retree, ReactiveNode } from "../packages/retree-core/src/index.js";
import { createDirectChildResolver } from "../packages/retree-core/src/internals/proxy.js";
import { runTrappedMemo } from "../packages/retree-core/src/internals/memo.js";
import { collectDependencyComparisonAccesses } from "../packages/retree-core/src/internals/dependency-tracking.js";
import { reconcileArray } from "../packages/retree-query/src/internals/reconcile.js";
import { connectReduxDevTools } from "../packages/retree-devtools/src/connectReduxDevTools.js";
import type { IReduxDevToolsExtension } from "../packages/retree-devtools/src/internals/redux-devtools-extension.js";
import { summarizeDurations } from "../packages/retree-benchmark-cli/src/stats.js";

const rounds = 7;
let sink: unknown;
type Counts = Record<string, number>;
function report(name: string, samples: number[], counts?: Counts) {
    console.log(
        JSON.stringify({ name, ...summarizeDurations(samples), counts })
    );
}
async function measure(
    name: string,
    run: () => void,
    iterations = 1,
    counts?: () => Counts
) {
    for (let warmup = 0; warmup < 3; warmup++) run();
    const samples: number[] = [];
    for (let round = 0; round < rounds; round++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        global.gc?.();
        const start = performance.now();
        for (let index = 0; index < iterations; index++) run();
        samples.push((performance.now() - start) / iterations);
    }
    report(name, samples, counts?.());
}
async function cold<T>(
    name: string,
    prepare: () => T,
    run: (input: T) => void
) {
    const samples: number[] = [];
    for (let round = 0; round < rounds; round++) {
        const input = prepare();
        await new Promise<void>((resolve) => setImmediate(resolve));
        global.gc?.();
        const start = performance.now();
        run(input);
        samples.push(performance.now() - start);
    }
    report(name, samples);
}

console.log(
    JSON.stringify({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        rounds,
        mode: "production source bundle, GC outside timed samples",
    })
);
type Chain = { value: number; child?: Chain };
function chain(depth: number, value = 0): Chain {
    let result: Chain = { value };
    for (let level = 0; level < depth; level++)
        result = { value: 0, child: result };
    return result;
}
function leaf(node: Chain): Chain {
    while (node.child) node = node.child;
    return node;
}

for (const depth of [10, 100, 1000]) {
    const root = Retree.root(chain(depth));
    const last = leaf(root);
    const other = Retree.root({ value: 0 });
    const write = () => {
        for (let index = 0; index < 1000; index++) last.value++;
    };
    await measure(`1000 held-leaf writes, depth ${depth}, unobserved`, write);
    for (const listener of ["nodeChanged", "treeChanged"] as const) {
        const stop = Retree.on(other, listener, () => {});
        await measure(
            `1000 held-leaf writes, depth ${depth}, unrelated ${listener}`,
            write
        );
        stop();
    }
    let emissions = 0;
    let records = 0;
    const stop = Retree.on(root, "treeChanged", (_node, changes) => {
        emissions++;
        records += changes.length;
    });
    await measure(
        `1000 held-leaf writes, depth ${depth}, root observer, transaction`,
        () => {
            emissions = 0;
            records = 0;
            Retree.runTransaction(write);
            assert.equal(emissions, 1);
            assert.equal(records, 1000);
        },
        1,
        () => ({ emissions, records })
    );
    stop();
}

function rows(length: number) {
    return Array.from({ length }, (_, id) => ({
        id,
        score: id % 100,
        detail: { value: id },
        tags: [{ weight: id % 5 }, { weight: id % 7 }],
    }));
}
function sum(items: ReturnType<typeof rows>) {
    let result = 0;
    for (const item of items)
        result += item.score + item.detail.value + item.tags[0].weight;
    return result;
}
class MemoOwner extends ReactiveNode {
    get dependencies() {
        return [];
    }
}
for (const size of [1000, 10000]) {
    await cold(
        `cold ingress, ${size} nested rows`,
        () => rows(size),
        (input) => {
            sink = Retree.root(input);
        }
    );
    await cold(
        `cold managed scan, ${size} nested rows, ingress excluded`,
        () => Retree.root(rows(size)),
        (input) => {
            sink = sum(input);
        }
    );
    const raw = rows(size);
    const managed = Retree.root(raw);
    const expected = sum(raw);
    assert.equal(sum(managed), expected);
    await measure(
        `raw scan, ${size} nested rows`,
        () => {
            sink = sum(raw);
        },
        100
    );
    await measure(
        `warm proxy scan, ${size} nested rows`,
        () => {
            sink = sum(managed);
        },
        10
    );
    await measure(
        `tracked scan, ${size} nested rows`,
        () => {
            sink = collectDependencyComparisonAccesses(() =>
                sum(managed)
            ).value;
        },
        3
    );
    const owner = Retree.root(new MemoOwner());
    let computations = 0;
    const memo = () =>
        runTrappedMemo(owner, "sum", () => {
            computations++;
            return sum(managed);
        });
    assert.equal(memo(), expected);
    await measure(
        `unchanged automatic memo, ${size} nested rows`,
        () => {
            sink = memo();
        },
        1000,
        () => ({ computations })
    );
    assert.equal(computations, 1);
    const unrelated = Retree.root({ value: 0 });
    await measure(
        `unrelated write then automatic memo, ${size} nested rows`,
        () => {
            unrelated.value++;
            sink = memo();
        },
        100,
        () => ({ computations })
    );
    assert.equal(computations, 1);
}

for (const size of [10000, 100000]) {
    await cold(
        `one keyed raw child, ${size} rows, ingress excluded`,
        () => Retree.root(Array.from({ length: size }, (_, id) => ({ id }))),
        (managed) => {
            sink = createDirectChildResolver(managed)(size - 1);
        }
    );
    const raw = Array.from({ length: size }, (_, id) => ({ id }));
    const managed = Retree.root(raw);
    createDirectChildResolver(managed)(size - 1);
    const materialized = raw.reduce(
        (count, row) => count + Number(Retree.managed(row) !== undefined),
        0
    );
    assert.equal(materialized, 1);
    console.log(
        JSON.stringify({
            name: `selective raw resolution, ${size} rows`,
            counts: { materialized },
        })
    );
}

for (const depth of [100, 400, 800]) {
    const current = Retree.root([{ id: "row", child: chain(depth) }]);
    let value = 0;
    await measure(
        `query leaf reconciliation, depth ${depth}`,
        () => {
            value++;
            reconcileArray(
                current,
                [{ id: "row", child: chain(depth, value) }],
                (row) => row.id
            );
        },
        3
    );
}
let visited = 0;
let incoming: Chain = { value: 1 };
for (let depth = 0; depth < 1000; depth++) {
    const child = incoming;
    incoming = {
        value: 0,
        get child() {
            visited++;
            return child;
        },
    };
}
const current = Retree.root([{ id: "row", child: chain(1000) }]);
reconcileArray(current, [{ id: "row", child: incoming }], (row) => row.id);
assert.equal(visited, 1000);
console.log(
    JSON.stringify({
        name: "query incoming child visits, depth 1000",
        counts: { visited },
    })
);

class DependencyOwner extends ReactiveNode {
    tick = 0;
    items = Array.from({ length: 5000 }, (_, value) => ({ value }));
    get dependencies() {
        return this.items.map((item) => this.dependency(item, [item.value]));
    }
}
const dependent = Retree.root(new DependencyOwner());
const stopDependent = Retree.on(dependent, "nodeChanged", () => {});
await measure(
    "5000 stable dependency edges, owner refresh",
    () => {
        dependent.tick++;
    },
    10
);
stopDependent();

// Count Retree's cloning work separately from browser extension serialization.
let actions = 0;
let clones = 0;
const extension: IReduxDevToolsExtension = {
    connect: () => ({
        init: (state) => {
            sink = state;
        },
        send: (_action, state) => {
            actions++;
            sink = state;
        },
    }),
};
const previousExtension = Reflect.get(
    globalThis,
    "__REDUX_DEVTOOLS_EXTENSION__"
);
const nativeClone = globalThis.structuredClone;
const countedClone: typeof structuredClone = (value, options) => {
    clones++;
    return nativeClone(value, options);
};
Reflect.set(globalThis, "__REDUX_DEVTOOLS_EXTENSION__", extension);
globalThis.structuredClone = countedClone;
try {
    const roots = Object.fromEntries(
        Array.from({ length: 4 }, (_, index) => [
            `scaling-${index}`,
            Retree.root({
                rows: Array.from({ length: 5000 }, (_, value) => ({ value })),
            }),
        ])
    );
    const changed = roots["scaling-0"].rows[0];
    for (const scenario of [
        {
            name: "all four roots",
            roots,
            stateSnapshots: true,
            transaction: false,
            expectedClones: 40,
            expectedActions: 10,
        },
        {
            name: "one selected root",
            roots: { "scaling-0": roots["scaling-0"] },
            stateSnapshots: true,
            transaction: false,
            expectedClones: 10,
            expectedActions: 10,
        },
        {
            name: "all roots, transaction",
            roots,
            stateSnapshots: true,
            transaction: true,
            expectedClones: 4,
            expectedActions: 1,
        },
        {
            name: "actions only",
            roots,
            stateSnapshots: false,
            transaction: false,
            expectedClones: 0,
            expectedActions: 10,
        },
    ]) {
        const connection = connectReduxDevTools(scenario);
        await measure(
            `devtools, 10 writes, ${scenario.name}`,
            () => {
                actions = 0;
                clones = 0;
                const write = () => {
                    for (let index = 0; index < 10; index++) changed.value++;
                };
                if (scenario.transaction) Retree.runTransaction(write);
                else write();
                assert.equal(actions, scenario.expectedActions);
                assert.equal(clones, scenario.expectedClones);
            },
            1,
            () => ({ actions, clones })
        );
        connection.dispose();
    }
} finally {
    globalThis.structuredClone = nativeClone;
    if (previousExtension === undefined)
        Reflect.deleteProperty(globalThis, "__REDUX_DEVTOOLS_EXTENSION__");
    else
        Reflect.set(
            globalThis,
            "__REDUX_DEVTOOLS_EXTENSION__",
            previousExtension
        );
}
assert.notEqual(sink, undefined);
