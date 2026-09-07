import { strict as assert } from "node:assert";
import { Retree } from "../packages/retree-core/src/index.js";
import { getReproxyNode } from "../packages/retree-core/src/internals/index.js";
import { installPlainFacades, facadeCount } from "./test-fixtures/plain-object-facade.mjs";
const enabled = process.env.RETREE_PLAIN_FACADES === "1";
if (enabled) installPlainFacades();
const raw = { child: { value: 1 }, optional: 1 };
const root = Retree.root(raw);
assert.equal(Retree.raw(root), raw);
assert.equal(Retree.raw(root.child), raw.child);
assert.equal(root.child, root.child);
assert.equal(Retree.parent(root.child), root);
assert.deepEqual(Object.keys(root), ["child", "optional"]);
assert.equal(JSON.stringify(root), JSON.stringify(raw));
const view = getReproxyNode(root);
assert.equal(view.child.value, 1);
root.child.value = 2;
assert.equal(raw.child.value, 2);
assert.equal(getReproxyNode(root).child.value, 2);
root.child = { value: 3 };
assert.equal(root.child.value, 3);
assert.equal(Retree.raw(root.child), raw.child);
// Expose the incompatibility explicitly; passing this probe does not imply
// that the experimental facade supports arbitrary plain-object semantics.
Reflect.set(root, "added", 4);
assert.equal(Reflect.get(raw, "added"), enabled ? undefined : 4);
Reflect.deleteProperty(root, "optional");
assert.equal(Object.hasOwn(raw, "optional"), enabled);
const symbol = Symbol("data");
const fallback = Retree.root({ [symbol]: 1 });
fallback[symbol] = 2;
assert.equal(Retree.raw(fallback)[symbol], 2);
Retree.clearListeners(root);
Retree.clearListeners(fallback);
console.log(JSON.stringify({ fixedShapeParity: true, dynamicShapeSupported: !enabled, facades: facadeCount() }));

// Exercise the query adapter's real managed write path as well.
const { tryReconcileDocumentsById } = await import("../packages/retree-query/src/internals/reconcile.js");
const documents = Retree.root([{ _id: "row", value: 1, removed: true }]);
assert.equal(tryReconcileDocumentsById(documents, [{ _id: "row", value: 2, added: 3 }]), true);
assert.equal(Retree.raw(documents)[0].value, 2);
assert.equal(Reflect.get(Retree.raw(documents)[0], "added"), enabled ? undefined : 3);
assert.equal(Object.hasOwn(Retree.raw(documents)[0], "removed"), enabled);
Retree.clearListeners(documents);
console.log(JSON.stringify({ queryExistingFieldWrite: true, queryShapeChangeSupported: !enabled }));
