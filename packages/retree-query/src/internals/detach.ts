/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { getUnproxiedNode, isLeafObject } from "@retreejs/core/internal";

/**
 * Copy every object Retree would adopt as a structural child.
 *
 * @remarks
 * Sources may hand the same object to several queries and keep it in their
 * own cache, so query state must never adopt it. Leaves (frozen objects and
 * opaque built-ins), functions, and nodes the tree already manages are
 * shared. Copies keep own enumerable string keys, like the source data
 * queries carry.
 */
export function detach<T>(value: T): T {
    return detachValue(value) as T;
}

function detachValue(value: unknown): unknown {
    if (value === null) return value;
    if (typeof value !== "object") return value;
    if (isLeafObject(value)) return value;
    if (getUnproxiedNode(value) !== value) return value;
    if (Array.isArray(value)) return value.map(detachValue);
    if (isPlainRecord(value)) {
        // Bracket access is ~3x faster than Reflect for payload-sized copies.
        const copy: Record<string, unknown> = {};
        for (const key of Object.keys(value)) {
            setField(copy, key, detachValue(value[key]));
        }
        return copy;
    }
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) {
        const copy = new Map<unknown, unknown>();
        for (const [key, item] of value) copy.set(key, detachValue(item));
        return copy;
    }
    if (value instanceof Set) {
        const copy = new Set<unknown>();
        for (const item of value) copy.add(detachValue(item));
        return copy;
    }

    const copy: Record<string, unknown> = Object.create(
        Object.getPrototypeOf(value)
    );
    for (const key of Object.keys(value)) {
        setField(copy, key, detachValue(Reflect.get(value, key)));
    }
    return copy;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
    return Object.getPrototypeOf(value) === Object.prototype;
}

function setField(
    copy: Record<string, unknown>,
    key: string,
    value: unknown
): void {
    if (key === "__proto__") {
        // Assignment would invoke the prototype setter.
        Object.defineProperty(copy, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        return;
    }
    copy[key] = value;
}
