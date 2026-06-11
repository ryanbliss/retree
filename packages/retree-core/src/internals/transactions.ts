/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { INodeFieldChanges, TreeNode } from "../types";

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
     */
    static runPendingTransactions() {
        try {
            this.pendingTransactions.forEach((transaction) => {
                transaction.emitNodeChanged?.(transaction.nodeChanges ?? []);
                transaction.emitTreeChanged?.(transaction.treeChanges ?? []);
                transaction.emitNodeRemoved?.();
            });
        } finally {
            // A listener failure should surface to the caller, but stale queued callbacks must not replay on later updates.
            this.pendingTransactions.clear();
        }
    }
}
