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

/**
 * @internal
 * Advance the global write version. Call after any mutation that could change
 * what a dependency collection or selector would observe.
 */
export function bumpGlobalWriteVersion(): void {
    globalWriteVersion++;
}

/**
 * @internal
 * Read the current global write version for stamping cached results.
 */
export function getGlobalWriteVersion(): number {
    return globalWriteVersion;
}
