import { afterEach, describe, expect, it, vi } from "vitest";
import { Transactions } from "./transactions";

afterEach(() => {
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

describe("Transactions", () => {
    it("upserts pending transaction callbacks without clearing omitted callbacks", () => {
        const node = {};
        const firstNodeChanged = vi.fn();
        const nextNodeChanged = vi.fn();
        const treeChanged = vi.fn();
        const nodeRemoved = vi.fn();

        Transactions.upsertPendingTransaction(node, {
            emitNodeChanged: firstNodeChanged,
            emitTreeChanged: treeChanged,
        });
        Transactions.upsertPendingTransaction(node, {
            emitNodeChanged: nextNodeChanged,
        });
        Transactions.upsertPendingTransaction(node, {
            emitNodeRemoved: nodeRemoved,
        });

        Transactions.runPendingTransactions();

        expect(firstNodeChanged).not.toHaveBeenCalled();
        expect(nextNodeChanged).toHaveBeenCalledTimes(1);
        expect(treeChanged).toHaveBeenCalledTimes(1);
        expect(nodeRemoved).toHaveBeenCalledTimes(1);
    });
});
