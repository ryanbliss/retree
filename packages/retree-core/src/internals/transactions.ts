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
 * Hook that runs deferred ReactiveNode lifecycle work (dependency collection
 * and `@select` value capture) for nodes written during a transaction. It is
 * invoked before each pending emission and once after the last one, so
 * lifecycle passes always observe settled state — never the torn state
 * between two writes of one transaction.
 */
let transactionLifecycleDrain: (() => void) | undefined;

/**
 * Register (or clear, with `undefined`) the deferred-lifecycle drain invoked
 * around pending-transaction emissions. The drain MUST be synchronous and
 * idempotent when nothing is pending.
 *
 * @internal
 */
export function setTransactionLifecycleDrain(
    drain: (() => void) | undefined
): void {
    transactionLifecycleDrain = drain;
}

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

interface IPendingTransaction
    extends Omit<ITransaction, "nodeChanges" | "treeChanges"> {
    nodeChanges?: INodeFieldChanges[][];
    treeChanges?: INodeFieldChanges[][];
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
    private static pendingTransactions: Map<TreeNode, IPendingTransaction> =
        new Map();

    /**
     * @internal
     * Nodes whose scheduled emission has already run in the current flush.
     * Distinguishes "emission still pending" from "emission processed" for
     * {@link Transactions.hasPendingEmissionFor}: after a node's emission has
     * validated its dependents, their baselines must refresh normally again.
     */
    private static processedEmissionNodes: Set<TreeNode> = new Set();

    /**
     * @internal
     * True when `node` has an emission scheduled in the current flush that
     * has not run yet. The deferred-lifecycle drain uses this to keep a
     * dependent's stored "previous" comparison/select baselines intact for
     * dependencies whose change has not been validated yet — overwriting
     * them with post-write values would absorb the pending change instead of
     * notifying it.
     */
    static hasPendingEmissionFor(node: TreeNode): boolean {
        if (!this.pendingTransactions.has(node)) {
            return false;
        }
        return !this.processedEmissionNodes.has(node);
    }

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
            (transaction.nodeChanges ??= []).push([
                ...upsertTransaction.nodeChanges,
            ]);
        }
        if (upsertTransaction.treeChanges !== undefined) {
            (transaction.treeChanges ??= []).push([
                ...upsertTransaction.treeChanges,
            ]);
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
                // Map iterators visit entries inserted during iteration, so
                // emissions scheduled by listeners mid-flush are processed in
                // this same loop — matching the previous forEach semantics.
                // The lifecycle drain runs before each emission (and once
                // after the last) so deferred dependency/@select passes always
                // observe settled state, including writes made by listeners
                // earlier in the same flush.
                for (const [
                    node,
                    transaction,
                ] of this.pendingTransactions.entries()) {
                    transactionLifecycleDrain?.();
                    this.processedEmissionNodes.add(node);
                    transaction.emitNodeChanged?.(
                        transaction.nodeChanges?.flat() ?? []
                    );
                    transaction.emitTreeChanged?.(
                        transaction.treeChanges?.flat() ?? []
                    );
                    transaction.emitNodeRemoved?.();
                }
                transactionLifecycleDrain?.();
            });
        } finally {
            try {
                // The drain must also run when a listener threw mid-flush
                // (queued lifecycle passes would otherwise leave stale
                // subscriptions indefinitely) and after the listener-flush
                // wrapper returns — React's batched-updates wrapper can
                // commit renders, and thereby subscribe new observers, after
                // `flush()` but before this point.
                transactionLifecycleDrain?.();
            } finally {
                // A listener failure should surface to the caller, but stale queued callbacks must not replay on later updates.
                this.pendingTransactions.clear();
                this.processedEmissionNodes.clear();
            }
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
