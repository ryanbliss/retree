/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Transactions } from "./internals/transactions.js";
import { Retree } from "./Retree.js";
import { INodeFieldChanges, TreeNode } from "./types.js";

/**
 * Options for {@link createUndoHistory}.
 */
export interface RetreeUndoHistoryOptions {
    /**
     * Maximum number of undo steps to retain. When the history grows past
     * the limit, the oldest step is dropped. Defaults to 100.
     */
    limit?: number;
    /**
     * Optional predicate that merges a new discrete change into the previous
     * undo step instead of starting a new one.
     *
     * @remarks
     * Called for changes recorded outside a user `Retree.runTransaction`
     * (changes inside one transaction always coalesce into one step). A
     * discrete `ReactiveNode` field write counts as outside a transaction
     * even though Retree flushes it through an internal one. Receives the
     * previous step's records and the incoming records; return `true` to
     * append the incoming records to the previous step. Use this to fold
     * bursts of tiny writes — e.g. per-keystroke text edits to the same
     * field — into one undoable step.
     */
    coalesce?: (
        previous: INodeFieldChanges[],
        next: INodeFieldChanges[]
    ) => boolean;
}

/**
 * Undo/redo controller returned by {@link createUndoHistory}.
 */
export interface IRetreeUndoHistory {
    /**
     * Apply the inverse of the most recent recorded step.
     *
     * @remarks
     * The step moves to the redo stack. Applying emits normally — listeners
     * and React re-render — but is not recorded as a new step. That holds
     * inside a `Retree.runTransaction` too: the transaction flush carrying
     * the applied records is skipped by recording, so avoid mixing `undo`/
     * `redo` with unrelated writes in one transaction — those writes flush
     * together with the applied records and are skipped with them.
     *
     * @returns `true` when a step was undone; `false` when the history was
     * empty.
     */
    undo(): boolean;
    /**
     * Replay the most recently undone step.
     *
     * @returns `true` when a step was redone; `false` when there was nothing
     * to redo.
     */
    redo(): boolean;
    /** True when at least one recorded step can be undone. */
    readonly canUndo: boolean;
    /** True when at least one undone step can be redone. */
    readonly canRedo: boolean;
    /** Drop all recorded undo and redo steps without touching state. */
    clear(): void;
    /**
     * Stop recording and drop all steps. The history is unusable afterwards;
     * `undo`/`redo` return `false`.
     */
    dispose(): void;
}

interface IHistoryEntry {
    changes: INodeFieldChanges[];
    /**
     * Identity set of the records in `changes`. A change that reaches the
     * root through more than one path in the same flush (e.g. a ReactiveNode
     * forwarding its dependency's records while the dependency also lives in
     * the tree) arrives as the same record objects; recording each object
     * once keeps undo from applying it twice.
     */
    recordSet: Set<INodeFieldChanges>;
    /**
     * `Transactions.flushSequence` of the transaction flush this entry was
     * recorded in, or `undefined` for a discrete (non-transaction) emission.
     * Later callbacks from the same flush coalesce into this entry.
     */
    flushSequence: number | undefined;
}

const DEFAULT_UNDO_HISTORY_LIMIT = 100;

/**
 * Record every change under `root` into an undo/redo history built on
 * attributable change records.
 *
 * @remarks
 * The history subscribes to `treeChanged` on `root` and records each change
 * batch as one step: everything flushed by one {@link Retree.runTransaction}
 * is one step, and each discrete write outside a transaction is its own step
 * (see {@link RetreeUndoHistoryOptions.coalesce} to merge discrete writes).
 * `undo()` applies a step's inverse with {@link Retree.applyInverse} and
 * `redo()` replays it with {@link Retree.applyChanges}; both emit normally —
 * listeners and React re-render — without being recorded as new steps.
 *
 * New writes recorded after an undo truncate the redo stack, exactly like a
 * text editor. Steps beyond `limit` (default 100) drop oldest-first.
 *
 * Call `dispose()` during teardown to remove the `treeChanged` subscription.
 *
 * @param root Retree-managed node to record; typically a {@link Retree.root}
 * result. Only changes to this node and its descendants are recorded.
 * @param options Optional {@link RetreeUndoHistoryOptions}.
 * @returns An {@link IRetreeUndoHistory} controller.
 *
 * @example
 * ```ts
 * const project = Retree.root({ tasks: [{ title: "Docs", done: false }] });
 * const history = createUndoHistory(project);
 *
 * project.tasks[0].done = true;
 * project.tasks.push({ title: "Tests", done: false });
 *
 * history.undo(); // ✅ push undone; tasks has one entry
 * history.undo(); // ✅ done back to false
 * history.redo(); // ✅ done true again
 * history.dispose();
 * ```
 */
export function createUndoHistory(
    root: TreeNode,
    options: RetreeUndoHistoryOptions = {}
): IRetreeUndoHistory {
    const limit = options.limit ?? DEFAULT_UNDO_HISTORY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) {
        // @retree-throws
        throw new Error(
            `createUndoHistory: expected options.limit to be an integer of at least 1, but received ${String(
                options.limit
            )}. This is a caller argument error. Fix: pass a positive integer limit, or omit it for the default of ${DEFAULT_UNDO_HISTORY_LIMIT}.`
        );
    }

    let undoStack: IHistoryEntry[] = [];
    let redoStack: IHistoryEntry[] = [];
    let applyingHistory = false;
    /**
     * `Transactions.flushSequence` of the flush that will carry records from
     * an undo/redo applied inside an outer user transaction. Those records
     * flush after `applyingHistory` resets, so the flush itself is marked to
     * be skipped; recording it would push the undo back onto the undo stack
     * as a fresh step and truncate the redo stack.
     */
    let suppressedFlushSequence: number | undefined;
    let disposed = false;

    const appendRecords = (
        entry: IHistoryEntry,
        changes: INodeFieldChanges[]
    ) => {
        for (const record of changes) {
            if (entry.recordSet.has(record)) {
                continue;
            }
            entry.recordSet.add(record);
            entry.changes.push(record);
        }
    };

    const recordChanges = (_node: TreeNode, changes: INodeFieldChanges[]) => {
        // Recording-suspended flag (not runSilent): undo/redo writes must
        // still emit so the UI re-renders; they just must not record.
        if (applyingHistory) {
            return;
        }
        if (suppressedFlushSequence !== undefined) {
            if (
                Transactions.runningTransaction &&
                Transactions.flushSequence === suppressedFlushSequence
            ) {
                // This flush carries the records of an undo/redo applied
                // inside an outer user transaction; recording it would turn
                // the undo into a new step and truncate the redo stack.
                return;
            }
            suppressedFlushSequence = undefined;
        }
        if (changes.length === 0) {
            return;
        }
        redoStack = [];
        const lastEntry = undoStack[undoStack.length - 1];
        // Retree wraps discrete out-of-transaction ReactiveNode emissions in
        // an internal transaction; those flushes are discrete writes for
        // history purposes, not user-transaction steps.
        const inTransactionFlush =
            Transactions.runningTransaction &&
            !Transactions.runningInternalReactiveNodeTransaction;
        if (
            inTransactionFlush &&
            lastEntry !== undefined &&
            lastEntry.flushSequence === Transactions.flushSequence
        ) {
            // Same transaction flush: one transaction is one undo step.
            appendRecords(lastEntry, changes);
            return;
        }
        if (
            !inTransactionFlush &&
            lastEntry !== undefined &&
            options.coalesce !== undefined &&
            options.coalesce(lastEntry.changes, changes)
        ) {
            appendRecords(lastEntry, changes);
            // The merged entry is no longer a single flush; stop matching
            // future transaction flushes against it.
            lastEntry.flushSequence = undefined;
            return;
        }
        const entry: IHistoryEntry = {
            changes: [],
            recordSet: new Set(),
            flushSequence: inTransactionFlush
                ? Transactions.flushSequence
                : undefined,
        };
        appendRecords(entry, changes);
        undoStack.push(entry);
        if (undoStack.length > limit) {
            undoStack.shift();
        }
    };

    const unsubscribe = Retree.on(root, "treeChanged", recordChanges);

    const applyEntry = (entry: IHistoryEntry, direction: "undo" | "redo") => {
        applyingHistory = true;
        try {
            if (direction === "undo") {
                Retree.applyInverse(entry.changes);
            } else {
                Retree.applyChanges(entry.changes);
            }
        } finally {
            applyingHistory = false;
            if (Transactions.runningTransaction) {
                // Called inside an outer user transaction: the applied
                // records are still pending and will flush after the
                // `applyingHistory` reset above, so mark that upcoming flush
                // (`flushSequence` increments as the flush starts) to be
                // skipped by recordChanges.
                suppressedFlushSequence = Transactions.flushSequence + 1;
            }
        }
    };

    return {
        undo(): boolean {
            const entry = undoStack[undoStack.length - 1];
            if (entry === undefined) {
                return false;
            }
            applyEntry(entry, "undo");
            undoStack.pop();
            redoStack.push(entry);
            return true;
        },
        redo(): boolean {
            const entry = redoStack[redoStack.length - 1];
            if (entry === undefined) {
                return false;
            }
            applyEntry(entry, "redo");
            redoStack.pop();
            undoStack.push(entry);
            return true;
        },
        get canUndo(): boolean {
            return undoStack.length > 0;
        },
        get canRedo(): boolean {
            return redoStack.length > 0;
        },
        clear(): void {
            undoStack = [];
            redoStack = [];
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            unsubscribe();
            undoStack = [];
            redoStack = [];
        },
    };
}
