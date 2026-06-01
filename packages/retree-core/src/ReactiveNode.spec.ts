import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import { ignore } from "./decorators";
import { getCustomProxyHandler, getUnproxiedNode } from "./internals";
import { proxiedChildrenKey } from "./internals/proxy-types";
import {
    getReactiveDependencies,
    getReactiveDependents,
} from "./internals/reactive-node-utils";
import { Transactions } from "./internals/transactions";

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        Retree.clearListeners(root as never, false);
    }
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

class EvenNumberNode extends ReactiveNode {
    public numbers: number[] = [];

    get evenNumberCount() {
        return this.numbers.filter((value) => value % 2 === 0).length;
    }

    get dependencies() {
        return [this.dependency(this.numbers, [this.evenNumberCount])];
    }
}

class DynamicDependencyNode extends ReactiveNode {
    public first: number[] = [];
    public second: number[] = [];
    public includeSecond = false;

    get dependencies() {
        if (this.includeSecond) {
            return [this.dependency(this.first), this.dependency(this.second)];
        }
        return [this.dependency(this.first)];
    }
}

class DynamicComparisonNode extends ReactiveNode {
    public numbers: number[] = [];

    get dependencies() {
        return [this.dependency(this.numbers, [...this.numbers])];
    }
}

class ChangedEffectNode extends ReactiveNode {
    public value = 0;
    public syncedValue = 0;
    @ignore
    public effectRuns = 0;

    get dependencies() {
        return [];
    }

    protected onChanged(): void {
        if (this.syncedValue === this.value) {
            return;
        }

        this.syncedValue = this.value;
        this.effectRuns++;
    }
}

class NestedPayloadNode extends ReactiveNode {
    public payload = {
        stats: {
            count: 0,
        },
    };
    public items = [{ value: 1 }];

    get dependencies() {
        return [];
    }
}

class AutoPreparePayloadNode extends NestedPayloadNode {
    constructor(depth?: number) {
        super({
            prepare: {
                autoPrepare: true,
                depth,
            },
        });
    }
}

class ObservedLifecycleNode extends ReactiveNode {
    @ignore
    public dependenciesReadCount = 0;
    public localValue = 0;
    @ignore
    public observedCount = 0;
    @ignore
    public unobservedCount = 0;

    get dependencies() {
        this.dependenciesReadCount++;
        return [];
    }

    protected onObserved(): void {
        this.observedCount++;
    }

    protected onUnobserved(): void {
        this.unobservedCount++;
    }
}

class SharedDependencyTargetNode extends ReactiveNode {
    public values: number[] = [];

    get dependencies() {
        return [];
    }
}

class SharedDependencyNode extends ReactiveNode {
    constructor(public target: SharedDependencyTargetNode) {
        super();
    }

    get dependencies() {
        return [this.dependency(this.target.values)];
    }
}

class DuplicateDependencyNode extends ReactiveNode {
    constructor(public target: SharedDependencyTargetNode) {
        super();
    }

    get dependencies() {
        return [this.target.values, this.target.values];
    }
}

class CountingStableDependencyNode extends ReactiveNode {
    @ignore
    public dependenciesReadCount = 0;
    public localValue = 0;

    @ignore
    public target: SharedDependencyTargetNode;

    constructor(target: SharedDependencyTargetNode) {
        super();
        this.target = target;
    }

    get dependencies() {
        this.dependenciesReadCount++;
        return [this.dependency(this.target.values)];
    }
}

class CountingComparisonDependencyNode extends ReactiveNode {
    @ignore
    public dependenciesReadCount = 0;

    @ignore
    public target: SharedDependencyTargetNode;

    constructor(target: SharedDependencyTargetNode) {
        super();
        this.target = target;
    }

    get dependencies() {
        this.dependenciesReadCount++;
        return [
            this.dependency(this.target.values, [this.target.values.length]),
        ];
    }
}

class DirectDependencySyntaxNode extends ReactiveNode {
    public threshold = 0;

    constructor(public target: SharedDependencyTargetNode) {
        super();
    }

    get dependencies() {
        return [
            this.target.values,
            this.threshold,
            this.dependency(this.threshold),
        ];
    }
}

class ReplacingDependencyNode extends ReactiveNode {
    public useSecond = false;

    constructor(public first: number[], public second: number[]) {
        super();
    }

    get dependencies() {
        return [this.dependency(this.useSecond ? this.second : this.first)];
    }
}

class OptionalDependencyNode extends ReactiveNode {
    public dependencyNode: number[] | null | undefined = undefined;

    get dependencies() {
        return [
            this.dependency(this.dependencyNode, [
                this.dependencyNode?.length ?? null,
            ]),
        ];
    }
}

class DynamicDependencyTargetNode extends ReactiveNode {
    public items = Array.from({ length: 12 }, (_, index) => ({
        id: String(index),
        value: 0,
    }));

    get dependencies() {
        return [];
    }
}

class DynamicItemListDependencyNode extends ReactiveNode {
    public activeIds = Array.from({ length: 10 }, (_, index) => String(index));

    @ignore
    public target: DynamicDependencyTargetNode;

    constructor(target: DynamicDependencyTargetNode) {
        super();
        this.target = target;
    }

    get dependencies() {
        return this.activeIds.map(
            (id) => this.target.items.find((item) => item.id === id) ?? null
        );
    }
}

describe("ReactiveNode", () => {
    it("emits only when comparison values change", () => {
        const root = trackRoot(Retree.root(new EvenNumberNode()));
        const nodeChanged = vi.fn();

        Retree.on(root, "nodeChanged", nodeChanged);
        root.numbers.push(2);
        root.numbers.push(3);
        root.numbers.push(4);

        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(nodeChanged.mock.calls.at(-1)?.[0].evenNumberCount).toBe(2);
    });

    it("allows dependency list length changes and resubscribes", () => {
        const root = trackRoot(Retree.root(new DynamicDependencyNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        expect(() => {
            root.includeSecond = true;
        }).not.toThrow();

        root.second.push(1);

        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    it("emits when comparison list length changes for a dependency", () => {
        const root = trackRoot(Retree.root(new DynamicComparisonNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        expect(() => {
            root.numbers.push(1);
        }).not.toThrow();
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("accepts direct reactive and primitive dependency values", () => {
        const target = trackRoot(Retree.root(new SharedDependencyTargetNode()));
        const root = trackRoot(
            Retree.root(new DirectDependencySyntaxNode(target))
        );
        const nodeChanged = vi.fn();

        Retree.on(root, "nodeChanged", nodeChanged);
        target.values.push(1);

        expect(nodeChanged).toHaveBeenCalledTimes(1);

        const rawRoot = getUnproxiedNode(root);
        if (!rawRoot) {
            throw new Error("Expected root to be Retree managed.");
        }
        const activeDependencies = getReactiveDependencies(rawRoot);

        expect(activeDependencies?.[0]?.node).toBe(root.target.values);
        expect(activeDependencies?.[1]?.node).toBeUndefined();
        expect(activeDependencies?.[1]?.comparisons).toEqual([0]);
        expect(activeDependencies?.[2]?.node).toBeUndefined();
        expect(activeDependencies?.[2]?.comparisons).toEqual([0]);
    });

    it("supports dynamic dependency lists", () => {
        const target = trackRoot(
            Retree.root(new DynamicDependencyTargetNode())
        );
        const root = trackRoot(
            Retree.root(new DynamicItemListDependencyNode(target))
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.activeIds = ["0", "10"];
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        target.items[1].value = 1;
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        target.items[10].value = 1;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    it("unsubscribes removed dependencies even when another value takes the same position", () => {
        const target = trackRoot(
            Retree.root(new DynamicDependencyTargetNode())
        );
        const root = trackRoot(
            Retree.root(new DynamicItemListDependencyNode(target))
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        const rawRoot = getUnproxiedNode(root);
        const rawRemovedItem = getUnproxiedNode(target.items[9]);
        if (!rawRoot) {
            throw new Error("Expected dependent root to be Retree managed.");
        }
        if (!rawRemovedItem) {
            throw new Error("Expected removed item to be Retree managed.");
        }

        root.activeIds = ["8", "7", "6", "5", "4", "3", "2", "1", "0", "10"];
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        nodeChanged.mockClear();

        expect(
            getReactiveDependents(rawRemovedItem)?.some(
                (dependent) => dependent.unproxiedReactiveNode === rawRoot
            ) ?? false
        ).toBe(false);

        target.items[9].value = 1;
        expect(nodeChanged).not.toHaveBeenCalled();

        target.items[10].value = 1;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("does not run changed effects when the node is first observed", () => {
        const root = trackRoot(Retree.root(new ChangedEffectNode()));

        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.effectRuns).toBe(0);
        expect(root.syncedValue).toBe(0);
    });

    it("batches changed effect state updates with the triggering change", () => {
        const root = trackRoot(Retree.root(new ChangedEffectNode()));
        const nodeChanged = vi.fn((reproxy: ChangedEffectNode) => {
            expect(reproxy.value).toBe(1);
            expect(reproxy.syncedValue).toBe(1);
        });
        Retree.on(root, "nodeChanged", nodeChanged);

        root.value = 1;

        expect(root.effectRuns).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("adds changed effect updates to an existing transaction", () => {
        const root = trackRoot(Retree.root(new ChangedEffectNode()));
        const nodeChanged = vi.fn((reproxy: ChangedEffectNode) => {
            expect(reproxy.value).toBe(2);
            expect(reproxy.syncedValue).toBe(2);
        });
        Retree.on(root, "nodeChanged", nodeChanged);

        Retree.runTransaction(() => {
            root.value = 1;
            root.value = 2;
        });

        expect(root.effectRuns).toBe(2);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("runs observation lifecycle hooks outside dependencies", () => {
        const root = trackRoot(Retree.root(new ObservedLifecycleNode()));

        const unsubscribeNodeChanged = Retree.on(root, "nodeChanged", vi.fn());
        const unsubscribeTreeChanged = Retree.on(root, "treeChanged", vi.fn());

        expect(root.observedCount).toBe(1);
        expect(root.unobservedCount).toBe(0);
        expect(root.dependenciesReadCount).toBeGreaterThan(0);

        unsubscribeNodeChanged();
        expect(root.unobservedCount).toBe(0);

        unsubscribeTreeChanged();
        expect(root.unobservedCount).toBe(1);
    });

    it("lazily proxies ReactiveNode object and array fields with parent metadata", () => {
        const root = trackRoot(Retree.root(new NestedPayloadNode()));

        expect(Retree.parent(root.payload)).toBe(root);
        expect(Retree.parent(root.payload.stats)).toBe(root.payload);
        expect(Retree.parent(root.items)).toBe(root);
        expect(Retree.parent(root.items[0])).toBe(root.items);
    });

    it("emits from nested ReactiveNode fields after replacing a lazy object field", () => {
        const root = trackRoot(Retree.root(new NestedPayloadNode()));
        const statsChanged = vi.fn();

        root.payload = {
            stats: {
                count: 10,
            },
        };
        Retree.on(root.payload.stats, "nodeChanged", statsChanged);

        root.payload.stats.count = 11;

        expect(statsChanged).toHaveBeenCalledTimes(1);
    });

    it("prepares lazy ReactiveNode data fields without reading getters or ignored fields", () => {
        const root = trackRoot(Retree.root(new ObservedLifecycleNode()));
        const nested = trackRoot(Retree.root(new NestedPayloadNode()));
        const nestedHandler = getCustomProxyHandler(nested);
        if (nestedHandler === undefined) {
            throw new Error(
                "ReactiveNode prepareTree test expected nested root to expose proxy metadata."
            );
        }

        root.prepareTree();
        nested.prepareTree({ depth: 0 });

        expect(root.dependenciesReadCount).toBe(0);
        expect(nestedHandler[proxiedChildrenKey].payload).toBeDefined();
        expect(nestedHandler[proxiedChildrenKey].items).toBeDefined();

        const payloadHandler = getCustomProxyHandler(nested.payload);
        if (payloadHandler === undefined) {
            throw new Error(
                "ReactiveNode prepareTree test expected payload to expose proxy metadata."
            );
        }
        expect(payloadHandler[proxiedChildrenKey].stats).toBeUndefined();
    });

    it("auto prepares lazy ReactiveNode data fields when configured", () => {
        const root = trackRoot(Retree.root(new AutoPreparePayloadNode(0)));
        const rootHandler = getCustomProxyHandler(root);
        if (rootHandler === undefined) {
            throw new Error(
                "ReactiveNode auto prepare test expected root to expose proxy metadata."
            );
        }

        expect(rootHandler[proxiedChildrenKey].payload).toBeDefined();
        expect(rootHandler[proxiedChildrenKey].items).toBeDefined();

        const payloadHandler = getCustomProxyHandler(root.payload);
        if (payloadHandler === undefined) {
            throw new Error(
                "ReactiveNode auto prepare test expected payload to expose proxy metadata."
            );
        }
        expect(payloadHandler[proxiedChildrenKey].stats).toBeUndefined();
    });

    it("shares one Retree listener for many dependents on the same dependency node", () => {
        const target = trackRoot(Retree.root(new SharedDependencyTargetNode()));
        const first = trackRoot(Retree.root(new SharedDependencyNode(target)));
        const second = trackRoot(Retree.root(new SharedDependencyNode(target)));
        const onSpy = vi.spyOn(Retree, "on");

        const unsubscribeFirst = Retree.on(first, "nodeChanged", vi.fn());
        const unsubscribeSecond = Retree.on(second, "nodeChanged", vi.fn());

        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === target.values && listenerType === "nodeChanged"
            )
        ).toHaveLength(1);

        unsubscribeFirst();
        unsubscribeSecond();
        const third = trackRoot(Retree.root(new SharedDependencyNode(target)));
        const unsubscribeThird = Retree.on(third, "nodeChanged", vi.fn());

        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === target.values && listenerType === "nodeChanged"
            )
        ).toHaveLength(2);
        unsubscribeThird();
        onSpy.mockRestore();
    });

    it("keeps shared dependency listeners alive until the final dependent unsubscribes", () => {
        const target = trackRoot(Retree.root(new SharedDependencyTargetNode()));
        const first = trackRoot(Retree.root(new SharedDependencyNode(target)));
        const second = trackRoot(Retree.root(new SharedDependencyNode(target)));
        const firstChanged = vi.fn();
        const secondChanged = vi.fn();
        const unsubscribeFirst = Retree.on(first, "nodeChanged", firstChanged);
        const unsubscribeSecond = Retree.on(
            second,
            "nodeChanged",
            secondChanged
        );

        target.values.push(1);
        expect(firstChanged).toHaveBeenCalledTimes(1);
        expect(secondChanged).toHaveBeenCalledTimes(1);

        unsubscribeFirst();
        target.values.push(2);
        expect(firstChanged).toHaveBeenCalledTimes(1);
        expect(secondChanged).toHaveBeenCalledTimes(2);

        unsubscribeSecond();
        target.values.push(3);
        expect(firstChanged).toHaveBeenCalledTimes(1);
        expect(secondChanged).toHaveBeenCalledTimes(2);
    });

    it("emits once when the same dependency appears in multiple slots", () => {
        const target = trackRoot(Retree.root(new SharedDependencyTargetNode()));
        const dependent = trackRoot(
            Retree.root(new DuplicateDependencyNode(target))
        );
        const nodeChanged = vi.fn();

        Retree.on(dependent, "nodeChanged", nodeChanged);

        target.values.push(1);

        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("reads dependencies once per reactive-node update when dependency nodes stay stable", () => {
        const target = trackRoot(Retree.root(new SharedDependencyTargetNode()));
        const root = trackRoot(
            Retree.root(new CountingStableDependencyNode(target))
        );
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.dependenciesReadCount).toBe(1);

        root.localValue = 1;

        expect(root.dependenciesReadCount).toBe(2);
    });

    it("does not retain empty active dependency records for nodes without dependencies", () => {
        const root = trackRoot(Retree.root(new ObservedLifecycleNode()));
        Retree.on(root, "nodeChanged", vi.fn());
        const unproxiedRoot = getUnproxiedNode(root);
        if (unproxiedRoot === undefined) {
            throw new Error(
                "ReactiveNode test expected proxied root to have an unproxied node."
            );
        }

        expect(getReactiveDependencies(unproxiedRoot)).toBeUndefined();

        root.localValue = 2;

        expect(getReactiveDependencies(unproxiedRoot)).toBeUndefined();
    });

    it("updates dependency comparisons without resubscribing when dependency nodes stay stable", () => {
        const target = trackRoot(Retree.root(new SharedDependencyTargetNode()));
        const root = trackRoot(
            Retree.root(new CountingComparisonDependencyNode(target))
        );
        const nodeChanged = vi.fn();
        const onSpy = vi.spyOn(Retree, "on");
        Retree.on(root, "nodeChanged", nodeChanged);

        target.values.push(1);
        target.values.push(2);

        const targetValuesRaw = getUnproxiedNode(target.values);
        if (targetValuesRaw === undefined) {
            throw new Error(
                "ReactiveNode comparison dependency test expected target.values to be proxied."
            );
        }
        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    getUnproxiedNode(node) === targetValuesRaw &&
                    listenerType === "nodeChanged"
            )
        ).toHaveLength(1);
        expect(root.dependenciesReadCount).toBe(5);
        onSpy.mockRestore();
    });

    it("unsubscribes replaced dependency nodes and subscribes new dependency nodes", () => {
        const first = trackRoot(Retree.root<number[]>([]));
        const second = trackRoot(Retree.root<number[]>([]));
        const root = trackRoot(
            Retree.root(new ReplacingDependencyNode(first, second))
        );
        const nodeChanged = vi.fn();
        const onSpy = vi.spyOn(Retree, "on");
        Retree.on(root, "nodeChanged", nodeChanged);

        first.push(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        root.useSecond = true;
        nodeChanged.mockClear();
        first.push(2);
        second.push(1);

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === first && listenerType === "nodeChanged"
            )
        ).toHaveLength(1);
        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === second && listenerType === "nodeChanged"
            )
        ).toHaveLength(1);
        onSpy.mockRestore();
    });

    it("allows null and undefined dependency nodes as no-op dependency targets", () => {
        const root = trackRoot(Retree.root(new OptionalDependencyNode()));

        expect(() => {
            Retree.on(root, "nodeChanged", vi.fn());
        }).not.toThrow();
        expect(() => {
            root.dependencyNode = null;
        }).not.toThrow();
        expect(() => {
            root.dependencyNode = undefined;
        }).not.toThrow();
    });

    it("subscribes when an optional dependency changes from nullish to a real node", () => {
        const dependencyNode = trackRoot(Retree.root<number[]>([]));
        const root = trackRoot(Retree.root(new OptionalDependencyNode()));
        const nodeChanged = vi.fn();

        Retree.on(root, "nodeChanged", nodeChanged);
        root.dependencyNode = dependencyNode;
        nodeChanged.mockClear();

        dependencyNode.push(1);

        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });
});
