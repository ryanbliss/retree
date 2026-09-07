import { unproxiedBaseNodeKey } from "../packages/retree-core/src/internals/proxy-types.js";
import { strict as assert } from "node:assert";
import { Retree, ReactiveNode } from "../packages/retree-core/src/index.js";
import { getBaseHandlerOfProxy, getReproxyNode } from "../packages/retree-core/src/internals/index.js";
import { summarizeDurations } from "../packages/retree-benchmark-cli/src/stats.js";

const operations = 200_000;
class Model extends ReactiveNode {
    values = new Map([["value", 1]]);
    objects = new Map([["value", { count: 1 }]]);
}
function measure(name: string, count: number, run: () => number, expected: number) {
    for (let i = 0; i < 3; i++) assert.equal(run(), expected);
    const samples: number[] = [];
    for (let i = 0; i < 9; i++) {
        global.gc?.();
        const start = performance.now();
        const result = run();
        samples.push(performance.now() - start);
        assert.equal(result, expected);
    }
    const stats = summarizeDurations(samples);
    console.log(JSON.stringify({ name, operations: count, nsPerOperation: stats.medianMs * 1e6 / count, ...stats }));
}
const raw = new Model();
const base = Retree.root(raw);
base.values.set("seed", 0);
base.objects.set("seed", { count: 0 });
const view = getReproxyNode(base);
assert.notEqual(view, base);
assert.notEqual(view.values, base.values);
assert.notEqual(view.objects, base.objects);
for (const [path, model] of [["raw", raw], ["base", base], ["view", view]] as const) {
    const map = model.values;
    const objects = model.objects;
    measure(`Map.get primitive via ${path}`, operations, () => {
        let sum = 0;
        for (let i = 0; i < operations; i++) sum += map.get("value")!;
        return sum;
    }, operations);
    measure(`Map.has via ${path}`, operations, () => {
        let sum = 0;
        for (let i = 0; i < operations; i++) sum += Number(map.has("value"));
        return sum;
    }, operations);
    measure(`Map.get object + field via ${path}`, operations, () => {
        let sum = 0;
        for (let i = 0; i < operations; i++) sum += objects.get("value")!.count;
        return sum;
    }, operations);
    measure(`parent + Map.get via ${path}`, operations, () => {
        let sum = 0;
        for (let i = 0; i < operations; i++) sum += model.values.get("value")!;
        return sum;
    }, operations);
    if (path !== "raw") {
        function helperGet(receiver: Map<string, number>) {
            const handler = getBaseHandlerOfProxy(receiver);
            return handler.get(handler[unproxiedBaseNodeKey], "get", handler.baseProxy) as Map<string, number>["get"];
        }
        measure(`prototype helper Map.get via ${path}`, operations, () => {
            let sum = 0;
            for (let i = 0; i < operations; i++) sum += helperGet(map)("value")!;
            return sum;
        }, operations);
    }
    const set = map.set;
    measure(`Map.set property lookup via ${path}`, operations, () => {
        let sum = 0;
        for (let i = 0; i < operations; i++) sum += Number(map.set === set);
        return sum;
    }, map.set === set ? operations : 0);
    measure(`Map.set changed scalar via ${path}`, 2000, () => {
        for (let i = 0; i < 2000; i++) map.set("write", i);
        return map.get("write")!;
    }, 1999);
}
Retree.clearListeners(base);
