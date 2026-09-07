import { strict as assert } from "node:assert";
import { Retree } from "../packages/retree-core/src/index.js";
import { installPlainFacades } from "./test-fixtures/plain-object-facade.mjs";
if (process.env.RETREE_PLAIN_FACADES === "1") installPlainFacades();
function create(count: number) {
    const root = Retree.root({ rows: Array.from({ length: count }, (_, id) => ({ detail: { id, label: `Row ${id}` } })) });
    let sum = 0;
    for (const row of root.rows) sum += row.detail.id;
    assert.equal(sum, count * (count - 1) / 2);
    return root;
}
Retree.clearListeners(create(1000));
global.gc?.();
global.gc?.();
const before = process.memoryUsage().heapUsed;
const root = create(10000);
global.gc?.();
global.gc?.();
console.log(JSON.stringify({ rows: 10000, retainedBytes: process.memoryUsage().heapUsed - before }));
Retree.clearListeners(root);
