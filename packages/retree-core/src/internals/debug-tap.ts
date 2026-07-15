/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { INodeFieldChanges, TreeNode } from "../types.js";

/**
 * One observation delivered to a Retree debug tap.
 *
 * @remarks
 * `nodeChanged`/`nodeRemoved` mirror the internal emitter events one-to-one:
 * `node` is always the raw node (never a proxy), `rootName` is the name
 * registered for the node's tree root via {@link Retree.registerRootName}
 * when one is known, and `silent` is `true` when the emission happened inside
 * a `Retree.runSilent` window (application listeners were suppressed but the
 * write still occurred). `transactionStart`/`transactionEnd` bracket an
 * outermost `Retree.runTransaction`: every emission observed between the two
 * markers flushes to application listeners as one batch.
 */
export type TRetreeDebugTapEmission =
    | {
          kind: "nodeChanged";
          node: TreeNode;
          rootName: string | undefined;
          changes: INodeFieldChanges[];
          silent: boolean;
      }
    | {
          kind: "nodeRemoved";
          node: TreeNode;
          rootName: string | undefined;
          silent: boolean;
      }
    | { kind: "transactionStart" }
    | { kind: "transactionEnd" };

/**
 * A debug tap callback registered with {@link addRetreeDebugTap}.
 */
export type TRetreeDebugTap = (emission: TRetreeDebugTapEmission) => void;

const debugTaps = new Set<TRetreeDebugTap>();

/**
 * Live count of registered debug taps.
 *
 * @remarks
 * Exported as a mutable binding so the emit hot path can gate all tap work
 * behind a single `if (retreeDebugTapCount > 0)` numeric check — when no tap
 * is registered, emissions pay nothing beyond that comparison.
 */
export let retreeDebugTapCount = 0;

/**
 * Register a debug tap that receives every Retree emission.
 *
 * @remarks
 * Taps observe the raw emission stream that feeds `Retree.on` listeners —
 * including emissions inside `Retree.runSilent` windows, which application
 * listeners never see — plus transaction boundary markers. They are the
 * integration point for devtools (`@retreejs/devtools`); application state
 * logic should use `Retree.on` instead.
 *
 * Taps must be passive: they run synchronously inside the write path, before
 * application listeners, so a slow tap slows every write and a tap that
 * mutates Retree state re-enters the emit path. Exceptions thrown by a tap
 * propagate to the mutating caller.
 *
 * @param tap Callback receiving each {@link TRetreeDebugTapEmission}.
 * @returns Unsubscribe function; safe to call more than once.
 *
 * @example
 * ```ts
 * import { addRetreeDebugTap } from "@retreejs/core/internal";
 *
 * const removeTap = addRetreeDebugTap((emission) => {
 *     if (emission.kind === "nodeChanged") {
 *         console.log(emission.rootName, emission.changes);
 *     }
 * });
 * // later
 * removeTap();
 * ```
 */
export function addRetreeDebugTap(tap: TRetreeDebugTap): () => void {
    debugTaps.add(tap);
    retreeDebugTapCount = debugTaps.size;
    return () => {
        debugTaps.delete(tap);
        retreeDebugTapCount = debugTaps.size;
    };
}

/**
 * Deliver one emission to every registered tap.
 *
 * @remarks
 * Callers must gate on {@link retreeDebugTapCount} first so the zero-tap
 * path never reaches this function (or allocates an emission object).
 */
export function notifyRetreeDebugTaps(emission: TRetreeDebugTapEmission): void {
    for (const tap of [...debugTaps]) {
        tap(emission);
    }
}

// -----------------------------------------------------------------------------
// Named-root registry
// -----------------------------------------------------------------------------

/**
 * Raw root node -> registered name. WeakMap keyed by the raw node so a
 * registered name never pins a discarded tree in memory.
 */
const rootNamesByRawNode = new WeakMap<TreeNode, string>();

/**
 * Registered name -> weak handle on the raw root, kept for enumeration by
 * devtools. WeakRefs let discarded trees be collected; dead entries are
 * pruned on read.
 */
const rootWeakRefsByName = new Map<string, WeakRef<TreeNode>>();

/**
 * Record a display name for a tree root's raw node.
 *
 * @remarks
 * Called by `Retree.registerRootName` with the raw node behind the managed
 * root. Re-registering a node replaces its previous name; re-registering a
 * name points it at the new node.
 */
export function registerRetreeRootName(rawNode: TreeNode, name: string): void {
    const previousName = rootNamesByRawNode.get(rawNode);
    if (previousName !== undefined && previousName !== name) {
        rootWeakRefsByName.delete(previousName);
    }
    rootNamesByRawNode.set(rawNode, name);
    rootWeakRefsByName.set(name, new WeakRef(rawNode));
}

/**
 * Resolve the registered name for a raw root node, if any.
 */
export function getRetreeRootName(rawNode: TreeNode): string | undefined {
    return rootNamesByRawNode.get(rawNode);
}

/**
 * Enumerate the currently registered named roots as `name -> raw node`.
 *
 * @remarks
 * For devtools. Entries whose root has been garbage-collected are pruned and
 * omitted. The returned map is a snapshot; mutating it has no effect on the
 * registry.
 */
export function getNamedRetreeRoots(): Map<string, TreeNode> {
    const namedRoots = new Map<string, TreeNode>();
    for (const [name, weakRef] of rootWeakRefsByName.entries()) {
        const rawNode = weakRef.deref();
        if (rawNode === undefined) {
            rootWeakRefsByName.delete(name);
            continue;
        }
        namedRoots.set(name, rawNode);
    }
    return namedRoots;
}
