/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { getUnproxiedNode } from "@retreejs/core/internal";
import { TreeNode } from "@retreejs/core";
import { deepEquals } from "./equality.js";

function unwrapRaw<T>(value: T): T {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return (getUnproxiedNode(value as unknown as TreeNode) ?? value) as T;
}

/**
 * Reconcile an incoming document array into the current state when both sides
 * are arrays of documents with `_id` keys (the Convex document convention).
 *
 * @remarks
 * Returns `false` without touching `current` when either side is not a
 * document array, so callers can fall back to wholesale replacement.
 */
export function tryReconcileDocumentsById(
    current: unknown,
    next: unknown
): boolean {
    // Validation reads run against the raw array (raw purity guarantees it
    // is proxy-free); reconciliation writes still go through `current`.
    if (!isDocumentArray(unwrapRaw(current))) {
        return false;
    }
    if (!isDocumentArray(next)) {
        return false;
    }

    reconcileDocumentArrayById(
        current as Array<Record<"_id", PropertyKey>>,
        next as Array<Record<"_id", PropertyKey>>
    );
    return true;
}

export function reconcileArray<TItem extends object>(
    current: TItem[],
    next: TItem[],
    getId: (item: TItem) => PropertyKey
): void {
    // Reconciliation is read-dominated: compare every field of every item,
    // write only the diffs. Reads (ids, field comparisons) run against the
    // raw array at native speed; writes go through the managed `current` so
    // changed rows emit and item identity stays stable for useNode rows.
    const rawCurrent = unwrapRaw(current);
    if (rawCurrent.length === next.length) {
        let allItemsStayedInPlace = true;
        for (let index = 0; index < next.length; index++) {
            const rawItem = rawCurrent[index];
            const nextItem = next[index];
            if (rawItem === undefined) {
                allItemsStayedInPlace = false;
                break;
            }
            if (nextItem === undefined) {
                allItemsStayedInPlace = false;
                break;
            }
            if (getId(rawItem) !== getId(nextItem)) {
                allItemsStayedInPlace = false;
                break;
            }

            reconcileObject(current[index]!, nextItem, rawItem);
        }

        if (allItemsStayedInPlace) {
            return;
        }
    }

    const currentById = new Map<PropertyKey, TItem>();
    for (let index = 0; index < rawCurrent.length; index++) {
        const rawItem = rawCurrent[index];
        if (rawItem === undefined) {
            continue;
        }
        // Managed item for writes; raw id for the key.
        currentById.set(getId(rawItem), current[index]!);
    }

    for (let index = 0; index < next.length; index++) {
        const nextItem = next[index];
        if (nextItem === undefined) {
            continue;
        }
        const nextId = getId(nextItem);
        const currentItem = currentById.get(nextId);
        if (currentItem === undefined) {
            current[index] = nextItem;
            continue;
        }

        // Consume the match so a duplicate id later in `next` falls through to
        // the insert path above instead of aliasing one managed object into
        // two array slots.
        currentById.delete(nextId);
        reconcileObject(currentItem, nextItem);
        // rawCurrent is a live view of `current`, so this reads the latest
        // slot state even after earlier assignments in this loop. Compare by
        // identity, not id: duplicate-id emissions can put two distinct
        // objects with the same id in the array, and an id match would leave
        // the reconciled updates in the wrong (soon truncated) slot.
        const rawSlot = rawCurrent[index];
        if (rawSlot !== undefined && rawSlot === unwrapRaw(currentItem)) {
            continue;
        }

        current[index] = currentItem;
    }

    current.length = next.length;
}

function isDocumentArray(
    value: unknown
): value is Array<Record<"_id", PropertyKey>> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const item of value) {
        if (!isRecordWithPropertyKeyId(item)) {
            return false;
        }
    }

    return true;
}

function isRecordWithPropertyKeyId(
    value: unknown
): value is Record<"_id", PropertyKey> {
    if (value === null) {
        return false;
    }
    if (typeof value !== "object") {
        return false;
    }

    const id = Reflect.get(value, "_id");
    if (typeof id === "string") {
        return true;
    }
    if (typeof id === "number") {
        return true;
    }
    return typeof id === "symbol";
}

function reconcileDocumentArrayById(
    current: Array<Record<"_id", PropertyKey>>,
    next: Array<Record<"_id", PropertyKey>>
): void {
    reconcileArray(current, next, (item) => item._id);
}

function reconcileObject<T extends object>(
    target: T,
    source: T,
    rawTarget?: T
): void {
    const raw = rawTarget ?? unwrapRaw(target);
    for (const key of Object.keys(raw)) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            Reflect.deleteProperty(target, key);
        }
    }

    for (const [key, value] of Object.entries(source)) {
        reconcileField(target, raw, key, value);
    }
}

/**
 * Reconcile one field of a managed object or array slot.
 *
 * @remarks
 * Server emissions produce a fresh reference for every nested object and
 * array, so a reference compare alone would rewrite (and re-emit for) every
 * nested field on every emission. Reads run against `rawTarget` at native
 * speed; writes dispatch through `target` only when the value actually
 * changed. Same-shape nested objects and arrays are reconciled in place so
 * unchanged nested nodes keep identity and emit nothing.
 */
function reconcileField(
    target: object,
    rawTarget: object,
    key: string | number,
    value: unknown
): void {
    const rawValue = (rawTarget as Record<string | number, unknown>)[key];
    if (rawValue === value) {
        return;
    }

    // Deep-equal nested values need no write at all. Checking before
    // recursing also avoids materializing a managed child proxy for
    // unchanged nested fields — the dominant case for live query emissions.
    if (deepEquals(rawValue, value)) {
        return;
    }

    if (isPlainRecord(rawValue) && isPlainRecord(value)) {
        const managedChild = Reflect.get(target, key);
        if (isPlainRecord(managedChild)) {
            reconcileObject(managedChild, value, rawValue);
            return;
        }
    }

    if (Array.isArray(rawValue) && Array.isArray(value)) {
        const managedChild = Reflect.get(target, key);
        if (Array.isArray(managedChild)) {
            reconcileNestedArray(managedChild, value, rawValue);
            return;
        }
    }

    Reflect.set(target, key, value);
}

function reconcileNestedArray(
    target: unknown[],
    source: unknown[],
    rawTarget: unknown[]
): void {
    const sharedLength = Math.min(rawTarget.length, source.length);
    for (let index = 0; index < sharedLength; index++) {
        reconcileField(target, rawTarget, index, source[index]);
    }

    for (let index = rawTarget.length; index < source.length; index++) {
        Reflect.set(target, index, source[index]);
    }

    if (rawTarget.length > source.length) {
        target.length = source.length;
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (value === null) {
        return false;
    }
    if (typeof value !== "object") {
        return false;
    }
    if (Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype) {
        return true;
    }
    return prototype === null;
}
