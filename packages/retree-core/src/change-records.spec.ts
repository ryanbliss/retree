/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode, ignore } from "./index.js";
import { INodeFieldChanges } from "./types.js";
import { Transactions } from "./internals/transactions.js";
import { getCustomProxyHandler } from "./internals/proxy.js";

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
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

describe("change record node identity", () => {
    it("attributes property writes to the raw node that changed", () => {
        const root = trackRoot(Retree.root({ count: 0, child: { v: 0 } }));
        const received: INodeFieldChanges[][] = [];
        Retree.on(root, "nodeChanged", (_node, changes) => {
            received.push(changes);
        });
        Retree.on(root.child, "nodeChanged", (_node, changes) => {
            received.push(changes);
        });

        root.count = 1;
        root.child.v = 1;

        expect(received[0]?.[0]?.node).toBe(Retree.raw(root));
        expect(received[0]?.[0]?.key).toBe("count");
        expect(received[1]?.[0]?.node).toBe(Retree.raw(root.child));
        expect(received[1]?.[0]?.key).toBe("v");
        // Always raw: never the managed proxy.
        expect(received[0]?.[0]?.node).not.toBe(root);
    });

    it("distinguishes a ReactiveNode's own records from dependency-forwarded records", () => {
        class Watcher extends ReactiveNode {
            public label = "";
            public source = { count: 0 };
            @ignore
            public onChangedRecords: INodeFieldChanges[] = [];

            get dependencies() {
                return [this.dependency(this.source)];
            }

            protected onChanged(changes: INodeFieldChanges[]): void {
                this.onChangedRecords.push(...changes);
            }
        }
        const watcher = trackRoot(Retree.root(new Watcher()));
        const received: INodeFieldChanges[][] = [];
        Retree.on(watcher, "nodeChanged", (_node, changes) => {
            received.push(changes);
        });

        watcher.label = "own write";
        watcher.source.count = 1;

        expect(received).toHaveLength(2);
        // Own write: records describe the watcher itself.
        expect(received[0]?.[0]?.node).toBe(Retree.raw(watcher));
        expect(received[0]?.[0]?.key).toBe("label");
        // Dependency-driven emission: forwarded records describe the source.
        expect(received[1]?.[0]?.node).toBe(Retree.raw(watcher.source));
        expect(received[1]?.[0]?.key).toBe("count");
        expect(received[1]?.[0]?.node).not.toBe(Retree.raw(watcher));

        // onChanged receives the same attributable records.
        expect(watcher.onChangedRecords[0]?.node).toBe(Retree.raw(watcher));
        expect(watcher.onChangedRecords[1]?.node).toBe(
            Retree.raw(watcher.source)
        );
    });

    it("attributes treeChanged records to the descendant that changed", () => {
        const root = trackRoot(Retree.root({ child: { v: 0 } }));
        const received: INodeFieldChanges[][] = [];
        Retree.on(root, "treeChanged", (_node, changes) => {
            received.push(changes);
        });

        root.child.v = 1;

        expect(received[0]?.[0]?.node).toBe(Retree.raw(root.child));
    });

    it("preserves symbol property keys on change records", () => {
        const symbolKey = Symbol("scratch");
        const root = trackRoot(
            Retree.root({ count: 0 } as { count: number } & Record<
                symbol,
                number
            >)
        );
        const received: INodeFieldChanges[][] = [];
        Retree.on(root, "nodeChanged", (_node, changes) => {
            received.push(changes);
        });

        root[symbolKey] = 1;

        expect(received[0]?.[0]?.key).toBe(symbolKey);
    });
});

describe("Map change record keys", () => {
    it("carries the original object key instead of a stringified form", () => {
        const objectKey = { id: 1 };
        const root = trackRoot(Retree.root({ map: new Map<object, number>() }));
        const received: INodeFieldChanges[][] = [];
        Retree.on(root.map, "nodeChanged", (_node, changes) => {
            received.push(changes);
        });

        root.map.set(objectKey, 5);
        root.map.delete(objectKey);

        expect(received[0]?.[0]).toEqual({
            node: Retree.raw(root.map),
            key: objectKey,
            previous: undefined,
            new: 5,
            op: "add",
        });
        expect(received[0]?.[0]?.key).toBe(objectKey);
        expect(received[1]?.[0]?.key).toBe(objectKey);
        expect(received[1]?.[0]?.previous).toBe(5);
    });

    it("carries primitive Map keys unchanged", () => {
        const root = trackRoot(Retree.root({ map: new Map<number, string>() }));
        const received: INodeFieldChanges[][] = [];
        Retree.on(root.map, "nodeChanged", (_node, changes) => {
            received.push(changes);
        });

        root.map.set(42, "answer");

        expect(received[0]?.[0]?.key).toBe(42);
        expect(received[0]?.[0]?.node).toBe(Retree.raw(root.map));
    });
});
