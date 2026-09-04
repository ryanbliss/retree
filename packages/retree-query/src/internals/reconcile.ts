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

            reconcileObject(() => current[index]!, nextItem, rawItem);
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
        reconcileObject(() => currentItem, nextItem, unwrapRaw(currentItem));
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

type ReconcileTarget = {
    raw: object;
    managed?: object;
} & (
    | { parent: ReconcileTarget; key: string | number }
    | { getRoot: () => object }
);

type FieldWork = {
    target: ReconcileTarget;
    key: string | number;
} & ({ kind: "compare"; value: unknown } | { kind: "delete" });

function getManagedTarget(target: ReconcileTarget): object {
    const path: ReconcileTarget[] = [];
    let current = target;
    while (current.managed === undefined) {
        if (!("parent" in current)) {
            current.managed = current.getRoot();
            break;
        }
        path.push(current);
        current = current.parent;
    }
    let managed = current.managed;
    while (path.length > 0) {
        const child = path.pop()!;
        if (!("key" in child)) {
            throw new Error(
                "Reconciliation child path is missing its property key."
            );
        }
        const value: unknown = Reflect.get(managed, child.key);
        if (value === null) {
            throw new Error(
                `Reconciliation target at '${String(child.key)}' became null.`
            );
        }
        if (typeof value !== "object") {
            throw new Error(
                `Reconciliation target at '${String(
                    child.key
                )}' is no longer an object.`
            );
        }
        child.managed = value;
        managed = value;
    }
    return managed;
}

function reconcileObject<T extends object>(
    getRoot: () => T,
    source: T,
    raw: T
): void {
    const pending: FieldWork[] = [];
    queueFields(pending, { raw, getRoot }, source);
    while (pending.length > 0) {
        const work = pending.pop()!;
        const { target, key } = work;
        if (work.kind === "delete") {
            Reflect.deleteProperty(getManagedTarget(target), key);
            continue;
        }
        const rawValue: unknown = Reflect.get(target.raw, key);
        const value = work.value;
        if (Object.is(rawValue, value) && Object.hasOwn(target.raw, key)) {
            continue;
        }
        const bothRecords = isPlainRecord(rawValue) && isPlainRecord(value);
        const bothArrays = Array.isArray(rawValue) && Array.isArray(value);
        if (bothRecords || bothArrays) {
            queueFields(pending, { raw: rawValue, parent: target, key }, value);
            continue;
        }
        if (deepEquals(rawValue, value) && Object.hasOwn(target.raw, key)) {
            continue;
        }
        Reflect.set(getManagedTarget(target), key, value);
    }
}

function queueFields(
    pending: FieldWork[],
    target: ReconcileTarget,
    source: object
): void {
    if (Array.isArray(target.raw) && Array.isArray(source)) {
        if (target.raw.length > source.length) {
            pending.push({
                kind: "compare",
                target,
                key: "length",
                value: source.length,
            });
        }
        for (let index = source.length - 1; index >= 0; index--) {
            pending.push({
                kind: "compare",
                target,
                key: index,
                value: source[index],
            });
        }
        return;
    }
    const keys = Object.keys(source);
    for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        pending.push({
            kind: "compare",
            target,
            key,
            value: Reflect.get(source, key),
        });
    }
    const previousKeys = Object.keys(target.raw);
    for (let index = previousKeys.length - 1; index >= 0; index--) {
        const key = previousKeys[index];
        if (!Object.hasOwn(source, key)) {
            pending.push({ kind: "delete", target, key });
        }
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
