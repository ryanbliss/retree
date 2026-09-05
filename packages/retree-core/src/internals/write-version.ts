/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Monotonic counter advanced on every published Retree mutation (and,
 * conservatively, once per `Retree.runSilent` block for writes that skip
 * reproxying). Version-stamped caches — like the per-flush ReactiveNode
 * dependency collection — compare their stored stamp against this counter to
 * decide whether cached results still describe current tree state.
 */
let globalWriteVersion = 0;
let unscopedWriteVersion = 0;
const RECENT_WRITE_LIMIT = 256;
const recentOwners: (WeakRef<object> | undefined)[] = new Array(
    RECENT_WRITE_LIMIT
);
const ownerReferences = new WeakMap<object, WeakRef<object>>();

/**
 * @internal
 * Advance the global write version. Call after any mutation that could change
 * what a dependency collection or selector would observe.
 */
export function bumpGlobalWriteVersion(owner?: object): void {
    globalWriteVersion++;
    if (owner === undefined) unscopedWriteVersion++;
    let reference: WeakRef<object> | undefined;
    if (owner !== undefined && typeof WeakRef === "function") {
        reference = ownerReferences.get(owner);
        if (reference === undefined) {
            reference = new WeakRef(owner);
            ownerReferences.set(owner, reference);
        }
    }
    recentOwners[globalWriteVersion % RECENT_WRITE_LIMIT] = reference;
}

/** Undefined means history overflowed or an unscoped write requires full validation. */
export function getWrittenOwnersSince(
    version: number
): Set<object> | undefined {
    if (globalWriteVersion - version > RECENT_WRITE_LIMIT) return undefined;
    const owners = new Set<object>();
    for (let next = version + 1; next <= globalWriteVersion; next++) {
        const reference = recentOwners[next % RECENT_WRITE_LIMIT];
        if (reference === undefined) return undefined;
        const owner = reference.deref();
        if (owner !== undefined) owners.add(owner);
    }
    return owners;
}

/**
 * @internal
 * Read the current global write version for stamping cached results.
 */
export function getGlobalWriteVersion(): number {
    return globalWriteVersion;
}

/** @internal Includes silent blocks whose writes cannot be scoped to one tree. */
export function getUnscopedWriteVersion(): number {
    return unscopedWriteVersion;
}
