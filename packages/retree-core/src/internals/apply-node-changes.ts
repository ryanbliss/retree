/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { INodeFieldChanges, TreeNode } from "../types.js";
import { getManagedProxyForUnproxiedNode } from "./reproxy.js";

/**
 * Shared record-application core behind `Retree.applyInverse` (backward) and
 * `Retree.applyChanges` (forward). Callers wrap the whole application in one
 * `Retree.runTransaction`; these functions only translate records into
 * managed-node mutations.
 *
 * Change records carry raw nodes and raw values (`change-records` spec), so
 * every record's node is resolved back to its managed node before mutating —
 * writes must emit like any user write so listeners (and React) observe the
 * restoration.
 */

type TChangeApiName = "Retree.applyInverse" | "Retree.applyChanges";

/**
 * Apply the inverse of a change batch: records are walked in reverse order
 * and each one's `previous` state is restored.
 */
export function applyNodeFieldChangesInverse(
    changes: readonly INodeFieldChanges[],
    apiName: TChangeApiName
): void {
    for (let index = changes.length - 1; index >= 0; index--) {
        const record = changes[index];
        if (Array.isArray(record.node) && record.op === "remove") {
            // Removal runs must be re-inserted in forward order: their
            // indices are pre-removal coordinates, so each re-insert assumes
            // the earlier (lower-index) elements of the run are back first.
            const runStart = findArrayRemoveRunStart(changes, index);
            for (let runIndex = runStart; runIndex <= index; runIndex++) {
                applyInverseArrayRemove(changes[runIndex], apiName);
            }
            index = runStart;
            continue;
        }
        if (
            record.op === "clear" &&
            (record.node instanceof Map || record.node instanceof Set)
        ) {
            // A clear's per-entry "delete" records must be re-inserted in
            // forward (original insertion) order: iteration order is
            // observable, and the plain reverse walk would restore the
            // entries backwards.
            const runStart = findClearRunStart(changes, index, apiName);
            for (let runIndex = runStart; runIndex < index; runIndex++) {
                applyInverseRecord(changes[runIndex], apiName);
            }
            index = runStart;
            continue;
        }
        applyInverseRecord(record, apiName);
    }
}

/**
 * Replay a change batch forward: records are walked in emission order and
 * each one's `new` state is applied.
 */
export function applyNodeFieldChangesForward(
    changes: readonly INodeFieldChanges[],
    apiName: TChangeApiName
): void {
    for (let index = 0; index < changes.length; index++) {
        const record = changes[index];
        if (Array.isArray(record.node) && record.op === "remove") {
            // A removal run's indices are pre-removal coordinates, so the
            // whole run collapses to one splice at the run's start index.
            const runEnd = findArrayRemoveRunEnd(changes, index);
            const managedArray = resolveManagedArray(record, apiName);
            managedArray.splice(
                toArrayIndex(record, apiName),
                runEnd - index + 1
            );
            index = runEnd;
            continue;
        }
        applyForwardRecord(record, apiName);
    }
}

/**
 * Invert one array `remove` record by splicing the removed raw value back in
 * at its recorded pre-removal index.
 */
function applyInverseArrayRemove(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): void {
    const managedArray = resolveManagedArray(record, apiName);
    managedArray.splice(toArrayIndex(record, apiName), 0, record.previous);
}

/**
 * Walk backward from `endIndex` to the first record of the removal run it
 * terminates: adjacent `remove` records on the same array with consecutive
 * ascending indices always come from one structural method call.
 */
function findArrayRemoveRunStart(
    changes: readonly INodeFieldChanges[],
    endIndex: number
): number {
    let runStart = endIndex;
    while (
        runStart > 0 &&
        isAdjacentArrayRemovePair(changes[runStart - 1], changes[runStart])
    ) {
        runStart--;
    }
    return runStart;
}

/**
 * Forward counterpart of {@link findArrayRemoveRunStart}: last record of the
 * removal run starting at `startIndex`.
 */
function findArrayRemoveRunEnd(
    changes: readonly INodeFieldChanges[],
    startIndex: number
): number {
    let runEnd = startIndex;
    while (
        runEnd < changes.length - 1 &&
        isAdjacentArrayRemovePair(changes[runEnd], changes[runEnd + 1])
    ) {
        runEnd++;
    }
    return runEnd;
}

/**
 * First index of the per-entry "delete" records emitted by the `Map.clear`/
 * `Set.clear` whose summary record sits at `clearIndex`. The clear wrapper
 * emits exactly one delete record per discarded entry immediately before the
 * summary record, and the summary's `previous` carries the discarded size, so
 * the run is the `previous` records directly preceding the summary.
 */
function findClearRunStart(
    changes: readonly INodeFieldChanges[],
    clearIndex: number,
    apiName: TChangeApiName
): number {
    const clearRecord = changes[clearIndex];
    if (typeof clearRecord.previous !== "number") {
        // @retree-throws
        throw new Error(
            `${apiName}: a Map/Set 'clear' change record carries a non-number previous size. Clear records always carry the discarded entry count, so this record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    const runStart = clearIndex - clearRecord.previous;
    if (runStart < 0) {
        // @retree-throws
        throw new Error(
            `${apiName}: a Map/Set 'clear' change record claims ${clearRecord.previous} discarded entries, but only ${clearIndex} records precede it. Clear summary records always follow one delete record per discarded entry, so this record set was likely truncated or reordered. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    for (let runIndex = runStart; runIndex < clearIndex; runIndex++) {
        if (!isClearEntryDeleteRecord(changes[runIndex], clearRecord.node)) {
            // @retree-throws
            throw new Error(
                `${apiName}: the record at offset ${
                    runIndex - runStart
                } of a Map/Set 'clear' run is not a per-entry delete record for the cleared collection. Clear summary records always follow one delete record per discarded entry, so this record set was likely reordered or corrupted. Fix: pass change records exactly as Retree emitted them.`
            );
        }
    }
    return runStart;
}

/**
 * True when `record` is one of the per-entry records a `clear` emits for the
 * given collection: Map clears mark each entry record with `op: "delete"`,
 * while Set clears emit `key: "delete"` member records (the same shape
 * `Set.delete` emits).
 */
function isClearEntryDeleteRecord(
    record: INodeFieldChanges,
    clearedNode: TreeNode
): boolean {
    if (record.node !== clearedNode) {
        return false;
    }
    if (clearedNode instanceof Map) {
        return record.op === "delete";
    }
    return record.key === "delete";
}

function isAdjacentArrayRemovePair(
    earlier: INodeFieldChanges,
    later: INodeFieldChanges
): boolean {
    if (earlier.op !== "remove" || later.op !== "remove") {
        return false;
    }
    if (earlier.node !== later.node) {
        return false;
    }
    if (typeof earlier.key !== "string" || typeof later.key !== "string") {
        return false;
    }
    return Number(earlier.key) + 1 === Number(later.key);
}

function applyInverseRecord(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): void {
    if (record.node instanceof Map) {
        const managedMap = resolveManagedNode(record, apiName) as Map<
            unknown,
            unknown
        >;
        if (record.op === "clear") {
            // Summary record; the per-entry "delete" records in the same set
            // restore the discarded entries.
            return;
        }
        if (record.op === "add") {
            managedMap.delete(record.key);
            return;
        }
        // Plain overwrite or "delete": both restore the previous value.
        managedMap.set(record.key, record.previous);
        return;
    }
    if (record.node instanceof Set) {
        const managedSet = resolveManagedNode(record, apiName) as Set<unknown>;
        if (record.op === "clear") {
            // Summary record; per-member "delete" records restore.
            return;
        }
        if (record.key === "add") {
            managedSet.delete(record.new);
            return;
        }
        if (record.key === "delete") {
            managedSet.add(record.previous);
            return;
        }
        throwUnknownSetRecord(record, apiName);
        return;
    }
    if (record.node instanceof Date) {
        const managedDate = resolveManagedNode(record, apiName) as Date;
        managedDate.setTime(assertNumericDateValue(record.previous, apiName));
        return;
    }
    if (Array.isArray(record.node)) {
        const managedArray = resolveManagedArray(record, apiName);
        if (record.op === "insert") {
            managedArray.splice(toArrayIndex(record, apiName), 1);
            return;
        }
        if (record.op === "length") {
            // Bookkeeping record: inverting the insert/remove records in the
            // same set already restored the length.
            return;
        }
        if (record.key === "length") {
            // Direct `array.length = n` assignment. A shrinking assignment
            // discarded elements without records, so only the length itself
            // can be restored.
            managedArray.length = assertNumericLengthValue(
                record.previous,
                apiName
            );
            return;
        }
        applyInverseObjectRecord(
            managedArray as unknown as Record<PropertyKey, unknown>,
            record,
            apiName
        );
        return;
    }
    const managedObject = resolveManagedNode(record, apiName) as Record<
        PropertyKey,
        unknown
    >;
    applyInverseObjectRecord(managedObject, record, apiName);
}

function applyInverseObjectRecord(
    managedNode: Record<PropertyKey, unknown>,
    record: INodeFieldChanges,
    apiName: TChangeApiName
): void {
    const key = toPropertyKey(record, apiName);
    if (record.op === "add") {
        delete managedNode[key];
        return;
    }
    // Plain rewrite or "delete": both restore the previous value at the key.
    managedNode[key] = record.previous;
}

function applyForwardRecord(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): void {
    if (record.node instanceof Map) {
        const managedMap = resolveManagedNode(record, apiName) as Map<
            unknown,
            unknown
        >;
        if (record.op === "clear") {
            managedMap.clear();
            return;
        }
        if (record.op === "delete") {
            managedMap.delete(record.key);
            return;
        }
        managedMap.set(record.key, record.new);
        return;
    }
    if (record.node instanceof Set) {
        const managedSet = resolveManagedNode(record, apiName) as Set<unknown>;
        if (record.op === "clear") {
            managedSet.clear();
            return;
        }
        if (record.key === "add") {
            managedSet.add(record.new);
            return;
        }
        if (record.key === "delete") {
            managedSet.delete(record.previous);
            return;
        }
        throwUnknownSetRecord(record, apiName);
        return;
    }
    if (record.node instanceof Date) {
        const managedDate = resolveManagedNode(record, apiName) as Date;
        managedDate.setTime(assertNumericDateValue(record.new, apiName));
        return;
    }
    if (Array.isArray(record.node)) {
        const managedArray = resolveManagedArray(record, apiName);
        if (record.op === "insert") {
            managedArray.splice(toArrayIndex(record, apiName), 0, record.new);
            return;
        }
        if (record.op === "length") {
            return;
        }
        if (record.key === "length") {
            managedArray.length = assertNumericLengthValue(record.new, apiName);
            return;
        }
        applyForwardObjectRecord(
            managedArray as unknown as Record<PropertyKey, unknown>,
            record,
            apiName
        );
        return;
    }
    const managedObject = resolveManagedNode(record, apiName) as Record<
        PropertyKey,
        unknown
    >;
    applyForwardObjectRecord(managedObject, record, apiName);
}

function applyForwardObjectRecord(
    managedNode: Record<PropertyKey, unknown>,
    record: INodeFieldChanges,
    apiName: TChangeApiName
): void {
    const key = toPropertyKey(record, apiName);
    if (record.op === "delete") {
        delete managedNode[key];
        return;
    }
    managedNode[key] = record.new;
}

/**
 * Resolve a record's raw node back to its managed node. Records describe raw
 * nodes, and only managed-node writes emit, so a record whose node has no
 * managed proxy anymore cannot be applied.
 */
function resolveManagedNode(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): TreeNode {
    const managed = getManagedProxyForUnproxiedNode(record.node);
    if (managed === undefined) {
        // @retree-throws
        throw new Error(
            `${apiName}: the change record for key '${describeChangeKey(
                record.key
            )}' targets a node that is not Retree-managed. This is expected when the records come from a different Retree tree, a different JavaScript realm, or a node whose tree was discarded. Fix: apply records only to the live tree that emitted them, while its root is still referenced.`
        );
    }
    return managed;
}

function resolveManagedArray(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): unknown[] {
    const managed = resolveManagedNode(record, apiName);
    if (!Array.isArray(managed)) {
        // @retree-throws
        throw new Error(
            `${apiName}: the change record for key '${describeChangeKey(
                record.key
            )}' describes an array mutation, but its node resolved to a non-array managed node. This is unexpected and likely a Retree bug. Please file an issue with the mutation that produced these records.`
        );
    }
    return managed;
}

function toPropertyKey(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): PropertyKey {
    if (typeof record.key === "object") {
        // @retree-throws
        throw new Error(
            `${apiName}: the change record for a plain object or array carries an object key. Object keys only appear on Map records, so this record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    return record.key;
}

function toArrayIndex(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): number {
    if (typeof record.key !== "string") {
        // @retree-throws
        throw new Error(
            `${apiName}: an array structural change record carries a non-string key '${describeChangeKey(
                record.key
            )}'. Array element records always use string indices, so this record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    const index = Number(record.key);
    if (!Number.isInteger(index) || index < 0) {
        // @retree-throws
        throw new Error(
            `${apiName}: an array structural change record carries key '${record.key}', which is not a non-negative integer index. This record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    return index;
}

function assertNumericDateValue(
    value: unknown,
    apiName: TChangeApiName
): number {
    if (typeof value !== "number") {
        // @retree-throws
        throw new Error(
            `${apiName}: a Date change record carries a non-number time value. Date records always carry epoch-millisecond numbers, so this record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    return value;
}

function assertNumericLengthValue(
    value: unknown,
    apiName: TChangeApiName
): number {
    if (typeof value !== "number") {
        // @retree-throws
        throw new Error(
            `${apiName}: an array 'length' change record carries a non-number value. Length records always carry numbers, so this record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
        );
    }
    return value;
}

function throwUnknownSetRecord(
    record: INodeFieldChanges,
    apiName: TChangeApiName
): never {
    // @retree-throws
    throw new Error(
        `${apiName}: a Set change record carries the unknown key '${describeChangeKey(
            record.key
        )}'. Set records only use 'add', 'delete', or 'clear', so this record set was likely constructed by hand or corrupted. Fix: pass change records exactly as Retree emitted them.`
    );
}

function describeChangeKey(key: INodeFieldChanges["key"]): string {
    if (typeof key === "object") {
        return "[object key]";
    }
    return String(key);
}
