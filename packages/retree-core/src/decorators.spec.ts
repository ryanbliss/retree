import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import { ignore } from "./decorators";
import { Transactions } from "./internals/transactions";

class IgnoredNode extends ReactiveNode {
    @ignore
    public ignored = { count: 0 };
    public count = 0;

    get dependencies() {
        return [];
    }
}

class IgnoredPointerNode extends ReactiveNode {
    public child = { value: 0 };

    @ignore
    public selected: { value: number } | null = null;

    get dependencies() {
        return [];
    }
}

class IgnoredExternalPointerNode extends ReactiveNode {
    @ignore
    public selected: { value: number } | null = null;

    get dependencies() {
        return [];
    }
}

let root: ReactiveNode | null = null;

afterEach(() => {
    if (root) {
        Retree.clearListeners(root, false);
    }
    root = null;
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

describe("ignore", () => {
    it("skips Retree listener emission for ignored nested objects", () => {
        root = Retree.root(new IgnoredNode());
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.ignored.count += 1;
        root.count += 1;

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.ignored.count).toBe(1);
    });

    it("does not emit when an ignored field is set to a proxied node", () => {
        const state = Retree.root(new IgnoredPointerNode());
        root = state;
        const nodeChanged = vi.fn();
        Retree.on(state, "nodeChanged", nodeChanged);

        state.selected = state.child;

        expect(nodeChanged).not.toHaveBeenCalled();
    });

    it("does not reparent a proxied node stored in an ignored field", () => {
        const source = Retree.root({ child: { value: 0 } });
        const owner = Retree.root(new IgnoredExternalPointerNode());
        root = owner;

        owner.selected = source.child;

        if (!owner.selected) {
            throw new Error(
                "Expected ignored field to store the selected source child."
            );
        }
        expect(Retree.parent(owner.selected)).toBe(source);
    });

    it("returns the latest reproxy for a proxied node stored in an ignored field", () => {
        const state = Retree.root(new IgnoredPointerNode());
        root = state;
        state.selected = state.child;

        const selectedBeforeChange = state.selected;
        if (!selectedBeforeChange) {
            throw new Error(
                "Expected ignored field to return the selected child before mutation."
            );
        }

        state.child.value = 1;

        const selectedAfterChange = state.selected;
        if (!selectedAfterChange) {
            throw new Error(
                "Expected ignored field to return the selected child after mutation."
            );
        }
        expect(selectedAfterChange).not.toBe(selectedBeforeChange);
        expect(selectedAfterChange.value).toBe(1);
    });
});
