import { afterEach, describe, expect, it, vi } from "vitest";
import { setRetreeListenerFlushWrapper, Transactions } from "./transactions.js";
import { Retree } from "../Retree.js";
import type { INodeFieldChanges } from "../types.js";

afterEach(() => {
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
    setRetreeListenerFlushWrapper(undefined);
});

describe("Transactions", () => {
    it("keeps delivered records stable when a listener queues more changes", () => {
        const node = {};
        const first: INodeFieldChanges = {
            node,
            key: "value",
            previous: 0,
            new: 1,
        };
        const second: INodeFieldChanges = {
            node,
            key: "value",
            previous: 1,
            new: 2,
        };
        const input = [first];
        let delivered: INodeFieldChanges[] = [];
        let treeRecords: INodeFieldChanges[] = [];
        Transactions.upsertPendingTransaction(node, {
            nodeChanges: input,
            treeChanges: input,
            emitNodeChanged(records) {
                delivered = records;
                Transactions.upsertPendingTransaction(node, {
                    nodeChanges: [second],
                    treeChanges: [second],
                });
            },
            emitTreeChanged(records) {
                treeRecords = records;
            },
        });
        input.length = 0;
        Transactions.runPendingTransactions();
        expect(delivered).toEqual([first]);
        expect(treeRecords).toEqual([first, second]);
    });

    it("handles a deep tree without scheduling payloads for unobserved ancestors", () => {
        interface Branch {
            value: number;
            child?: Branch;
        }
        let input: Branch = { value: 0 };
        for (let depth = 0; depth < 5000; depth++)
            input = { value: 0, child: input };
        const root = Retree.root(input);
        let leaf = root;
        while (leaf.child !== undefined) leaf = leaf.child;
        const listener = vi.fn();
        const unsubscribe = Retree.on(root, "treeChanged", listener);
        const upsert = vi.spyOn(Transactions, "upsertPendingTransaction");
        try {
            Retree.runTransaction(() => {
                leaf.value = 1;
                leaf.value = 2;
            });
            expect(listener).toHaveBeenCalledTimes(1);
            expect(
                listener.mock.calls[0][1].map(
                    (record: INodeFieldChanges) => record.new
                )
            ).toEqual([1, 2]);
            expect(upsert).toHaveBeenCalledTimes(4);
        } finally {
            upsert.mockRestore();
            unsubscribe();
        }
    });

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
