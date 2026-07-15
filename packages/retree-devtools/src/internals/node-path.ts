/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Retree, TreeNode } from "@retreejs/core";

/**
 * Best-effort resolution of a node's path from its tree root.
 *
 * @remarks
 * Walks {@link Retree.parent} from the node to the top of its tree and, at
 * each level, scans the parent's raw children for the identity match to
 * label the step — `O(depth × width)` per call, which is fine for a
 * debugging tap but not for a hot path. Returns key labels root-first,
 * excluding the root itself (the root's own path is `[]`).
 *
 * Returns `undefined` when the raw node cannot be resolved back to a managed
 * node — for example a node that was removed from its tree before the walk,
 * or a raw value that was never materialized.
 */
export function resolveNodePath(rawNode: TreeNode): string[] | undefined {
    const managed = Retree.managed(rawNode);
    if (managed === undefined) {
        return undefined;
    }
    const segments: string[] = [];
    let current: TreeNode = managed;
    for (;;) {
        const parent = Retree.parent(current);
        if (parent === null) {
            break;
        }
        segments.unshift(findChildKeyLabel(parent, current));
        current = parent;
    }
    return segments;
}

/**
 * Label the key under which `child` lives in `parent`, scanning raw values
 * for the identity match.
 */
function findChildKeyLabel(parent: TreeNode, child: TreeNode): string {
    const rawParent = Retree.raw(parent);
    const rawChild = Retree.raw(child);
    if (Array.isArray(rawParent)) {
        const index = rawParent.indexOf(rawChild);
        if (index === -1) {
            return "[unknown-index]";
        }
        return String(index);
    }
    if (rawParent instanceof Map) {
        for (const [key, value] of rawParent.entries()) {
            if (value !== rawChild) {
                continue;
            }
            if (typeof key === "object" && key !== null) {
                return "[object-key]";
            }
            return String(key);
        }
        return "[unknown-map-key]";
    }
    if (rawParent instanceof Set) {
        return "[set-entry]";
    }
    for (const key of Reflect.ownKeys(rawParent)) {
        if (Reflect.get(rawParent, key) !== rawChild) {
            continue;
        }
        if (typeof key === "symbol") {
            return String(key);
        }
        return key;
    }
    return "[unknown-key]";
}
