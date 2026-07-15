/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { Transactions } from "./internals/transactions.js";
import { getCustomProxyHandler } from "./internals/proxy.js";

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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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

function spyOnWarn() {
    return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("dev warning: writes during tracked selector runs", () => {
    it("warns once per node and key in dev mode", () => {
        const warn = spyOnWarn();
        const root = trackRoot(Retree.root({ count: 0, scratch: 0 }));

        trackUnsubscribe(
            Retree.select(() => {
                root.scratch = root.count + 1;
                return root.count;
            }, vi.fn())
        );

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain(
            "was written while a tracked selector or memo was running"
        );
        expect(warn.mock.calls[0]?.[0]).toContain("'scratch'");

        // Re-running the same selector does not warn again for the same key.
        root.count = 1;
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("does not warn in production mode", () => {
        vi.stubEnv("NODE_ENV", "production");
        const warn = spyOnWarn();
        const root = trackRoot(Retree.root({ count: 0, scratch: 0 }));

        trackUnsubscribe(
            Retree.select(() => {
                root.scratch = root.count + 1;
                return root.count;
            }, vi.fn())
        );

        expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn for writes wrapped in Retree.untracked", () => {
        const warn = spyOnWarn();
        const root = trackRoot(Retree.root({ count: 0, scratch: 0 }));

        trackUnsubscribe(
            Retree.select(() => {
                Retree.untracked(() => {
                    root.scratch = root.count + 1;
                });
                return root.count;
            }, vi.fn())
        );

        expect(warn).not.toHaveBeenCalled();
    });
});

describe("dev warning: nodeChanged selectors reading descendants", () => {
    it("warns when a nodeChanged selector reads descendant nodes it does not return", () => {
        const warn = spyOnWarn();
        const root = trackRoot(Retree.root({ child: { value: 1 } }));

        trackUnsubscribe(
            Retree.select(root, (node) => node.child.value, vi.fn())
        );

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("descendant node(s)");
        expect(warn.mock.calls[0]?.[0]).toContain("nodeChanged");
    });

    it("does not warn when the descendant is returned as a dependency", () => {
        const warn = spyOnWarn();
        const root = trackRoot(
            Retree.root({ child: { value: 1 }, label: "a" })
        );

        trackUnsubscribe(
            Retree.select(root, (node) => [node.child, node.label], vi.fn())
        );

        expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn for treeChanged selectors", () => {
        const warn = spyOnWarn();
        const root = trackRoot(Retree.root({ child: { value: 1 } }));

        trackUnsubscribe(
            Retree.select(root, (node) => node.child.value, vi.fn(), {
                listenerType: "treeChanged",
            })
        );

        expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn in production mode", () => {
        vi.stubEnv("NODE_ENV", "production");
        const warn = spyOnWarn();
        const root = trackRoot(Retree.root({ child: { value: 1 } }));

        trackUnsubscribe(
            Retree.select(root, (node) => node.child.value, vi.fn())
        );

        expect(warn).not.toHaveBeenCalled();
    });

    it("keeps selection behavior identical while the dev tracking pass runs", () => {
        const root = trackRoot(Retree.root({ child: { value: 1 }, count: 0 }));
        spyOnWarn();
        const callback = vi.fn();

        trackUnsubscribe(Retree.select(root, (node) => node.count, callback));

        root.count = 1;
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenLastCalledWith(1, 0);
    });
});
