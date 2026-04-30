import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree";
import { Transactions } from "./internals/transactions";
import { getReproxyNode } from "./internals/reproxy";
import { getBaseProxy } from "./internals/proxy";

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
    Retree.clearListeners(node as never);
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

describe("Retree", () => {
    it("tracks parent relationships for nested objects and array items", () => {
        const root = trackRoot(
            Retree.use({
                child: { grandchild: { value: 1 } },
                list: [{ value: 2 }],
            })
        );

        expect(Retree.parent(root)).toBeNull();
        expect(Retree.parent(root.child)).toBe(root);
        expect(Retree.parent(root.child.grandchild)).toBe(root.child);
        expect(Retree.parent(root.list)).toBe(root);
        expect(Retree.parent(root.list[0])).toBe(root.list);
    });

    it("distinguishes nodeChanged and treeChanged notifications", () => {
        const root = trackRoot(
            Retree.use({ child: { value: 1 }, sibling: { value: 2 } })
        );
        const rootNodeChanged = vi.fn();
        const rootTreeChanged = vi.fn();
        const childNodeChanged = vi.fn();

        Retree.on(root, "nodeChanged", rootNodeChanged);
        Retree.on(root, "treeChanged", rootTreeChanged);
        Retree.on(root.child, "nodeChanged", childNodeChanged);

        root.child.value = 3;

        expect(rootNodeChanged).not.toHaveBeenCalled();
        expect(rootTreeChanged).toHaveBeenCalledTimes(1);
        expect(childNodeChanged).toHaveBeenCalledTimes(1);
        expect(rootTreeChanged.mock.calls[0]?.[0].child.value).toBe(3);
        expect(getBaseProxy(rootTreeChanged.mock.calls[0]?.[0].sibling)).toBe(
            root.sibling
        );
    });

    it("emits nodeRemoved for replaced object nodes", () => {
        const root = trackRoot(Retree.use({ child: { value: 1 } }));
        const childRemoved = vi.fn();

        Retree.on(root.child, "nodeRemoved", childRemoved);
        root.child = { value: 2 };

        expect(childRemoved).toHaveBeenCalledTimes(1);
    });

    it("enforces the single-parent rule for proxied children", () => {
        const root1 = trackRoot(Retree.use({ child: { value: 1 } }));
        const root2 = trackRoot(
            Retree.use({ other: null as null | { value: number } })
        );

        expect(() => {
            root2.other = root1.child;
        }).toThrow(/single parent/i);
    });

    it("batches transaction notifications per node", () => {
        const root = trackRoot(Retree.use({ count: 0, child: { value: 1 } }));
        const rootNodeChanged = vi.fn();
        const rootTreeChanged = vi.fn();
        const childNodeChanged = vi.fn();

        Retree.on(root, "nodeChanged", rootNodeChanged);
        Retree.on(root, "treeChanged", rootTreeChanged);
        Retree.on(root.child, "nodeChanged", childNodeChanged);

        Retree.runTransaction(() => {
            root.count = 1;
            root.count = 2;
            root.child.value = 2;
            root.child.value = 3;
        });

        expect(rootNodeChanged).toHaveBeenCalledTimes(1);
        expect(rootTreeChanged).toHaveBeenCalledTimes(1);
        expect(childNodeChanged).toHaveBeenCalledTimes(1);
    });

    it("suppresses listener emission during silent updates and can preserve reproxy identity", () => {
        const root = trackRoot(Retree.use({ count: 0 }));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        const beforeSilent = getReproxyNode(root);
        Retree.runSilent(() => {
            root.count = 1;
        });
        const afterSilent = getReproxyNode(root);

        expect(nodeChanged).not.toHaveBeenCalled();
        expect(afterSilent).toBe(beforeSilent);

        Retree.runSilent(() => {
            root.count = 2;
        }, false);
        const afterSilentReproxy = getReproxyNode(root);

        expect(nodeChanged).not.toHaveBeenCalled();
        expect(afterSilentReproxy).not.toBe(afterSilent);
        expect(afterSilentReproxy.count).toBe(2);
    });

    it("restores transaction state when a transaction callback throws", () => {
        const root = trackRoot(Retree.use({ count: 0 }));
        const nodeChanged = vi.fn();
        const error = new Error("boom");
        Retree.on(root, "nodeChanged", nodeChanged);

        expect(() => {
            Retree.runTransaction(() => {
                root.count = 1;
                throw error;
            });
        }).toThrow("boom");

        expect(Transactions.runningTransaction).toBe(false);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("restores transaction state when a queued listener throws", () => {
        // Regression coverage: listener failures during the post-transaction flush should not poison global state.
        const root = trackRoot(Retree.use({ count: 0 }));
        const nodeChanged = vi.fn(() => {
            throw new Error("listener failed");
        });
        Retree.on(root, "nodeChanged", nodeChanged);

        expect(() => {
            Retree.runTransaction(() => {
                root.count = 1;
            });
        }).toThrow("listener failed");

        expect(Transactions.runningTransaction).toBe(false);
        nodeChanged.mockImplementation(() => undefined);
        root.count = 2;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    it("restores silent flags when a silent callback throws", () => {
        const root = trackRoot(Retree.use({ count: 0 }));
        const nodeChanged = vi.fn();
        const error = new Error("boom");
        Retree.on(root, "nodeChanged", nodeChanged);

        expect(() => {
            Retree.runSilent(() => {
                root.count = 1;
                throw error;
            });
        }).toThrow("boom");

        expect(Transactions.skipEmit).toBe(false);
        expect(Transactions.skipReproxy).toBe(false);
        root.count = 2;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });
});
