/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Short-circuiting deep equality for async query state.
 *
 * @remarks
 * Handles every value shape a serializable query result can contain:
 * primitives (including `bigint`), `ArrayBuffer` bytes, `Date` timestamps,
 * arrays, and plain objects — without the key-order sensitivity or `bigint`
 * throw of a JSON round-trip.
 */
export function deepEquals(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (left === null) {
        return false;
    }
    if (right === null) {
        return false;
    }
    if (typeof left !== "object") {
        return false;
    }
    if (typeof right !== "object") {
        return false;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left)) {
            return false;
        }
        if (!Array.isArray(right)) {
            return false;
        }
        return arraysDeepEqual(left, right);
    }

    if (left instanceof Date || right instanceof Date) {
        if (!(left instanceof Date)) {
            return false;
        }
        if (!(right instanceof Date)) {
            return false;
        }
        return Object.is(left.getTime(), right.getTime());
    }

    if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) {
        if (!(left instanceof ArrayBuffer)) {
            return false;
        }
        if (!(right instanceof ArrayBuffer)) {
            return false;
        }
        return arrayBuffersEqual(left, right);
    }

    return objectsDeepEqual(
        left as Record<string, unknown>,
        right as Record<string, unknown>
    );
}

function arraysDeepEqual(left: unknown[], right: unknown[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    for (let index = 0; index < left.length; index++) {
        if (!deepEquals(left[index], right[index])) {
            return false;
        }
    }

    return true;
}

function arrayBuffersEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }

    const leftBytes = new Uint8Array(left);
    const rightBytes = new Uint8Array(right);
    for (let index = 0; index < leftBytes.length; index++) {
        if (leftBytes[index] !== rightBytes[index]) {
            return false;
        }
    }

    return true;
}

function objectsDeepEqual(
    left: Record<string, unknown>,
    right: Record<string, unknown>
): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(right, key)) {
            return false;
        }
        if (!deepEquals(left[key], right[key])) {
            return false;
        }
    }

    return true;
}
