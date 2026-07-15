/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { setRetreeListenerFlushWrapper } from "@retreejs/core/internal";
import { unstable_batchedUpdates } from "react-dom";

/**
 * The one wrapper this package ever registers: run every synchronous Retree
 * listener flush inside React's `unstable_batchedUpdates`.
 *
 * @remarks
 * React 18+ auto-batches, where this is a cheap no-op passthrough. On React
 * 16/17 it is what collapses a multi-node transaction flush — one listener
 * emission per changed node — into a single React render. This is why
 * `react-dom` is a required peer dependency of `@retreejs/react`.
 */
const reactBatchedListenerFlushWrapper = (flush: () => void): void => {
    unstable_batchedUpdates(flush);
};

/**
 * Register {@link reactBatchedListenerFlushWrapper} with Retree core.
 *
 * @remarks
 * Idempotent: every call registers the same module-singleton wrapper, so
 * repeated calls (one per hook module init, or a test restoring the default)
 * never stack wrappers or change behavior. Called at module init of the
 * subscription internals every Retree hook flows through, so the wrapper is
 * in place before any hook can subscribe.
 */
export function registerReactBatchedListenerFlushWrapper(): void {
    setRetreeListenerFlushWrapper(reactBatchedListenerFlushWrapper);
}
