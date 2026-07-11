import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Retree } from "./Retree";
import { ReactiveNode } from "./ReactiveNode";
import { Transactions } from "./internals/transactions";
import { getReproxyNode } from "./internals/reproxy";
import {
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
} from "./internals/proxy";
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
    it("selects from a root node and only emits when the selected value changes", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        const selected = vi.fn();
        Retree.select(root, (node) => node.count, selected);

        root.label = "two";
        root.count = 2;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(2, 1);
    });

    it("selects from any Retree-managed child node", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                    label: "one",
                },
            })
        );
        const selected = vi.fn();
        Retree.select(root.child, (node) => node.count, selected);

        root.child.label = "two";
        root.child.count = 2;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(2, 1);
    });

    it("uses custom select equality before notifying", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
            })
        );
        const selected = vi.fn();
        Retree.select(root.child, (node) => ({ count: node.count }), selected, {
            equals: (previous, next) => previous.count === next.count,
        });

        root.child.count = 1;
        root.child.count = 2;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected.mock.calls[0]?.[0]).toEqual({ count: 2 });
        expect(selected.mock.calls[0]?.[1]).toEqual({ count: 1 });
    });

    it("stops select notifications after unsubscribe", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
            })
        );
        const selected = vi.fn();
        const unsubscribe = Retree.select(root, (node) => node.count, selected);

        unsubscribe();
        root.count = 2;

        expect(selected).not.toHaveBeenCalled();
    });

    it("selects across child changes when treeChanged is requested", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
                sibling: {
                    count: 10,
                },
            })
        );
        const selected = vi.fn();
        Retree.select(
            root,
            (node) => node.child.count + node.sibling.count,
            selected,
            {
                listenerType: "treeChanged",
            }
        );

        root.child.count = 2;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(12, 11);
    });

    it("does not select across child changes by default", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
            })
        );
        const selected = vi.fn();
        Retree.select(root, (node) => node.child.count, selected);

        root.child.count = 2;

        expect(selected).not.toHaveBeenCalled();
    });

    it("selects direct node changes by default", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
                count: 10,
            })
        );
        const selected = vi.fn();
        Retree.select(root, (node) => node.child.count + node.count, selected);

        root.child.count = 2;
        root.count = 11;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(13, 11);
    });

    it("selects with trapped dependencies when only a selector function is passed", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        const selected = vi.fn();
        Retree.select(() => root.count, selected);

        root.label = "two";
        expect(selected).not.toHaveBeenCalled();

        root.count = 2;
        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(2, 1);
    });

    it("trapped select subscriptions follow reproxy child reads", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                    label: "one",
                },
            })
        );
        const selected = vi.fn();
        Retree.select(() => root.child.count, selected);

        root.child.label = "two";
        expect(selected).not.toHaveBeenCalled();

        root.child.count = 2;
        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(2, 1);
    });

    it("trapped select compares primitive reads even when the selected value is equal", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
            })
        );
        const selected = vi.fn();
        Retree.select(() => root.count > 0, selected);

        root.count = 2;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected).toHaveBeenCalledWith(true, true);
    });

    it("infers selector-only select callback values from the selector return type", () => {
        type Task = {
            id: string;
            text: string;
        };
        type QueryStatus = "pending" | "success";
        const root = trackRoot(
            Retree.root({
                tasks: {
                    state: undefined as Task[] | undefined,
                    result: {
                        status: "pending" as QueryStatus,
                    },
                },
                filter: {
                    isComplete: null as boolean | null,
                },
            })
        );

        Retree.select(
            () => {
                const tasks = root.tasks.state ?? [];
                return [tasks, root.filter, root.tasks.result.status] as const;
            },
            ([tasks, filter, queryStatus]) => {
                expectTypeOf(tasks).toEqualTypeOf<Task[]>();
                expectTypeOf(filter).toEqualTypeOf<typeof root.filter>();
                expectTypeOf(queryStatus).toEqualTypeOf<QueryStatus>();
            }
        );
    });

    it("selects dependency tuples and uses reactive entries as ordered subscriptions", () => {
        const root = trackRoot(
            Retree.root({
                attributeId: "a",
                attributes: [
                    { id: "a", value: 0 },
                    { id: "b", value: 0 },
                ],
            })
        );
        const selected = vi.fn();
        Retree.select(
            root,
            (node) =>
                [
                    node.attributes,
                    node.attributeId,
                    node.attributes.find(
                        (attribute) => attribute.id === node.attributeId
                    ),
                ] as const,
            selected
        );

        root.attributes.push({ id: "c", value: 0 });
        root.attributes[1].value = 1;

        expect(selected).not.toHaveBeenCalled();

        root.attributes[0].value = 1;
        root.attributeId = "b";

        expect(selected).toHaveBeenCalledTimes(2);
        expect(selected.mock.calls[0]?.[0][2]?.value).toBe(1);
        expect(selected.mock.calls[1]?.[0][2]?.id).toBe("b");
    });

    it("handles duplicate reactive dependencies by preserving every dependency slot", () => {
        const root = trackRoot(
            Retree.root({
                child: { value: 1 },
            })
        );
        const selected = vi.fn();
        Retree.select(
            root,
            (node) => [node.child, node.child] as const,
            selected
        );

        root.child.value = 2;

        expect(selected).toHaveBeenCalledTimes(1);
        expect(selected.mock.calls[0]?.[0][1].value).toBe(2);
    });

    it("infers tuple select values for callbacks and equality", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        Retree.select(
            root,
            (node) => [node.count, node.label] as const,
            (next, previous) => {
                expectTypeOf(next).toEqualTypeOf<readonly [number, string]>();
                expectTypeOf(previous).toEqualTypeOf<
                    readonly [number, string]
                >();
            },
            {
                equals: (previous, next) => {
                    expectTypeOf(previous).toEqualTypeOf<
                        readonly [number, string]
                    >();
                    expectTypeOf(next).toEqualTypeOf<
                        readonly [number, string]
                    >();
                    return previous[0] === next[0] && previous[1] === next[1];
                },
            }
        );
    });

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

    it("passes field changes to nodeChanged listeners", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.count = 2;

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(nodeChanged.mock.calls[0]?.[1]).toEqual([
            {
                key: "count",
                previous: 1,
                new: 2,
            },
        ]);
    });

    it("passes descendant field changes to treeChanged listeners", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
            })
        );
        const treeChanged = vi.fn();
        Retree.on(root, "treeChanged", treeChanged);

        root.child.count = 2;

        expect(treeChanged).toHaveBeenCalledTimes(1);
        expect(treeChanged.mock.calls[0]?.[1]).toEqual([
            {
                key: "count",
                previous: 1,
                new: 2,
            },
        ]);
    });

    it("aggregates field changes during transactions", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        Retree.runTransaction(() => {
            root.count = 2;
            root.label = "two";
        });

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(nodeChanged.mock.calls[0]?.[1]).toEqual([
            {
                key: "count",
                previous: 1,
                new: 2,
            },
            {
                key: "label",
                previous: "one",
                new: "two",
            },
        ]);
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

        expect(Object.keys(rootHandler[proxiedChildrenKey] ?? {})).toEqual([]);

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
        }).toThrow(/already has a structural parent/i);
        expect(() => {
            root2.other = root1.child;
        }).toThrow(/Current parent: Object at key child/i);
        expect(() => {
            root2.other = root1.child;
        }).toThrow(/Retree.move/);
    });

    it("enforces the single-parent rule for raw objects that already belong to a tree", () => {
        const rawChild = { value: 1 };
        const root1 = trackRoot(Retree.root({ child: rawChild }));
        const root2 = trackRoot(
            Retree.root({ other: null as null | { value: number } })
        );

        expect(root1.child).toBeDefined();
        expect(() => {
            root2.other = rawChild;
        }).toThrow(/already has a structural parent/i);
        expect(() => {
            root2.other = rawChild;
        }).toThrow(/Current parent: Object at key child/i);
        expect(() => {
            root2.other = rawChild;
        }).toThrow(/Retree.move/);
    });

    it("reads raw aliases to managed nodes without changing structural parentage", () => {
        const rawChild = { value: 1 };
        const root = trackRoot(
            Retree.root({
                child: rawChild,
                alias: { data: rawChild },
            })
        );

        expect(root.child).toBeDefined();
        const aliasData = root.alias.data;

        expect(getUnproxiedNode(aliasData)).toBe(getUnproxiedNode(root.child));
        expect(Retree.parent(aliasData)).toBe(root);
    });

    it("stores a Retree.link without reparenting the linked target", () => {
        const source = trackRoot(Retree.root({ child: { value: 1 } }));
        const owner = trackRoot(
            Retree.root({
                selected: null as null | ReturnType<typeof Retree.link>,
            })
        );
        const nodeChanged = vi.fn();
        Retree.on(owner, "nodeChanged", nodeChanged);

        owner.selected = Retree.link(source.child);

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        if (!owner.selected) {
            throw new Error("Expected Retree.link to create a selected link.");
        }
        expect(Retree.parent(owner.selected)).toBe(owner);
        expect(Retree.parent(owner.selected.current)).toBe(source);
    });

    it("returns the latest linked current reproxy", () => {
        const source = trackRoot(Retree.root({ child: { value: 1 } }));
        const link = trackRoot(Retree.root(Retree.link(source.child)));
        const beforeChange = link.current;

        source.child.value = 2;

        expect(link.current).not.toBe(beforeChange);
        expect(link.current.value).toBe(2);
    });

    it("creates links from ReactiveNode.link", () => {
        class LinkOwnerNode extends ReactiveNode {
            public selected: ReturnType<
                typeof Retree.link<{ value: number }>
            > | null = null;

            get dependencies() {
                return [];
            }

            select(node: { value: number }) {
                this.selected = this.link(node);
                return this.selected;
            }
        }

        const source = trackRoot(Retree.root({ child: { value: 1 } }));
        const owner = trackRoot(Retree.root(new LinkOwnerNode()));
        const nodeChanged = vi.fn();
        Retree.on(owner, "nodeChanged", nodeChanged);

        const selected = owner.select(source.child);
        expectTypeOf(selected.current).toEqualTypeOf<{ value: number }>();

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(owner.selected).toBe(selected);
        expect(Retree.parent(selected)).toBe(owner);
        expect(Retree.parent(selected.current)).toBe(source);

        const beforeChange = selected.current;
        source.child.value = 2;

        expect(selected.current).not.toBe(beforeChange);
        expect(selected.current.value).toBe(2);
    });

    it("moves a node from one array parent to another array parent", () => {
        interface Task {
            title: string;
        }
        interface Note {
            body: string;
        }
        const root = trackRoot(
            Retree.root({
                projectA: { tasks: [{ title: "a" }] as Task[] },
                projectB: { tasks: [] as Task[] },
            })
        );
        const task = root.projectA.tasks[0];
        if (!task) {
            throw new Error("Expected source task to exist before move.");
        }

        const moved = Retree.move(task, root.projectB.tasks, 0);
        expectTypeOf(moved).toEqualTypeOf<Task>();

        expect(root.projectA.tasks).toHaveLength(0);
        expect(root.projectB.tasks).toHaveLength(1);
        expect(getUnproxiedNode(root.projectB.tasks[0]!)).toBe(
            getUnproxiedNode(moved)
        );
        expect(Retree.parent(moved)).toBe(root.projectB.tasks);

        expect(() => {
            // @ts-expect-error Array move keys must be numbers.
            Retree.move(moved, root.projectA.tasks, "first");
        }).toThrow(/array destinations require a numeric key/i);

        if (false) {
            const noteRoot = Retree.root({ note: { body: "note" } as Note });
            // @ts-expect-error Node must be assignable to the array element type.
            Retree.move(noteRoot.note, root.projectA.tasks);
        }
    });

    it("moves a node from an object parent to a Map parent", () => {
        interface Task {
            title: string;
        }
        interface Note {
            body: string;
        }
        const root = trackRoot(
            Retree.root({
                task: { title: "a" } as Task,
                tasks: new Map<string, Task>(),
            })
        );
        const task = root.task;

        const moved = Retree.move(task, root.tasks, "task-a");
        expectTypeOf(moved).toEqualTypeOf<Task>();

        expect("task" in root).toBe(false);
        expect(getUnproxiedNode(root.tasks.get("task-a")!)).toBe(
            getUnproxiedNode(moved)
        );
        expect(Retree.parent(moved)).toBe(root.tasks);

        if (false) {
            const noteRoot = Retree.root({ note: { body: "note" } as Note });
            // @ts-expect-error Map key must match the destination Map key type.
            Retree.move(moved, root.tasks, 1);
            // @ts-expect-error Node must be assignable to the Map value type.
            Retree.move(noteRoot.note, root.tasks, "note-id");
        }
    });

    it("moves a node into typed object keys", () => {
        interface Task {
            title: string;
        }
        interface Note {
            body: string;
        }
        const taskKey = Symbol("task");
        const root = trackRoot(
            Retree.root({
                source: { task: { title: "a" } as Task },
                destinations: {
                    task: null as Task | null,
                    note: null as Note | null,
                    optionalTask: undefined as Task | undefined,
                    [taskKey]: null as Task | null,
                },
            })
        );

        const moved = Retree.move(root.source.task, root.destinations, taskKey);
        expectTypeOf(moved).toEqualTypeOf<Task>();

        expect("task" in root.source).toBe(false);
        expect(getUnproxiedNode(root.destinations[taskKey]!)).toBe(
            getUnproxiedNode(moved)
        );
        expect(Retree.parent(moved)).toBe(root.destinations);

        if (false) {
            // @ts-expect-error Object key must point to a compatible value slot.
            Retree.move(moved, root.destinations, "note");
            // @ts-expect-error Object key must exist on the destination.
            Retree.move(moved, root.destinations, "missing");
        }
    });

    it("moves a ReactiveNode with moveTo", () => {
        class TaskNode extends ReactiveNode {
            public value = 1;
            public taskTitle = "";

            get dependencies() {
                return [];
            }
        }
        class NoteNode extends ReactiveNode {
            public noteBody = "";

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(
            Retree.root({
                a: [new TaskNode()],
                b: [] as TaskNode[],
                byId: new Map<string, TaskNode>(),
                selected: {
                    task: null as TaskNode | null,
                    note: null as NoteNode | null,
                },
            })
        );
        const task = root.a[0];
        if (!task) {
            throw new Error("Expected reactive task to exist before move.");
        }

        task.moveTo(root.b);

        expect(root.a).toHaveLength(0);
        expect(root.b[0]).toBe(task);
        expect(Retree.parent(task)).toBe(root.b);

        const movedToMap = task.moveTo(root.byId, "task-id");
        expectTypeOf(movedToMap).toEqualTypeOf<TaskNode>();
        expect(root.b).toHaveLength(0);
        expect(root.byId.get("task-id")).toBe(task);
        expect(Retree.parent(task)).toBe(root.byId);

        const movedToObject = task.moveTo(root.selected, "task");
        expectTypeOf(movedToObject).toEqualTypeOf<TaskNode>();
        expect(root.byId.size).toBe(0);
        expect(root.selected.task).toBe(task);
        expect(Retree.parent(task)).toBe(root.selected);

        expect(() => {
            // @ts-expect-error Array move keys must be numbers.
            task.moveTo(root.b, "first");
        }).toThrow(/array destinations require a numeric key/i);

        if (false) {
            // @ts-expect-error Node must be assignable to the array element type.
            task.moveTo([] as NoteNode[]);
            // @ts-expect-error Map key must match the destination Map key type.
            task.moveTo(root.byId, 1);
            // @ts-expect-error Object key must point to a compatible value slot.
            task.moveTo(root.selected, "note");
        }
    });

    it("clones a node into a detached value that can be assigned elsewhere", () => {
        const root = trackRoot(
            Retree.root({
                source: { nested: { value: 1 } },
                copy: null as null | { nested: { value: number } },
            })
        );

        root.copy = Retree.clone(root.source);

        if (!root.copy) {
            throw new Error("Expected cloned value to be assigned.");
        }
        expect(root.copy).not.toBe(root.source);
        expect(root.copy.nested).not.toBe(root.source.nested);
        expect(root.copy.nested.value).toBe(1);
        expect(Retree.parent(root.copy)).toBe(root);
        expect(Retree.parent(root.copy.nested)).toBe(root.copy);
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

describe("Retree.isNode", () => {
    it("returns true for roots, children, and reproxies", () => {
        const root = Retree.root({ child: { value: 1 } });
        expect(Retree.isNode(root)).toBe(true);
        expect(Retree.isNode(root.child)).toBe(true);

        let latest: typeof root | undefined;
        const unsubscribe = Retree.on(root, "nodeChanged", (reproxy) => {
            latest = reproxy;
        });
        root.child = { value: 2 };
        expect(latest).toBeDefined();
        if (latest === undefined) {
            throw new Error("expected nodeChanged listener to run");
        }
        expect(Retree.isNode(latest)).toBe(true);
        unsubscribe();
    });

    it("returns true for managed Map and Set nodes", () => {
        const root = Retree.root({
            map: new Map([["a", { value: 1 }]]),
            set: new Set([{ value: 1 }]),
        });
        expect(Retree.isNode(root.map)).toBe(true);
        expect(Retree.isNode(root.map.get("a"))).toBe(true);
        expect(Retree.isNode(root.set)).toBe(true);
    });

    it("returns false for raw values behind managed nodes", () => {
        const raw = { child: { value: 1 } };
        const root = Retree.root(raw);
        expect(root.child.value).toBe(1); // materialize
        expect(Retree.isNode(Retree.raw(root))).toBe(false);
        expect(Retree.isNode(raw.child)).toBe(false);
    });

    it("returns false for unrooted objects and non-object values", () => {
        expect(Retree.isNode({ count: 0 })).toBe(false);
        expect(Retree.isNode([1, 2, 3])).toBe(false);
        expect(Retree.isNode(null)).toBe(false);
        expect(Retree.isNode(undefined)).toBe(false);
        expect(Retree.isNode("text")).toBe(false);
        expect(Retree.isNode(42)).toBe(false);
        expect(Retree.isNode(true)).toBe(false);
    });

    it("guards Retree.raw for maybe-managed values", () => {
        const root = Retree.root({ value: 1 });
        const plain = { value: 2 };
        const unwrap = <T>(value: T): T =>
            Retree.isNode(value) ? (Retree.raw(value) as T) : value;
        expect(unwrap(root)).toBe(Retree.raw(root));
        expect(unwrap(plain)).toBe(plain);
        expect(unwrap("text")).toBe("text");
    });
});

describe("Retree.raw", () => {
    it("returns the raw object behind a root node", () => {
        const raw = { count: 0, child: { value: 1 } };
        const root = Retree.root(raw);
        expect(Retree.raw(root)).toBe(raw);
    });

    it("returns the raw object behind a child node and a reproxy", () => {
        const raw = { child: { value: 1 } };
        const root = Retree.root(raw);
        expect(Retree.raw(root.child)).toBe(raw.child);

        let latest: typeof root | undefined;
        const unsubscribe = Retree.on(root, "nodeChanged", (reproxy) => {
            latest = reproxy;
        });
        (root as { count?: number }).count = 1;
        expect(latest).toBeDefined();
        if (latest === undefined) {
            throw new Error("expected nodeChanged listener to run");
        }
        expect(Retree.raw(latest)).toBe(raw);
        unsubscribe();
    });

    it("throws for unmanaged values", () => {
        expect(() => Retree.raw({ count: 0 })).toThrowError(/Retree.raw/);
    });

    it("reads via raw do not subscribe a tracked select", () => {
        const root = Retree.root({ items: [{ score: 1 }, { score: 2 }] });
        // Materialize children before selecting.
        expect(root.items[1].score).toBe(2);
        const callback = vi.fn();
        const unsubscribe = Retree.select(() => {
            const rawItems = Retree.raw(root.items);
            let total = 0;
            for (const item of rawItems) {
                total += item.score;
            }
            return total;
        }, callback);
        root.items[0].score = 100;
        expect(callback).not.toHaveBeenCalled();
        unsubscribe();
    });
});

describe("Retree.untracked", () => {
    it("pauses dependency collection inside tracked selectors", () => {
        const root = Retree.root({
            flag: false,
            items: [{ score: 1 }, { score: 2 }],
        });
        const callback = vi.fn();
        const unsubscribe = Retree.select(() => {
            const flag = root.flag;
            const total = Retree.untracked(() =>
                root.items.reduce((sum, item) => sum + item.score, 0)
            );
            return flag ? total : -1;
        }, callback);

        // Untracked reads must not subscribe: item mutations are invisible.
        root.items[0].score = 100;
        expect(callback).not.toHaveBeenCalled();

        // Tracked reads still subscribe.
        root.flag = true;
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenLastCalledWith(102, -1);
        unsubscribe();
    });

    it("returns the callback result and still emits writes", () => {
        const root = Retree.root({ count: 0 });
        const nodeChanged = vi.fn();
        const unsubscribe = Retree.on(root, "nodeChanged", nodeChanged);
        const result = Retree.untracked(() => {
            root.count = 5;
            return root.count * 2;
        });
        expect(result).toBe(10);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        unsubscribe();
    });
});

describe("Retree.peekInto", () => {
    it("resolves a found raw child back to its managed node", () => {
        const project = Retree.root({
            tasks: [
                { id: "a", done: false },
                { id: "b", done: true },
            ],
        });
        // Materialize children so managed proxies exist.
        project.tasks.forEach(() => {});

        const task = Retree.peekInto(project.tasks, (rawTasks) =>
            rawTasks.find((candidate) => candidate.id === "b")
        );
        expect(task).toBeDefined();
        if (task === undefined) {
            throw new Error("expected peekInto to find task b");
        }
        // The result is managed: mutations emit.
        const nodeChanged = vi.fn();
        const unsubscribe = Retree.on(task, "nodeChanged", nodeChanged);
        task.done = false;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it("returns the latest reproxy for nodes that have reproxied", () => {
        const project = Retree.root({ settings: { theme: "light" } });
        project.settings.theme = "dark"; // forces a reproxy of settings
        const settings = Retree.peekInto(project, (raw) => raw.settings);
        expect(settings).toBe(getReproxyNode(project.settings));
        expect(settings.theme).toBe("dark");
    });

    it("returns primitives and callback-built containers as-is", () => {
        const project = Retree.root({
            tasks: [
                { id: "a", done: false },
                { id: "b", done: true },
            ],
        });
        project.tasks.forEach(() => {});

        const count = Retree.peekInto(
            project.tasks,
            (rawTasks) => rawTasks.filter((candidate) => candidate.done).length
        );
        expect(count).toBe(1);

        const rawTasks = Retree.raw(project.tasks);
        const filtered = Retree.peekInto(project.tasks, (raw) =>
            raw.filter((candidate) => candidate.done)
        );
        // A fresh array is not a managed node; elements stay raw.
        expect(Array.isArray(filtered)).toBe(true);
        expect(filtered[0]).toBe(rawTasks[1]);
    });

    it("returns raw values for children that were never materialized", () => {
        const project = Retree.root({ hidden: { value: 1 } });
        // No traversal of project.hidden through the proxy.
        const hidden = Retree.peekInto(project, (raw) => raw.hidden);
        expect(hidden).toBe(Retree.raw(project).hidden);
    });

    it("does not subscribe reads inside the callback to tracked selects", () => {
        const project = Retree.root({
            tasks: [{ done: false }],
            label: "x",
        });
        project.tasks.forEach(() => {});
        const callback = vi.fn();
        const unsubscribe = Retree.select(() => {
            void project.label; // tracked
            return Retree.peekInto(
                project.tasks,
                (rawTasks) =>
                    rawTasks.filter((candidate) => candidate.done).length
            );
        }, callback);
        project.tasks[0].done = true;
        expect(callback).not.toHaveBeenCalled();
        unsubscribe();
    });
});
