import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
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

describe("ReactiveNode", () => {
    it("emits only when comparison values change", () => {
        const root = trackRoot(Retree.use(new EvenNumberNode()));
        const nodeChanged = vi.fn();

        Retree.on(root, "nodeChanged", nodeChanged);
        root.numbers.push(2);
        root.numbers.push(3);
        root.numbers.push(4);

        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(nodeChanged.mock.calls.at(-1)?.[0].evenNumberCount).toBe(2);
    });

    it("throws when dependency list length changes while subscribed", () => {
        const root = trackRoot(Retree.use(new DynamicDependencyNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(() => {
            root.includeSecond = true;
        }).toThrow(/dependencies/i);
    });

    it("throws when comparison list length changes for a dependency", () => {
        const root = trackRoot(Retree.use(new DynamicComparisonNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(() => {
            root.numbers.push(1);
        }).toThrow(/comparisons/i);
    });
});