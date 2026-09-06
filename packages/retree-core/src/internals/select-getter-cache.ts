/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ReactiveNode } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import {
    collectTrackedSelectionAccesses,
    ITrackedSelectionAccesses,
    NodeReadRecord,
    ReadCoverage,
    trackSelectGetterRead,
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
    trackSelectGetterRead(handler, key);
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
    if (accesses.coverage === ReadCoverage.Partial) {
        return accesses;
    }
    cache.set(key, { accesses, version: getGlobalWriteVersion() });
    return accesses;
}

/**
 * True when a write to `changedKey` on `unproxied` may change one of the
 * `@select` getters cached under `getterKeys`: the getter's last run read
 * that key on its owner, read the owner in a way keys cannot scope, or has
 * not been cached. Reads of other nodes reach readers as forwarded records.
 */
export function selectGetterMayReadKey(
    unproxied: TreeNode,
    getterKeys: readonly (string | symbol)[],
    changedKey: string
): boolean {
    const cache = selectGetterCaches.get(unproxied);
    if (cache === undefined) {
        return true;
    }
    for (const getterKey of getterKeys) {
        const entry = cache.get(getterKey);
        if (entry === undefined) {
            return true;
        }
        const record = entry.accesses.reads.get(unproxied);
        if (record === undefined) {
            continue;
        }
        if (record.wholeNodeRead || !record.keyScopable) {
            return true;
        }
        if (record.hasPropertyKey(changedKey)) {
            return true;
        }
        const nested = record.selectGetterKeys;
        if (
            nested !== null &&
            selectGetterMayReadKey(unproxied, nested, changedKey)
        ) {
            return true;
        }
    }
    return false;
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
            if (!isReadRecordValid(record)) {
                return false;
            }
        }
    } else {
        for (const owner of owners) {
            const record = reads.get(owner);
            if (record !== undefined && !isReadRecordValid(record)) {
                return false;
            }
        }
    }
    entry.version = version;
    return true;
}

/**
 * A node the run read whole may have changed with any write to it; a keyed
 * record re-reads its cells.
 */
function isReadRecordValid(record: NodeReadRecord): boolean {
    if (record.wholeNodeRead) {
        return false;
    }
    return record.isUnchanged();
}
