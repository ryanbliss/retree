/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ReactiveNode } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import {
    collectTrackedSelectionAccesses,
    ITrackedSelectionAccesses,
} from "./dependency-tracking.js";
import {
    getCustomProxyHandlerFromMetadata,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";
import {
    getGlobalWriteVersion,
    getWrittenOwnersSince,
} from "./write-version.js";

interface ISelectGetterCacheEntry {
    accesses: ITrackedSelectionAccesses<unknown>;
    version: number;
}

const selectGetterCaches = new WeakMap<
    TreeNode,
    Map<string | symbol, ISelectGetterCacheEntry>
>();

/**
 * @internal
 * Last tracked run of an auto-trapped `@select` getter, reused while the
 * reads it made still re-read equal. Both the getter and the owner's
 * lifecycle resolve through here, so consumers read the exact instance the
 * lifecycle compared. A raw instance (`Retree.raw(vm).getter`, a node not
 * yet in a tree) runs the body every time: its reads bypass the traps, so
 * nothing could validate a cached value.
 */
export function collectSelectGetter(
    instance: ReactiveNode,
    key: string | symbol,
    body: () => unknown
): ITrackedSelectionAccesses<unknown> {
    const handler = getCustomProxyHandlerFromMetadata(instance);
    if (handler === undefined) {
        return collectTrackedSelectionAccesses(body);
    }
    const unproxied = handler[unproxiedBaseNodeKey];
    let cache = selectGetterCaches.get(unproxied);
    if (cache === undefined) {
        cache = new Map();
        selectGetterCaches.set(unproxied, cache);
    }
    const entry = cache.get(key);
    if (entry !== undefined && isSelectGetterEntryValid(entry)) {
        return entry.accesses;
    }
    const accesses = collectTrackedSelectionAccesses(body);
    cache.set(key, { accesses, version: getGlobalWriteVersion() });
    return accesses;
}

/**
 * True while every read the cached run made re-reads equal. Only records of
 * owners written since the stamp are checked; a write to a node the body
 * never read cannot change its value.
 */
function isSelectGetterEntryValid(entry: ISelectGetterCacheEntry): boolean {
    const version = getGlobalWriteVersion();
    if (entry.version === version) {
        return true;
    }
    const reads = entry.accesses.reads;
    const owners = getWrittenOwnersSince(entry.version);
    if (owners === undefined) {
        for (const record of reads.values()) {
            if (!record.isUnchanged()) {
                return false;
            }
        }
    } else {
        for (const owner of owners) {
            const record = reads.get(owner);
            if (record !== undefined && !record.isUnchanged()) {
                return false;
            }
        }
    }
    entry.version = version;
    return true;
}
