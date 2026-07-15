/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode, ignore } from "./index.js";
import { INodeFieldChanges } from "./types.js";
import { Transactions } from "./internals/transactions.js";
import { getBaseProxy, getCustomProxyHandler } from "./internals/proxy.js";
import { getReproxyNode } from "./internals/reproxy.js";

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

class SilentLifecycleNode extends ReactiveNode {
    public value = 0;
    public useOther = false;
    public other = { count: 0 };
    @ignore
    public onChangedRuns: INodeFieldChanges[][] = [];

    get dependencies() {
        if (!this.useOther) {
            return [];
        }
        return [this.dependency(this.other)];
    }

    protected onChanged(changes: INodeFieldChanges[]): void {
        this.onChangedRuns.push(changes);
    }
}

describe.each([{ skipReproxy: true }, { skipReproxy: false }])(
    "runSilent lifecycle semantics (skipReproxy: $skipReproxy)",
    ({ skipReproxy }) => {
        it("never runs onChanged during runSilent", () => {
            const node = trackRoot(Retree.root(new SilentLifecycleNode()));
            const listener = vi.fn();
            Retree.on(node, "nodeChanged", listener);

            Retree.runSilent(() => {
                node.value = 1;
            }, skipReproxy);

            expect(node.value).toBe(1);
            expect(listener).not.toHaveBeenCalled();
            expect(node.onChangedRuns).toHaveLength(0);

            // Non-silent writes still run the full lifecycle.
            node.value = 2;
            expect(listener).toHaveBeenCalledTimes(1);
            expect(node.onChangedRuns).toHaveLength(1);
        });

        it("never refreshes dependency subscriptions during runSilent", () => {
            const node = trackRoot(Retree.root(new SilentLifecycleNode()));
            const listener = vi.fn();
            Retree.on(node, "nodeChanged", listener);

            // Silently flip which nodes `dependencies` returns.
            Retree.runSilent(() => {
                node.useOther = true;
            }, skipReproxy);

            // The new dependency is not subscribed: silence means silence.
            node.other.count = 1;
            expect(listener).not.toHaveBeenCalled();
            expect(node.onChangedRuns).toHaveLength(0);

            // The next non-silent change of the node resyncs subscriptions.
            node.value = 1;
            expect(listener).toHaveBeenCalledTimes(1);
            node.other.count = 2;
            expect(listener).toHaveBeenCalledTimes(2);
        });
    }
);

describe("runSilent reproxy modes", () => {
    it("keeps reproxy identity stable with skipReproxy = true", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const before = getReproxyNode(getBaseProxy(root));

        Retree.runSilent(() => {
            root.count = 1;
        });

        expect(getReproxyNode(getBaseProxy(root))).toBe(before);
    });

    it("refreshes reproxy identity with skipReproxy = false", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const before = getReproxyNode(getBaseProxy(root));

        Retree.runSilent(() => {
            root.count = 1;
        }, false);

        expect(getReproxyNode(getBaseProxy(root))).not.toBe(before);
    });
});
