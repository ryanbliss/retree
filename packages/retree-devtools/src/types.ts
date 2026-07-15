/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    INodeFieldChanges,
    TNodeFieldChangeOp,
    TreeNode,
} from "@retreejs/core";

/**
 * Options for {@link connectReduxDevTools}.
 */
export interface IReduxDevToolsOptions {
    /**
     * Instance name shown in the Redux DevTools Extension's instance
     * selector. Defaults to `"Retree"`.
     */
    name?: string;
    /**
     * Managed roots to register and inspect, as `rootName -> root node`.
     *
     * @remarks
     * Each entry is registered via `Retree.registerRootName(node, name)`, so
     * passing roots here replaces separate registration calls. When
     * provided, state snapshots and time travel are scoped to exactly these
     * roots; when omitted, every root already registered with
     * `Retree.registerRootName` is included.
     */
    roots?: Record<string, TreeNode>;
    /**
     * Maximum number of actions the extension retains before dropping the
     * oldest. Passed through to the extension's `maxAge`; omitted by
     * default, which leaves the extension's own default (50) in effect.
     * Lower it when full-state snapshots make each action heavy.
     */
    maxAge?: number;
    /**
     * Whether to attach a full state snapshot to every action. Defaults to
     * `true`.
     *
     * @remarks
     * Each snapshot is a `structuredClone` of every inspected root's raw
     * state — `O(state size)` per write. That is what makes the extension's
     * state inspector and time travel work, and it is usually fine in
     * development, but for very large trees or write-heavy hot paths set
     * this to `false` to keep only the action stream. Time travel requires
     * snapshots; with `stateSnapshots: false`, jump requests are ignored.
     */
    stateSnapshots?: boolean;
}

/**
 * Handle returned by {@link connectReduxDevTools}.
 */
export interface IReduxDevToolsConnection {
    /**
     * `true` when the Redux DevTools Extension was found and connected;
     * `false` when the connection is a no-op because the extension is
     * absent.
     */
    readonly connected: boolean;
    /**
     * Disconnect: removes the Retree debug tap and unsubscribes from the
     * extension. Safe to call more than once.
     */
    dispose(): void;
}

/**
 * One change record as attached to a Redux DevTools action payload.
 *
 * @remarks
 * A JSON-friendly projection of Retree's `INodeFieldChanges`: the key is
 * stringified (object Map keys become `"[object-key]"`), and `previous`/
 * `new` are the raw payload values from the record.
 */
export interface IDevToolsChangeRecord {
    key: string;
    previous: unknown;
    new: unknown;
    op?: TNodeFieldChangeOp;
}

/**
 * One entry delivered to a {@link createChangeLogTap} sink.
 */
export interface IRetreeChangeLogEntry {
    /**
     * Which emission produced the entry. `nodeChanged` carries the change
     * records; `nodeRemoved` reports a node leaving its tree and has no
     * records.
     */
    kind: "nodeChanged" | "nodeRemoved";
    /**
     * The name registered for the node's tree root via
     * `Retree.registerRootName`, or `undefined` for unnamed trees.
     */
    rootName: string | undefined;
    /**
     * Best-effort key path from the tree root to the changed node,
     * root-first and excluding the root itself (`[]` for the root).
     * `undefined` when the node could not be resolved (for example, it was
     * already removed from its tree) or when paths are disabled via
     * {@link IChangeLogTapOptions.paths}.
     */
    path: string[] | undefined;
    /**
     * The raw change records from the emission, exactly as Retree listeners
     * receive them. Empty for `nodeRemoved` entries.
     */
    records: INodeFieldChanges[];
    /**
     * `true` when the emission happened inside an outermost
     * `Retree.runTransaction` window (including writes made by listeners
     * during the transaction's flush).
     */
    transaction: boolean;
    /**
     * `true` when the emission happened inside a `Retree.runSilent` window —
     * application listeners were suppressed, but the write still occurred.
     */
    silent: boolean;
}

/**
 * Sink receiving {@link IRetreeChangeLogEntry} values from
 * {@link createChangeLogTap}.
 */
export type TRetreeChangeLogSink = (entry: IRetreeChangeLogEntry) => void;

/**
 * Options for {@link createChangeLogTap}.
 */
export interface IChangeLogTapOptions {
    /**
     * Whether to resolve a key path for each entry. Defaults to `true`.
     *
     * @remarks
     * Path resolution walks the node's parents and scans each parent's raw
     * children for an identity match — `O(depth × width)` per emission. Set
     * to `false` when logging write-heavy trees where that cost matters.
     */
    paths?: boolean;
}
