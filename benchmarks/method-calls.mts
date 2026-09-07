import { strict as assert } from "node:assert";
import { ReactiveNode, Retree } from "../packages/retree-core/src/index.js";
import { getReproxyNode } from "../packages/retree-core/src/internals/index.js";

class Model extends ReactiveNode {
    value = 1;
    read() {
        return this.value;
    }
    get immediate() {
        return this.read();
    }
    callWith(value: number) {
        return this.add(value);
    }
    add(value: number) {
        return this.value + value;
    }
    twice() {
        return this.read() + this.read();
    }
}
const raw = new Model();
const base = Retree.root(raw);
base.value = 2;
const view = getReproxyNode(base);
assert.notEqual(base, view);
const count = 200_000;
for (const [path, node] of [
    ["raw", raw],
    ["base", base],
    ["view", view],
] as const) {
    for (const [name, run, expected] of [
        ["immediate getter", () => node.immediate, 2],
        ["argument", () => node.callWith(3), 5],
        ["two internal calls", () => node.twice(), 4],
        [
            "extracted control",
            (() => {
                const read = node.read.bind(node);
                return () => read();
            })(),
            2,
        ],
    ] as const) {
        const batch = () => {
            let sum = 0;
            for (let i = 0; i < count; i++) sum += run();
            return sum;
        };
        for (let i = 0; i < 5; i++) assert.equal(batch(), count * expected);
        const samples = [];
        for (let i = 0; i < 9; i++) {
            global.gc?.();
            const start = performance.now();
            const sum = batch();
            samples.push(((performance.now() - start) * 1e6) / count);
            assert.equal(sum, count * expected);
        }
        console.log(
            JSON.stringify({
                name: `${name}:${path}`,
                ns: [...samples].sort((a, b) => a - b)[4],
                samples,
            })
        );
    }
}
Retree.clearListeners(base);
