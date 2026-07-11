import { getUnproxiedNode } from "@retreejs/core/internal";
import { TreeNode } from "@retreejs/core";

function unwrapRaw<T>(value: T): T {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return (getUnproxiedNode(value as unknown as TreeNode) ?? value) as T;
}

export function tryReconcileConvexDocuments(
    current: unknown,
    next: unknown
): boolean {
    // Validation reads run against the raw array (raw purity guarantees it
    // is proxy-free); reconciliation writes still go through `current`.
    if (!isConvexDocumentArray(unwrapRaw(current))) {
        return false;
    }
    if (!isConvexDocumentArray(next)) {
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
        const currentItem = currentById.get(getId(nextItem));
        if (currentItem === undefined) {
            current[index] = nextItem;
            continue;
        }

        reconcileObject(currentItem, nextItem);
        // rawCurrent is a live view of `current`, so this reads the latest
        // slot state even after earlier assignments in this loop.
        const rawSlot = rawCurrent[index];
        if (
            rawSlot !== undefined &&
            getId(rawSlot) === getId(unwrapRaw(currentItem))
        ) {
            continue;
        }

        current[index] = currentItem;
    }

    current.length = next.length;
}

function isConvexDocumentArray(
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
        // Compare against raw at native speed; dispatch a trapped write only
        // for fields that actually changed.
        if ((raw as Record<string, unknown>)[key] !== value) {
            Reflect.set(target, key, value);
        }
    }
}
