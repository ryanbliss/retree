import { strict as assert } from "node:assert";
import { ReactiveNode, Retree } from "../packages/retree-core/src/index.js";

class Model extends ReactiveNode {
    value = 1;
    read() {
        return this.value;
    }
    get immediate() {
        return this.read();
    }
}
function create(count: number) {
    const nodes = Array.from({ length: count }, () => Retree.root(new Model()));
    let sum = 0;
    for (const node of nodes) sum += node.immediate;
    assert.equal(sum, count);
    return nodes;
}
for (const node of create(1000)) Retree.clearListeners(node);
global.gc?.();
global.gc?.();
const before = process.memoryUsage().heapUsed;
const held = create(10_000);
global.gc?.();
global.gc?.();
console.log(
    JSON.stringify({
        nodes: held.length,
        retainedBytes: process.memoryUsage().heapUsed - before,
    })
);
for (const node of held) Retree.clearListeners(node);
