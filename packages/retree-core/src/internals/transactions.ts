/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { INodeFieldChanges, TreeNode } from "../types.js";

/**
 * Optional wrapper around synchronous listener emission, injected by the
 * React integration to batch React 16/17 renders (`unstable_batchedUpdates`).
 * When unset (the default), emission runs directly with zero added overhead.
 */
let listenerFlushWrapper: ((flush: () => void) => void) | undefined;

/**
 * Register (or clear, with `undefined`) a wrapper that runs around every
 * synchronous listener flush: the whole transaction flush loop runs inside
 * one wrapper call, and non-transaction immediate emissions each run inside
 * one wrapper call. The wrapper MUST invoke `flush` synchronously exactly
 * once; deferring it would break Retree's synchronous emission guarantees.
 *
 * @internal
 */
export function setRetreeListenerFlushWrapper(
    wrapper: ((flush: () => void) => void) | undefined
): void {
    listenerFlushWrapper = wrapper;
}

/**
 * @internal
 */
export interface ITransaction {
    emitNodeChanged?: (changes: INodeFieldChanges[]) => void;
    emitTreeChanged?: (changes: INodeFieldChanges[]) => void;
    emitNodeRemoved?: () => void;
    nodeChanges?: INodeFieldChanges[];
    treeChanges?: INodeFieldChanges[];
}

/**
 * @internal
 * NOTE: It's important to use these only in synchronous operations.
 */
export class Transactions {
    /**
     * @internal
     * When true, we will skip emitting changes.
     */
    static skipEmit: boolean = false;

    /**
     * @internal
     * When true, we will skip reproxying nodes.
     */
    static skipReproxy: boolean = false;

    /**
     * @internal
     * When true, will only emit
     */
    static runningTransaction: boolean = false;

    /**
     * @internal
     * True while the running transaction is Retree's own wrapper around a
     * discrete out-of-transaction ReactiveNode emission rather than a user
     * `Retree.runTransaction`. Undo history reads this to treat the wrapped
     * flush as a discrete write (its own step, eligible for coalescing)
     * instead of a user-transaction step.
     */
    static runningInternalReactiveNodeTransaction: boolean = false;

    /**
     * @internal
     * Monotonic id of the current/most recent pending-transaction flush.
     * Listener callbacks that observe the same value while
     * {@link Transactions.runningTransaction} is true ran in the same flush;
     * undo history uses this to coalesce one transaction into one step.
     */
    static flushSequence: number = 0;

    /**
     * @internal
     * Pending TreeNode change transactions.
     * Each unique node can have one type of event listener.
     * Others will get replaced if another change happens during the transaction.
     */
    private static pendingTransactions: Map<TreeNode, ITransaction> = new Map();

    /**
     * @internal
     * Create/upsert a pending transaciton.
     *
     * @param node node that changed
     * @param upsertTransaction event listeners to insert/replace for the node
     */
    static upsertPendingTransaction(
        node: TreeNode,
        upsertTransaction: Partial<ITransaction>
    ) {
        let transaction = this.pendingTransactions.get(node);
        if (!transaction) {
            transaction = {};
            this.pendingTransactions.set(node, transaction);
        }
        if (upsertTransaction.emitNodeChanged !== undefined) {
            transaction.emitNodeChanged = upsertTransaction.emitNodeChanged;
        }
        if (upsertTransaction.emitTreeChanged !== undefined) {
            transaction.emitTreeChanged = upsertTransaction.emitTreeChanged;
        }
        if (upsertTransaction.emitNodeRemoved !== undefined) {
            transaction.emitNodeRemoved = upsertTransaction.emitNodeRemoved;
        }
        if (upsertTransaction.nodeChanges !== undefined) {
            transaction.nodeChanges = [
                ...(transaction.nodeChanges ?? []),
                ...upsertTransaction.nodeChanges,
            ];
        }
        if (upsertTransaction.treeChanges !== undefined) {
            transaction.treeChanges = [
                ...(transaction.treeChanges ?? []),
                ...upsertTransaction.treeChanges,
            ];
        }
    }

    /**
     * @internal
     * Run pending transactions and clear them once done.
     * The whole flush loop runs inside one listener-flush wrapper call (when
     * registered), so a multi-node transaction batches into one wrapper pass.
     */
    static runPendingTransactions() {
        this.flushSequence++;
        try {
            this.runListenerFlush(() => {
                this.pendingTransactions.forEach((transaction) => {
                    transaction.emitNodeChanged?.(
                        transaction.nodeChanges ?? []
                    );
                    transaction.emitTreeChanged?.(
                        transaction.treeChanges ?? []
                    );
                    transaction.emitNodeRemoved?.();
                });
            });
        } finally {
            // A listener failure should surface to the caller, but stale queued callbacks must not replay on later updates.
            this.pendingTransactions.clear();
        }
    }

    /**
     * @internal
     * Run a synchronous listener flush through the registered wrapper, or
     * directly when none is registered.
     */
    static runListenerFlush(flush: () => void): void {
        if (listenerFlushWrapper === undefined) {
            flush();
            return;
        }
        listenerFlushWrapper(flush);
    }
}
