/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Retree, TreeNode } from "@retreejs/core";

/**
 * Callback invoked when time travel encounters a value it cannot restore
 * from JSON (`Map`, `Set`, `Date`). Receives a dotted path label for the
 * skipped value, e.g. `"tasks.byId"`.
 */
export type TUnsupportedValueReporter = (pathLabel: string) => void;

/**
 * Reconcile a JSON state payload from the Redux DevTools Extension into a
 * managed Retree node, in place.
 *
 * @remarks
 * The extension serializes state through JSON, so this restores exactly what
 * JSON can carry: primitives, plain objects, and arrays. Existing node
 * identities are preserved wherever the shapes line up (an object stays the
 * same managed node with its fields rewritten; an array is resized and
 * rewritten per index), so listeners and React subscriptions survive a jump.
 *
 * Values JSON cannot represent are skipped and reported via `onUnsupported`:
 * `Map`, `Set`, and `Date` nodes keep their current contents. Class-instance
 * nodes are updated field-by-field from the payload but never have fields
 * deleted, since JSON carries no prototype information to rebuild them from;
 * plain-object nodes do have keys the payload lacks deleted.
 *
 * Callers are expected to wrap the call in `Retree.runTransaction` so the
 * whole jump flushes as one batch.
 */
export function reconcileJsonState(
    node: TreeNode,
    next: unknown,
    onUnsupported: TUnsupportedValueReporter,
    pathLabel: string
): void {
    if (node instanceof Map || node instanceof Set || node instanceof Date) {
        onUnsupported(pathLabel);
        return;
    }
    if (Array.isArray(node)) {
        if (!Array.isArray(next)) {
            onUnsupported(pathLabel);
            return;
        }
        for (let index = 0; index < next.length; index++) {
            reconcileField(
                node,
                index,
                next[index],
                onUnsupported,
                `${pathLabel}.${index}`
            );
        }
        if (node.length > next.length) {
            node.splice(next.length);
        }
        return;
    }
    if (!isJsonObject(next)) {
        onUnsupported(pathLabel);
        return;
    }
    if (isPlainRawObject(node)) {
        for (const key of Object.keys(node)) {
            if (Object.hasOwn(next, key)) {
                continue;
            }
            Reflect.deleteProperty(node, key);
        }
    }
    for (const [key, nextValue] of Object.entries(next)) {
        reconcileField(
            node,
            key,
            nextValue,
            onUnsupported,
            `${pathLabel}.${key}`
        );
    }
}

/**
 * Write one field of the payload into the node, recursing when the current
 * value can absorb the payload value in place.
 */
function reconcileField(
    node: TreeNode,
    key: string | number,
    nextValue: unknown,
    onUnsupported: TUnsupportedValueReporter,
    pathLabel: string
): void {
    const currentValue: unknown = Reflect.get(node, key);
    if (nextValue === null || typeof nextValue !== "object") {
        if (!Object.is(currentValue, nextValue)) {
            Reflect.set(node, key, nextValue);
        }
        return;
    }
    if (
        currentValue instanceof Map ||
        currentValue instanceof Set ||
        currentValue instanceof Date
    ) {
        onUnsupported(pathLabel);
        return;
    }
    if (Array.isArray(nextValue)) {
        if (Array.isArray(currentValue)) {
            reconcileJsonState(
                currentValue,
                nextValue,
                onUnsupported,
                pathLabel
            );
            return;
        }
        Reflect.set(node, key, nextValue);
        return;
    }
    if (currentValue !== null && typeof currentValue === "object") {
        reconcileJsonState(currentValue, nextValue, onUnsupported, pathLabel);
        return;
    }
    Reflect.set(node, key, nextValue);
}

/**
 * Whether a parsed JSON value is a non-array object.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
    if (value === null) {
        return false;
    }
    if (typeof value !== "object") {
        return false;
    }
    return !Array.isArray(value);
}

/**
 * Whether the raw object behind a managed node is a plain object (safe to
 * delete keys from during reconciliation).
 */
function isPlainRawObject(node: TreeNode): boolean {
    const prototype = Object.getPrototypeOf(Retree.raw(node));
    if (prototype === null) {
        return true;
    }
    return prototype === Object.prototype;
}
