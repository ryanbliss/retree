/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { addRetreeDebugTap } from "@retreejs/core/internal";
import { resolveNodePath } from "./internals/node-path.js";
import {
    IChangeLogTapOptions,
    IRetreeChangeLogEntry,
    TRetreeChangeLogSink,
} from "./types.js";

/**
 * Register a structured-logging tap over the Retree debug tap stream.
 *
 * @remarks
 * This is the low-level building block for custom tooling: every Retree
 * emission — including emissions inside `Retree.runSilent` windows, which
 * application listeners never see — is delivered to `sink` as one
 * {@link IRetreeChangeLogEntry} with the root name, a best-effort key path,
 * the raw change records, and transaction/silent flags.
 * {@link connectReduxDevTools} is the batteries-included consumer of the
 * same stream; reach for `createChangeLogTap` when piping changes into your
 * own logger, test harness, or panel.
 *
 * The sink runs synchronously inside Retree's write path, before
 * application listeners. Keep it passive: a slow sink slows every write,
 * and a sink that mutates Retree state re-enters the emit path.
 *
 * @param sink Callback receiving one entry per emission.
 * @param options Optional {@link IChangeLogTapOptions}.
 * @returns Unsubscribe function; safe to call more than once.
 *
 * @example
 * ```ts
 * import { Retree } from "@retreejs/core";
 * import { createChangeLogTap } from "@retreejs/devtools";
 *
 * const app = Retree.root({ tasks: [{ title: "write docs", done: false }] });
 * Retree.registerRootName(app, "app");
 *
 * const removeTap = createChangeLogTap((entry) => {
 *     console.log(entry.rootName, entry.path?.join("."), entry.records);
 * });
 *
 * app.tasks[0].done = true;
 * // logs: "app", "tasks.0", [{ key: "done", previous: false, new: true, ... }]
 *
 * removeTap();
 * ```
 */
export function createChangeLogTap(
    sink: TRetreeChangeLogSink,
    options?: IChangeLogTapOptions
): () => void {
    const includePaths = options?.paths ?? true;
    let inTransaction = false;
    return addRetreeDebugTap((emission) => {
        if (emission.kind === "transactionStart") {
            inTransaction = true;
            return;
        }
        if (emission.kind === "transactionEnd") {
            inTransaction = false;
            return;
        }
        const entry: IRetreeChangeLogEntry = {
            kind: emission.kind,
            rootName: emission.rootName,
            path: includePaths ? resolveNodePath(emission.node) : undefined,
            records: emission.kind === "nodeChanged" ? emission.changes : [],
            transaction: inTransaction,
            silent: emission.silent,
        };
        sink(entry);
    });
}
