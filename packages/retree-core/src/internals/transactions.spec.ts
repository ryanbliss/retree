import { afterEach, describe, expect, it, vi } from "vitest";
import { setRetreeListenerFlushWrapper, Transactions } from "./transactions.js";

afterEach(() => {
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
    setRetreeListenerFlushWrapper(undefined);
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

    it("wraps a multi-node pending flush in exactly one listener-flush wrapper call", () => {
        const firstNode = {};
        const secondNode = {};
        const emissionsInsideWrapper: string[] = [];
        let wrapperCalls = 0;
        setRetreeListenerFlushWrapper((flush) => {
            wrapperCalls += 1;
            flush();
        });

        Transactions.upsertPendingTransaction(firstNode, {
            emitNodeChanged: () => emissionsInsideWrapper.push("first"),
        });
        Transactions.upsertPendingTransaction(secondNode, {
            emitNodeChanged: () => emissionsInsideWrapper.push("second"),
            emitNodeRemoved: () => emissionsInsideWrapper.push("removed"),
        });

        Transactions.runPendingTransactions();

        expect(wrapperCalls).toBe(1);
        expect(emissionsInsideWrapper).toEqual(["first", "second", "removed"]);
    });

    it("wrapper must run the flush synchronously; listeners observe it inline", () => {
        const events: string[] = [];
        setRetreeListenerFlushWrapper((flush) => {
            events.push("wrapper-start");
            flush();
            events.push("wrapper-end");
        });
        Transactions.upsertPendingTransaction(
            {},
            {
                emitNodeChanged: () => events.push("emit"),
            }
        );

        Transactions.runPendingTransactions();
        expect(events).toEqual(["wrapper-start", "emit", "wrapper-end"]);
    });

    it("flushes directly with zero wrapper involvement when unset", () => {
        const emit = vi.fn();
        Transactions.upsertPendingTransaction({}, { emitNodeChanged: emit });
        Transactions.runPendingTransactions();
        expect(emit).toHaveBeenCalledTimes(1);
    });

    it("clears pending transactions even when the wrapped flush throws", () => {
        setRetreeListenerFlushWrapper((flush) => flush());
        const secondRunEmit = vi.fn();
        Transactions.upsertPendingTransaction(
            {},
            {
                emitNodeChanged: () => {
                    throw new Error("listener boom");
                },
            }
        );

        expect(() => Transactions.runPendingTransactions()).toThrow(
            "listener boom"
        );

        // Stale queued callbacks must not replay on the next flush.
        Transactions.upsertPendingTransaction(
            {},
            {
                emitNodeChanged: secondRunEmit,
            }
        );
        Transactions.runPendingTransactions();
        expect(secondRunEmit).toHaveBeenCalledTimes(1);
    });
});
