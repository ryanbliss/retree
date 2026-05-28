import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import { ignore } from "./decorators";
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

class ObservedLifecycleNode extends ReactiveNode {
    @ignore
    public dependenciesReadCount = 0;
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

    it("throws when dependency list length changes while subscribed", () => {
        const root = trackRoot(Retree.root(new DynamicDependencyNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(() => {
            root.includeSecond = true;
        }).toThrow(/dependencies/i);
    });

    it("throws when comparison list length changes for a dependency", () => {
        const root = trackRoot(Retree.root(new DynamicComparisonNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(() => {
            root.numbers.push(1);
        }).toThrow(/comparisons/i);
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
});
