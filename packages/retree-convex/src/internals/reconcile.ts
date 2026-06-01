export function tryReconcileConvexDocuments(
    current: unknown,
    next: unknown
): boolean {
    if (!isConvexDocumentArray(current)) {
        return false;
    }
    if (!isConvexDocumentArray(next)) {
        return false;
    }

    reconcileDocumentArrayById(current, next);
    return true;
}

export function reconcileArray<TItem extends object>(
    current: TItem[],
    next: TItem[],
    getId: (item: TItem) => PropertyKey
): void {
    if (current.length === next.length) {
        let allItemsStayedInPlace = true;
        for (let index = 0; index < next.length; index++) {
            const currentItem = current[index];
            const nextItem = next[index];
            if (currentItem === undefined) {
                allItemsStayedInPlace = false;
                break;
            }
            if (nextItem === undefined) {
                allItemsStayedInPlace = false;
                break;
            }
            if (getId(currentItem) !== getId(nextItem)) {
                allItemsStayedInPlace = false;
                break;
            }

            reconcileObject(currentItem, nextItem);
        }

        if (allItemsStayedInPlace) {
            return;
        }
    }

    const currentById = new Map<PropertyKey, TItem>();
    for (const currentItem of current) {
        if (currentItem === undefined) {
            continue;
        }
        currentById.set(getId(currentItem), currentItem);
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
        const currentSlot = current[index];
        if (
            currentSlot !== undefined &&
            getId(currentSlot) === getId(currentItem)
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

function reconcileObject<T extends object>(target: T, source: T): void {
    for (const key of Object.keys(target)) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            Reflect.deleteProperty(target, key);
        }
    }

    for (const [key, value] of Object.entries(source)) {
        Reflect.set(target, key, value);
    }
}
