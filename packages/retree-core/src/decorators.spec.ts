import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import { retreeIgnore } from "./decorators";
import { Transactions } from "./internals/transactions";

class IgnoredNode extends ReactiveNode {
    @retreeIgnore
    public ignored = { count: 0 };
    public count = 0;

    get dependencies() {
        return [];
    }
}

let root: IgnoredNode | null = null;

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

describe("retreeIgnore", () => {
    it("skips Retree listener emission for ignored nested objects", () => {
        root = Retree.use(new IgnoredNode());
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.ignored.count += 1;
        root.count += 1;

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.ignored.count).toBe(1);
    });
});
