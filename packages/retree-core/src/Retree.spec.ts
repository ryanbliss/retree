import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree";
import { Transactions } from "./internals/transactions";
import { getReproxyNode } from "./internals/reproxy";
import { getBaseProxy, getCustomProxyHandler } from "./internals/proxy";
import { proxiedChildrenKey } from "./internals/proxy-types";

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

describe("Retree", () => {
    it("tracks parent relationships for nested objects and array items", () => {
        const root = trackRoot(
            Retree.root({
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
            Retree.root({ child: { value: 1 }, sibling: { value: 2 } })
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

    it("does not refresh ancestor reproxies for deep nodeChanged-only workloads", () => {
        const root = trackRoot(Retree.root({ child: { value: 1 } }));
        const rootReproxyBefore = getReproxyNode(root);
        const childNodeChanged = vi.fn();
        Retree.on(root.child, "nodeChanged", childNodeChanged);

        root.child.value = 2;

        expect(childNodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).toBe(rootReproxyBefore);
    });

    it("refreshes ancestor reproxies when treeChanged listeners exist", () => {
        const root = trackRoot(Retree.root({ child: { value: 1 } }));
        const rootReproxyBefore = getReproxyNode(root);
        const rootTreeChanged = vi.fn();
        Retree.on(root, "treeChanged", rootTreeChanged);

        root.child.value = 2;

        expect(rootTreeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).not.toBe(rootReproxyBefore);
    });

    it("emits nodeChanged with a fresh reproxy when the delete keyword removes a leaf property", () => {
        const root = trackRoot(
            Retree.root<{ count?: number; label: string }>({
                count: 1,
                label: "current",
            })
        );
        const beforeDelete = getReproxyNode(root);
        let latestReproxy: typeof root | undefined;
        const nodeChanged = vi.fn((reproxy: typeof root) => {
            latestReproxy = reproxy;
        });
        Retree.on(root, "nodeChanged", nodeChanged);

        const didDelete = delete root.count;

        expect(didDelete).toBe(true);
        expect(root.count).toBeUndefined();
        expect("count" in root).toBe(false);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        if (!latestReproxy) {
            throw new Error(
                "Expected delete keyword nodeChanged listener to receive a reproxy"
            );
        }
        expect(latestReproxy).not.toBe(beforeDelete);
        expect(latestReproxy.count).toBeUndefined();
        expect("count" in latestReproxy).toBe(false);
        expect(latestReproxy.label).toBe("current");
    });

    it("emits child nodeChanged and ancestor treeChanged when the delete keyword removes a nested leaf property", () => {
        const root = trackRoot(
            Retree.root<{ child: { value?: number; label: string } }>({
                child: { value: 1, label: "nested" },
            })
        );
        let latestChildReproxy: typeof root.child | undefined;
        let latestRootReproxy: typeof root | undefined;
        const childNodeChanged = vi.fn((reproxy: typeof root.child) => {
            latestChildReproxy = reproxy;
        });
        const rootTreeChanged = vi.fn((reproxy: typeof root) => {
            latestRootReproxy = reproxy;
        });
        Retree.on(root.child, "nodeChanged", childNodeChanged);
        Retree.on(root, "treeChanged", rootTreeChanged);

        const didDelete = delete root.child.value;

        expect(didDelete).toBe(true);
        expect(childNodeChanged).toHaveBeenCalledTimes(1);
        expect(rootTreeChanged).toHaveBeenCalledTimes(1);
        if (!latestChildReproxy) {
            throw new Error(
                "Expected nested delete keyword nodeChanged listener to receive a child reproxy"
            );
        }
        if (!latestRootReproxy) {
            throw new Error(
                "Expected nested delete keyword treeChanged listener to receive a root reproxy"
            );
        }
        expect(latestChildReproxy.value).toBeUndefined();
        expect("value" in latestChildReproxy).toBe(false);
        expect(latestChildReproxy.label).toBe("nested");
        expect(latestRootReproxy.child.value).toBeUndefined();
        expect("value" in latestRootReproxy.child).toBe(false);
        expect(latestRootReproxy.child.label).toBe("nested");
    });

    it("emits nodeChanged and nodeRemoved when the delete keyword removes an object child", () => {
        const root = trackRoot(
            Retree.root<{ child?: { value: number }; label: string }>({
                child: { value: 1 },
                label: "root",
            })
        );
        const child = root.child;
        if (!child) {
            throw new Error(
                "Expected root.child to exist before testing object child deletion"
            );
        }
        let latestReproxy: typeof root | undefined;
        const nodeChanged = vi.fn((reproxy: typeof root) => {
            latestReproxy = reproxy;
        });
        const childRemoved = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        Retree.on(child, "nodeRemoved", childRemoved);

        const didDelete = delete root.child;

        expect(didDelete).toBe(true);
        expect(root.child).toBeUndefined();
        expect("child" in root).toBe(false);
        expect(Retree.parent(child)).toBeNull();
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(childRemoved).toHaveBeenCalledTimes(1);
        if (!latestReproxy) {
            throw new Error(
                "Expected object child delete keyword nodeChanged listener to receive a reproxy"
            );
        }
        expect(latestReproxy.child).toBeUndefined();
        expect("child" in latestReproxy).toBe(false);
        expect(latestReproxy.label).toBe("root");
    });

    it("emits nodeChanged with a fresh reproxy when Object.defineProperty defines a leaf property", () => {
        const root = trackRoot(
            Retree.root<{ count?: number; label: string }>({
                label: "current",
            })
        );
        const beforeDefine = getReproxyNode(root);
        let latestReproxy: typeof root | undefined;
        const nodeChanged = vi.fn((reproxy: typeof root) => {
            latestReproxy = reproxy;
        });
        Retree.on(root, "nodeChanged", nodeChanged);

        Object.defineProperty(root, "count", {
            value: 1,
            writable: true,
            enumerable: true,
            configurable: true,
        });

        expect(root.count).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        if (!latestReproxy) {
            throw new Error(
                "Expected Object.defineProperty nodeChanged listener to receive a reproxy"
            );
        }
        expect(latestReproxy).not.toBe(beforeDefine);
        expect(latestReproxy.count).toBe(1);
        expect(latestReproxy.label).toBe("current");
    });

    it("proxies object children defined with Object.defineProperty", () => {
        const root = trackRoot(
            Retree.root<{ child?: { value: number }; label: string }>({
                label: "root",
            })
        );
        let latestReproxy: typeof root | undefined;
        const nodeChanged = vi.fn((reproxy: typeof root) => {
            latestReproxy = reproxy;
        });
        Retree.on(root, "nodeChanged", nodeChanged);

        Object.defineProperty(root, "child", {
            value: { value: 1 },
            writable: false,
            enumerable: true,
            configurable: true,
        });

        const child = root.child;
        if (!child) {
            throw new Error(
                "Expected Object.defineProperty to define a child node"
            );
        }
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(Retree.parent(child)).toBe(root);
        if (!latestReproxy) {
            throw new Error(
                "Expected Object.defineProperty object child listener to receive a reproxy"
            );
        }
        expect(latestReproxy.child?.value).toBe(1);

        const treeChanged = vi.fn();
        Retree.on(root, "treeChanged", treeChanged);
        child.value = 2;
        expect(treeChanged).toHaveBeenCalledTimes(1);
        expect(root.child?.value).toBe(2);
    });

    it("keeps immutable raw object children unproxied when they are defined with Object.defineProperty", () => {
        const root = trackRoot(
            Retree.root<{ child?: { value: number }; label: string }>({
                label: "root",
            })
        );
        const child = { value: 1 };
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        Object.defineProperty(root, "child", {
            value: child,
        });

        expect(root.child).toBe(child);
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        const treeChanged = vi.fn();
        Retree.on(root, "treeChanged", treeChanged);
        child.value = 2;
        expect(treeChanged).not.toHaveBeenCalled();
        expect(root.child?.value).toBe(2);
    });

    it("keeps immutable raw object children unproxied when an object is rooted", () => {
        const child = { value: 1 };
        const source: { child?: { value: number }; label: string } = {
            label: "root",
        };
        Object.defineProperty(source, "child", {
            value: child,
            enumerable: true,
        });
        const root = trackRoot(Retree.root(source));
        const treeChanged = vi.fn();
        Retree.on(root, "treeChanged", treeChanged);

        expect(root.child).toBe(child);

        child.value = 2;
        expect(treeChanged).not.toHaveBeenCalled();
        expect(root.child?.value).toBe(2);
    });

    it("emits nodeRemoved when Object.defineProperty replaces an object child", () => {
        const root = trackRoot(
            Retree.root<{ child: { value: number } | string; label: string }>({
                child: { value: 1 },
                label: "root",
            })
        );
        const child = root.child;
        if (typeof child !== "object") {
            throw new Error(
                "Expected root.child to be an object before testing Object.defineProperty replacement"
            );
        }
        let latestReproxy: typeof root | undefined;
        const nodeChanged = vi.fn((reproxy: typeof root) => {
            latestReproxy = reproxy;
        });
        const childRemoved = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        Retree.on(child, "nodeRemoved", childRemoved);

        Object.defineProperty(root, "child", {
            value: "removed",
            writable: true,
            enumerable: true,
            configurable: true,
        });

        expect(root.child).toBe("removed");
        expect(Retree.parent(child)).toBeNull();
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(childRemoved).toHaveBeenCalledTimes(1);
        if (!latestReproxy) {
            throw new Error(
                "Expected Object.defineProperty replacement listener to receive a reproxy"
            );
        }
        expect(latestReproxy.child).toBe("removed");
    });

    it("does not emit twice when normal assignment creates a property", () => {
        const root = trackRoot(Retree.root<{ count?: number }>({}));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.count = 1;

        expect(root.count).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("emits nodeRemoved for replaced object nodes", () => {
        const root = trackRoot(Retree.root({ child: { value: 1 } }));
        const childRemoved = vi.fn();

        Retree.on(root.child, "nodeRemoved", childRemoved);
        root.child = { value: 2 };

        expect(childRemoved).toHaveBeenCalledTimes(1);
    });

    it("keeps parent links and reproxy identity correct when an array item is replaced", () => {
        const root = trackRoot(Retree.root({ list: [{ value: 1 }] }));
        const originalItem = root.list[0];
        if (originalItem === undefined) {
            throw new Error(
                "Expected an original array item before replacement."
            );
        }
        const originalListReproxy = getReproxyNode(root.list);
        const itemRemoved = vi.fn();
        Retree.on(originalItem, "nodeRemoved", itemRemoved);

        root.list[0] = { value: 2 };

        const replacementItem = root.list[0];
        if (replacementItem === undefined) {
            throw new Error("Expected a replacement array item.");
        }
        expect(itemRemoved).toHaveBeenCalledTimes(1);
        expect(Retree.parent(originalItem)).toBeNull();
        expect(Retree.parent(replacementItem)).toBe(root.list);
        expect(getReproxyNode(root.list)).not.toBe(originalListReproxy);
    });

    it("parents fresh collection values after map, set, and array replacement", () => {
        const root = trackRoot(
            Retree.root({
                list: [{ value: 1 }],
                map: new Map<string, { value: number }>([
                    ["old", { value: 1 }],
                ]),
                set: new Set<{ value: number }>([{ value: 1 }]),
            })
        );
        const originalRootReproxy = getReproxyNode(root);

        root.list = [{ value: 2 }];
        root.map = new Map<string, { value: number }>([["new", { value: 2 }]]);
        root.set = new Set<{ value: number }>([{ value: 2 }]);

        const listItem = root.list[0];
        const mapItem = root.map.get("new");
        const setItem = [...root.set][0];
        if (listItem === undefined) {
            throw new Error("Expected replacement array item.");
        }
        if (mapItem === undefined) {
            throw new Error("Expected replacement map item.");
        }
        if (setItem === undefined) {
            throw new Error("Expected replacement set item.");
        }
        expect(Retree.parent(root.list)).toBe(root);
        expect(Retree.parent(listItem)).toBe(root.list);
        expect(Retree.parent(root.map)).toBe(root);
        expect(Retree.parent(mapItem)).toBe(root.map);
        expect(Retree.parent(root.set)).toBe(root);
        expect(Retree.parent(setItem)).toBe(root.set);
        expect(getReproxyNode(root)).not.toBe(originalRootReproxy);
    });

    it("lazily proxies nested plain object and array children on first access", () => {
        const root = trackRoot(
            Retree.root({
                child: { grandchild: { value: 1 } },
                list: [{ value: 2 }],
            })
        );
        const rootHandler = getCustomProxyHandler(root);
        if (!rootHandler) {
            throw new Error("Expected root to expose proxy metadata.");
        }

        expect(Object.keys(rootHandler[proxiedChildrenKey])).toEqual([]);

        const child = root.child;
        const list = root.list;
        const listItem = list[0];
        if (listItem === undefined) {
            throw new Error("Expected lazy proxied array item to exist.");
        }

        expect(Retree.parent(child)).toBe(root);
        expect(Retree.parent(child.grandchild)).toBe(child);
        expect(Retree.parent(list)).toBe(root);
        expect(Retree.parent(listItem)).toBe(list);
    });

    it("emits treeChanged after replacing an object and mutating a lazily proxied nested child", () => {
        const root = trackRoot(
            Retree.root<{ child: { grandchild: { value: number } } }>({
                child: { grandchild: { value: 1 } },
            })
        );
        const treeChanged = vi.fn();
        Retree.on(root, "treeChanged", treeChanged);

        root.child = { grandchild: { value: 2 } };
        treeChanged.mockClear();
        root.child.grandchild.value = 3;

        expect(treeChanged).toHaveBeenCalledTimes(1);
        expect(root.child.grandchild.value).toBe(3);
        expect(Retree.parent(root.child.grandchild)).toBe(root.child);
    });

    it("emits nodeRemoved and clears parent metadata for a lazily proxied removed child", () => {
        const root = trackRoot(
            Retree.root<{ child?: { value: number } }>({
                child: { value: 1 },
            })
        );
        const child = root.child;
        if (!child) {
            throw new Error("Expected lazy child to exist before deletion.");
        }
        const childRemoved = vi.fn();
        Retree.on(child, "nodeRemoved", childRemoved);

        const didDelete = delete root.child;

        expect(didDelete).toBe(true);
        expect(childRemoved).toHaveBeenCalledTimes(1);
        expect(Retree.parent(child)).toBeNull();
    });

    it("enforces the single-parent rule for proxied children", () => {
        const root1 = trackRoot(Retree.root({ child: { value: 1 } }));
        const root2 = trackRoot(
            Retree.root({ other: null as null | { value: number } })
        );

        expect(() => {
            root2.other = root1.child;
        }).toThrow(/single parent/i);
    });

    it("batches transaction notifications per node", () => {
        const root = trackRoot(Retree.root({ count: 0, child: { value: 1 } }));
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
        const root = trackRoot(Retree.root({ count: 0 }));
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
        const root = trackRoot(Retree.root({ count: 0 }));
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
        const root = trackRoot(Retree.root({ count: 0 }));
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
        nodeChanged.mockImplementation(() => undefined as never);
        root.count = 2;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    it("restores silent flags when a silent callback throws", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
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
