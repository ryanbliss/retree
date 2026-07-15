/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode } from "./ReactiveNode.js";
import { memo, select } from "./decorators.js";
import { Transactions } from "./internals/transactions.js";
import { getBaseProxy, getCustomProxyHandler } from "./internals/proxy.js";
import { getReproxyNode } from "./internals/reproxy.js";

const rootsToCleanup: object[] = [];
const unsubscribes: (() => void)[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

function trackUnsubscribe(unsubscribe: () => void): () => void {
    unsubscribes.push(unsubscribe);
    return unsubscribe;
}

afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) {
        unsubscribe();
    }
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    if (getCustomProxyHandler(node)) {
        Retree.clearListeners(node as never);
    }
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

describe("keys dependencies (in / Object.keys / iteration shape)", () => {
    describe("tracked selectors with Object.keys", () => {
        it("re-runs when a key is added or deleted on a record node", () => {
            const root = trackRoot(
                Retree.root({
                    record: {} as Record<string, { v: number }>,
                })
            );
            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(() => Object.keys(root.record).length, callback)
            );

            root.record.a = { v: 1 };
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith(1, 0);

            root.record.b = { v: 2 };
            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenLastCalledWith(2, 1);

            delete root.record.a;
            expect(callback).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenLastCalledWith(1, 2);
        });

        it("does not re-run a keys-only selector for value writes to existing keys", () => {
            const root = trackRoot(
                Retree.root({
                    record: { a: 1, b: 2 } as Record<string, number>,
                })
            );
            let selectorRuns = 0;
            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(() => {
                    selectorRuns++;
                    return Object.keys(root.record).length;
                }, callback)
            );
            expect(selectorRuns).toBe(1);

            root.record.a = 5;
            root.record.b = 6;

            expect(selectorRuns).toBe(1);
            expect(callback).not.toHaveBeenCalled();

            // Sanity: shape changes still get through.
            root.record.c = 7;
            expect(selectorRuns).toBe(2);
            expect(callback).toHaveBeenCalledTimes(1);
        });

        it("re-runs for key renames that keep the key count stable", () => {
            const root = trackRoot(
                Retree.root({ record: { a: 1 } as Record<string, number> })
            );
            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(
                    () => Object.keys(root.record).join(","),
                    callback
                )
            );

            Retree.runTransaction(() => {
                delete root.record.a;
                root.record.b = 1;
            });

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith("b", "a");
        });
    });

    describe("tracked selectors with the in operator", () => {
        it("re-runs when the checked key is added or deleted", () => {
            const root = trackRoot(
                Retree.root({ record: {} as Record<string, number> })
            );
            const callback = vi.fn();
            trackUnsubscribe(Retree.select(() => "a" in root.record, callback));

            root.record.a = 1;
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith(true, false);

            delete root.record.a;
            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenLastCalledWith(false, true);
        });

        it("does not re-run a presence-only selector for writes to other keys", () => {
            const root = trackRoot(
                Retree.root({
                    record: { a: 1, b: 2 } as Record<string, number>,
                })
            );
            let selectorRuns = 0;
            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(() => {
                    selectorRuns++;
                    return "a" in root.record;
                }, callback)
            );
            expect(selectorRuns).toBe(1);

            // Presence reads are key-scoped: unrelated keys skip the selector
            // without even re-running it.
            root.record.b = 3;
            expect(selectorRuns).toBe(1);

            // Writes to the checked key validate (presence unchanged).
            root.record.a = 9;
            expect(selectorRuns).toBe(1);
            expect(callback).not.toHaveBeenCalled();

            delete root.record.a;
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith(false, true);
        });
    });

    describe("trapped @memo with iteration-shape reads", () => {
        it("invalidates on key add/delete but not on value writes", () => {
            let computeRuns = 0;
            class KeyCounter extends ReactiveNode {
                public record: Record<string, number> = {};

                @memo
                get keyCount(): number {
                    computeRuns++;
                    return Object.keys(this.record).length;
                }
            }
            const node = trackRoot(Retree.root(new KeyCounter()));

            expect(node.keyCount).toBe(0);
            expect(node.keyCount).toBe(0);
            expect(computeRuns).toBe(1);

            node.record.a = 1;
            expect(node.keyCount).toBe(1);
            expect(computeRuns).toBe(2);

            // Value write to an existing key: keys snapshot revalidates equal.
            node.record.a = 2;
            expect(node.keyCount).toBe(1);
            expect(computeRuns).toBe(2);

            delete node.record.a;
            expect(node.keyCount).toBe(0);
            expect(computeRuns).toBe(3);
        });
    });

    describe("auto-trapped @select with iteration-shape reads", () => {
        it("emits on the owner for key add/delete but not value writes", () => {
            class SelectKeyCounter extends ReactiveNode {
                public record: Record<string, number> = {};

                @select
                get keyCount(): number {
                    return Object.keys(this.record).length;
                }
            }
            const node = trackRoot(Retree.root(new SelectKeyCounter()));
            const nodeChanged = vi.fn();
            Retree.on(node, "nodeChanged", nodeChanged);

            node.record.a = 1;
            expect(nodeChanged).toHaveBeenCalledTimes(1);

            node.record.a = 2;
            expect(nodeChanged).toHaveBeenCalledTimes(1);

            delete node.record.a;
            expect(nodeChanged).toHaveBeenCalledTimes(2);
        });
    });

    describe("arrays", () => {
        it("keeps single-emission array mutators working under tracked selectors", () => {
            const root = trackRoot(Retree.root({ list: [{ v: 1 }, { v: 2 }] }));
            let selectorRuns = 0;
            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(() => {
                    selectorRuns++;
                    return root.list.map((item) => item.v).join(",");
                }, callback)
            );
            expect(selectorRuns).toBe(1);

            root.list.push({ v: 3 });

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith("1,2,3", "1,2");
            expect(selectorRuns).toBe(2);
        });

        it("re-runs Object.keys selectors over arrays on push and pop", () => {
            const root = trackRoot(Retree.root({ list: [1, 2] }));
            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(() => Object.keys(root.list).length, callback)
            );

            root.list.push(3);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith(3, 2);

            root.list.pop();
            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenLastCalledWith(2, 3);
        });
    });

    describe("reproxy reads", () => {
        it("tracks Object.keys and in reads made through a reproxy", () => {
            const root = trackRoot(
                Retree.root({ record: { a: 1 } as Record<string, number> })
            );
            // Reproxy the record so tracked reads resolve through a
            // ReproxyHandler (whose Proxy target is the base proxy, so
            // has/ownKeys forward to the base traps).
            root.record.a = 2;
            const reproxiedRecord = getReproxyNode(getBaseProxy(root.record));
            expect(reproxiedRecord).not.toBe(root.record);

            const callback = vi.fn();
            trackUnsubscribe(
                Retree.select(
                    () =>
                        Object.keys(reproxiedRecord).length +
                        ("b" in reproxiedRecord ? 10 : 0),
                    callback
                )
            );

            root.record.b = 1;
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith(12, 1);

            delete root.record.b;
            expect(callback).toHaveBeenCalledTimes(2);
            expect(callback).toHaveBeenLastCalledWith(1, 12);
        });
    });
});
