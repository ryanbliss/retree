import { strict as assert } from "node:assert";
import { ReactiveNode, Retree } from "../packages/retree-core/src/index.js";
import { getReproxyNode } from "../packages/retree-core/src/internals/index.js";

class Calls extends ReactiveNode {
    value = 1;
    valueOf() {
        return this;
    }
    callValueOf() {
        return this.valueOf();
    }
    read() {
        return this.value;
    }
    identity(_arg?: unknown) {
        return this;
    }
    callRead() {
        return this.read();
    }
    get getterRead() {
        return this.read();
    }
    callIdentity(effect: () => void) {
        return this.identity(effect());
    }
    add(value: number) {
        return this.value + value;
    }
    callAdd(effect: () => number) {
        return this.add(effect());
    }
    spread(values: number[]) {
        return this.add(...(values as [number]));
    }
    arrow() {
        return () => this.read();
    }
    ordinary() {
        return function (this: { read(): number }) {
            return this.read();
        };
    }
    async later(wait: Promise<number>) {
        return this.add(await wait);
    }
}
class Derived extends Calls {
    override read() {
        return this.value + 10;
    }
}
for (const managed of [false, true]) {
    const raw = new Calls();
    const base = managed ? Retree.root(raw) : raw;
    base.value = 2;
    const node = managed ? getReproxyNode(base) : base;
    assert.equal(node.callRead(), 2);
    assert.equal(node.callValueOf(), raw);
    assert.equal(node.getterRead, 2);
    assert.equal(node.arrow()(), 2);
    assert.equal(node.ordinary().call({ read: () => 42 }), 42);
    assert.equal(node.spread([3]), 5);
    const receiver = node.callIdentity(() => {
        base.value = 3;
    });
    assert.equal(receiver, node);
    const result = node.callAdd(() => {
        base.add = () => 99;
        return 4;
    });
    assert.equal(result, 7);
    assert.equal(
        node.callAdd(() => 0),
        99
    );
    base.add = Calls.prototype.add;
    const pending = node.later(Promise.resolve(5));
    base.add = () => 101;
    assert.equal(await pending, 8);
    if (managed) {
        const extracted = node.read;
        assert.equal(extracted(), 3);
        Retree.clearListeners(base);
    }
}
const child = Retree.root(new Derived());
assert.equal(child.callRead(), 11);
child.read = () => 17;
assert.equal(child.callRead(), 17);
Retree.clearListeners(child);
console.log(
    "Method call parity passed: raw/managed, views, overrides, selection order, async, spread, lexical this, extraction."
);
