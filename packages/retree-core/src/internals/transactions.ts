/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";

/**
 * @internal
 */
export interface ITransaction {
    emitNodeChanged?: () => void;
    emitTreeChanged?: () => void;
    emitNodeRemoved?: () => void;
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
        }
        transaction = {
            ...transaction,
            ...upsertTransaction,
        };
        this.pendingTransactions.set(node, upsertTransaction);
    }

    /**
     * @internal
     * Run pending transactions and clear them once done.
     */
    static runPendingTransactions() {
        this.pendingTransactions.forEach((transaction) => {
            transaction.emitNodeChanged?.();
            transaction.emitTreeChanged?.();
            transaction.emitNodeRemoved?.();
        });
        this.pendingTransactions.clear();
    }
}
