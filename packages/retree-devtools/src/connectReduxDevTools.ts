/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    INodeFieldChanges,
    Retree,
    TNodeFieldChangeKey,
    TreeNode,
} from "@retreejs/core";
import {
    addRetreeDebugTap,
    getNamedRetreeRoots,
    TRetreeDebugTapEmission,
} from "@retreejs/core/internal";
import { isDevMode } from "./internals/env.js";
import { reconcileJsonState } from "./internals/json-reconcile.js";
import {
    getReduxDevToolsExtension,
    IReduxDevToolsAction,
    IReduxDevToolsConnectOptions,
} from "./internals/redux-devtools-extension.js";
import {
    IDevToolsChangeRecord,
    IReduxDevToolsConnection,
    IReduxDevToolsOptions,
} from "./types.js";

let hasLoggedMissingExtension = false;

/**
 * Connect the Retree debug tap stream to the Redux DevTools Extension.
 *
 * @remarks
 * Every Retree emission becomes one extension action:
 *
 * - A plain write sends `"<rootName>/<nodeLabel>.<key>"` (unnamed trees use
 *   `"anonymous"`) with the change records in the payload.
 * - A `Retree.runTransaction` window sends a single `"transaction"` action
 *   whose payload lists the batched actions inside it.
 * - Writes inside `Retree.runSilent(fn, false)` are included (state changed
 *   even though application listeners were suppressed) and flagged
 *   `payload.silent`; fully-silent writes (default `runSilent`) never emit
 *   and are invisible here.
 * - A node leaving its tree sends `"<rootName>/<nodeLabel>.removed"`. The
 *   node is already detached when the emission fires, so its root name is
 *   usually no longer resolvable and reports as `"anonymous"`.
 *
 * State shown in the extension is `{ [rootName]: state }` for every
 * inspected root — the roots passed via `options.roots`, or every root
 * registered with `Retree.registerRootName` when omitted. Each action
 * attaches a `structuredClone` of that state (see
 * {@link IReduxDevToolsOptions.stateSnapshots} for the cost and the
 * opt-out).
 *
 * Time travel (`Jump` in the extension) is supported for JSON-representable
 * state: the extension's state is reconciled into the inspected roots in
 * one transaction, preserving node identities so listeners survive the
 * jump. `Map`, `Set`, and `Date` values cannot round-trip through the
 * extension's JSON serialization and keep their current contents (a dev
 * warning reports the first skipped path).
 *
 * When the extension is absent the call is a safe no-op: it returns a
 * disconnected handle and logs one dev-mode `console.info`. Taps run
 * synchronously inside the write path, so prefer connecting only in
 * development builds.
 *
 * @param options Optional {@link IReduxDevToolsOptions}.
 * @returns An {@link IReduxDevToolsConnection}; call `dispose()` to
 * disconnect.
 *
 * @example
 * ```ts
 * import { Retree } from "@retreejs/core";
 * import { connectReduxDevTools } from "@retreejs/devtools";
 *
 * const app = Retree.root({ count: 0 });
 * const connection = connectReduxDevTools({
 *     name: "My App",
 *     roots: { app },
 * });
 *
 * app.count = 1; // action "app/Object.count" appears in the extension
 * // later
 * connection.dispose();
 * ```
 */
export function connectReduxDevTools(
    options?: IReduxDevToolsOptions
): IReduxDevToolsConnection {
    const extension = getReduxDevToolsExtension();
    if (extension === undefined) {
        if (!hasLoggedMissingExtension && isDevMode()) {
            hasLoggedMissingExtension = true;
            console.info(
                "@retreejs/devtools: Redux DevTools Extension not found; connectReduxDevTools is a no-op. Install the extension (https://github.com/reduxjs/redux-devtools) to inspect Retree state."
            );
        }
        return {
            connected: false,
            dispose: () => {
                // Nothing was connected.
            },
        };
    }

    if (options?.roots !== undefined) {
        for (const [name, node] of Object.entries(options.roots)) {
            Retree.registerRootName(node, name);
        }
    }
    const trackedRootNames =
        options?.roots === undefined
            ? undefined
            : new Set(Object.keys(options.roots));
    const stateSnapshots = options?.stateSnapshots ?? true;

    const connectOptions: IReduxDevToolsConnectOptions = {
        name: options?.name ?? "Retree",
    };
    if (options?.maxAge !== undefined) {
        connectOptions.maxAge = options.maxAge;
    }
    const instance = extension.connect(connectOptions);

    const warnedSnapshotRoots = new Set<string>();
    let warnedUnsupportedTimeTravel = false;
    let warnedSnapshotsDisabledJump = false;
    let isApplyingDevToolsState = false;
    let transactionBuffer: IReduxDevToolsAction[] | undefined;

    /**
     * Snapshot every inspected root as `{ [rootName]: clonedState }`, or
     * `null` when snapshots are disabled. A root whose raw state cannot be
     * structured-cloned (functions as own values, platform objects) is
     * replaced by a marker string so the tap never throws into the
     * mutating caller.
     */
    function snapshotState(): Record<string, unknown> | null {
        if (!stateSnapshots) {
            return null;
        }
        const state: Record<string, unknown> = {};
        for (const [name, rawRoot] of getNamedRetreeRoots()) {
            if (trackedRootNames !== undefined && !trackedRootNames.has(name)) {
                continue;
            }
            try {
                state[name] = structuredClone(rawRoot);
            } catch (error) {
                state[name] = `<unserializable root: ${errorMessage(error)}>`;
                if (isDevMode() && !warnedSnapshotRoots.has(name)) {
                    warnedSnapshotRoots.add(name);
                    console.warn(
                        `@retreejs/devtools: could not structuredClone root "${name}" for a state snapshot (${errorMessage(
                            error
                        )}). The extension will show a placeholder for this root; remove uncloneable values (functions, platform objects) or set stateSnapshots: false.`
                    );
                }
            }
        }
        return state;
    }

    function handleEmission(emission: TRetreeDebugTapEmission): void {
        if (isApplyingDevToolsState) {
            return;
        }
        if (emission.kind === "transactionStart") {
            transactionBuffer = [];
            return;
        }
        if (emission.kind === "transactionEnd") {
            const bufferedActions = transactionBuffer;
            transactionBuffer = undefined;
            if (bufferedActions === undefined) {
                return;
            }
            if (bufferedActions.length === 0) {
                return;
            }
            instance.send(
                {
                    type: "transaction",
                    payload: { actions: bufferedActions },
                },
                snapshotState()
            );
            return;
        }
        const action = buildAction(emission);
        if (transactionBuffer !== undefined) {
            transactionBuffer.push(action);
            return;
        }
        instance.send(action, snapshotState());
    }

    function reportUnsupportedTimeTravelValue(pathLabel: string): void {
        if (warnedUnsupportedTimeTravel) {
            return;
        }
        warnedUnsupportedTimeTravel = true;
        if (!isDevMode()) {
            return;
        }
        console.warn(
            `@retreejs/devtools: time travel skipped "${pathLabel}" — Map, Set, and Date values cannot be restored from the extension's JSON state, so those fields keep their current contents.`
        );
    }

    /**
     * Apply a devtools-provided state string (JSON of
     * `{ [rootName]: state }`) to the inspected roots in one transaction.
     * The tap is muted for the duration so the jump's own writes do not
     * echo back to the extension as new actions.
     */
    function applyDevToolsState(stateJson: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(stateJson);
        } catch (error) {
            if (isDevMode()) {
                console.warn(
                    `@retreejs/devtools: ignoring a time-travel jump whose state was not valid JSON (${errorMessage(
                        error
                    )}).`
                );
            }
            return;
        }
        if (parsed === null || typeof parsed !== "object") {
            return;
        }
        if (Array.isArray(parsed)) {
            return;
        }
        const namedRoots = getNamedRetreeRoots();
        isApplyingDevToolsState = true;
        try {
            Retree.runTransaction(() => {
                for (const [name, nextState] of Object.entries(parsed)) {
                    if (
                        trackedRootNames !== undefined &&
                        !trackedRootNames.has(name)
                    ) {
                        continue;
                    }
                    const rawRoot = namedRoots.get(name);
                    if (rawRoot === undefined) {
                        continue;
                    }
                    const managedRoot = Retree.managed(rawRoot);
                    if (managedRoot === undefined) {
                        continue;
                    }
                    reconcileJsonState(
                        managedRoot,
                        nextState,
                        reportUnsupportedTimeTravelValue,
                        name
                    );
                }
            });
        } finally {
            isApplyingDevToolsState = false;
        }
    }

    function handleMessage(message: unknown): void {
        if (message === null || typeof message !== "object") {
            return;
        }
        if (Reflect.get(message, "type") !== "DISPATCH") {
            return;
        }
        const payload: unknown = Reflect.get(message, "payload");
        if (payload === null || typeof payload !== "object") {
            return;
        }
        const dispatchType: unknown = Reflect.get(payload, "type");
        if (
            dispatchType !== "JUMP_TO_ACTION" &&
            dispatchType !== "JUMP_TO_STATE"
        ) {
            return;
        }
        if (!stateSnapshots) {
            if (isDevMode() && !warnedSnapshotsDisabledJump) {
                warnedSnapshotsDisabledJump = true;
                console.warn(
                    "@retreejs/devtools: ignoring a time-travel jump because connectReduxDevTools was called with stateSnapshots: false — without snapshots there is no state to jump to."
                );
            }
            return;
        }
        const state: unknown = Reflect.get(message, "state");
        if (typeof state !== "string") {
            return;
        }
        applyDevToolsState(state);
    }

    instance.init(snapshotState());
    const removeTap = addRetreeDebugTap(handleEmission);
    const unsubscribeMessages = instance.subscribe?.(handleMessage);

    let disposed = false;
    return {
        connected: true,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            removeTap();
            if (typeof unsubscribeMessages === "function") {
                unsubscribeMessages();
            }
            instance.unsubscribe?.();
        },
    };
}

/**
 * Build the extension action for one node emission.
 */
function buildAction(
    emission: Extract<
        TRetreeDebugTapEmission,
        { kind: "nodeChanged" | "nodeRemoved" }
    >
): IReduxDevToolsAction {
    const rootLabel = emission.rootName ?? "anonymous";
    const nodeLabel = labelForNode(emission.node);
    if (emission.kind === "nodeRemoved") {
        return {
            type: `${rootLabel}/${nodeLabel}.removed`,
            payload: {
                rootName: emission.rootName,
                node: nodeLabel,
                silent: emission.silent,
            },
        };
    }
    const firstRecord = emission.changes[0];
    const keyLabel =
        firstRecord === undefined ? "change" : displayKey(firstRecord.key);
    const extraRecordCount = emission.changes.length - 1;
    const suffix = extraRecordCount > 0 ? ` (+${extraRecordCount})` : "";
    return {
        type: `${rootLabel}/${nodeLabel}.${keyLabel}${suffix}`,
        payload: {
            rootName: emission.rootName,
            node: nodeLabel,
            silent: emission.silent,
            changes: emission.changes.map(serializeChangeRecord),
        },
    };
}

/**
 * Project one Retree change record into its JSON-friendly action-payload
 * form.
 */
function serializeChangeRecord(
    record: INodeFieldChanges
): IDevToolsChangeRecord {
    const serialized: IDevToolsChangeRecord = {
        key: displayKey(record.key),
        previous: record.previous,
        new: record.new,
    };
    if (record.op !== undefined) {
        serialized.op = record.op;
    }
    return serialized;
}

/**
 * Human-readable label for a change-record key: property keys and Map keys
 * stringify; object Map keys become `"[object-key]"`.
 */
function displayKey(key: TNodeFieldChangeKey): string {
    if (typeof key === "object" && key !== null) {
        return "[object-key]";
    }
    return String(key);
}

/**
 * Label a raw node for action types: `"Array"` for arrays, the constructor
 * name for class instances and collections, `"Object"` otherwise.
 */
function labelForNode(node: TreeNode): string {
    if (Array.isArray(node)) {
        return "Array";
    }
    const prototype: unknown = Object.getPrototypeOf(node);
    if (prototype === null) {
        return "Object";
    }
    const constructorName = node.constructor.name;
    if (constructorName.length === 0) {
        return "Object";
    }
    return constructorName;
}

/**
 * Extract a printable message from a caught value.
 */
function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
