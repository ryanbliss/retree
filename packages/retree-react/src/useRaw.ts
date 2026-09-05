/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo" is load-bearing when this source is compiled by the React
// Compiler (source-inclusion setups only; consumers' compilers skip the
// published bin/ output in node_modules). See useNodeInternalCore.ts and
// react-compiler.spec.tsx for the failure mode and proof.
"use no memo";
"use client";

import { Retree, TreeNode } from "@retreejs/core";
import {
    getBaseProxy,
    getGlobalWriteVersion,
    getWrittenOwnersSince,
    getUnproxiedNode,
    createDirectChildResolver,
} from "@retreejs/core/internal";
import { useCallback, useMemo } from "react";
import {
    getRetreeExternalStoreSource,
    useRetreeExternalStore,
} from "./internals/externalStore.js";
import { useNodeFactoryResetWarning } from "./internals/factoryWarning.js";
import { NodeFactory } from "./types.js";

/**
 * Resolves a raw value back to its Retree-managed node.
 *
 * @remarks
 * Returned by {@link useRaw}. Direct children of the subscribed node are
 * guaranteed to resolve (they are materialized on demand); deeper raw values
 * resolve when they have been materialized. Pass `{ key: indexOrKey }` to
 * bypass the raw slot index for an array, object, or Map. Set lookup is direct.
 */
export type ToManaged = <T extends TreeNode>(
    rawValue: T,
    location?: { key: unknown }
) => T | undefined;

export interface UseRawOptions {
    /**
     * Listener type for re-render invalidation. Defaults to `"nodeChanged"`,
     * exactly like `useNode`: the component re-renders when the node's own
     * data changes. Pass `"treeChanged"` to opt in to subtree invalidation.
     */
    listenerType?: "nodeChanged" | "treeChanged";
}

function getNode<T extends TreeNode = TreeNode>(node: T | NodeFactory<T>) {
    if (typeof node === "function") {
        return node();
    }
    return node;
}

// The compatibility value lookup indexes raw slots once per structural change.
// Supplying a key skips this index entirely.
const childIndexes = new WeakMap<
    TreeNode,
    { version: number; keys: Map<object, unknown> }
>();

function findChildKey(
    base: TreeNode,
    raw: TreeNode,
    value: object
): { key: unknown } | undefined {
    if (raw instanceof Set) return raw.has(value) ? { key: value } : undefined;
    const version = getGlobalWriteVersion();
    let index = childIndexes.get(base);
    if (index !== undefined && index.version !== version) {
        const owners = getWrittenOwnersSince(index.version);
        if (owners !== undefined && !owners.has(raw)) index.version = version;
    }
    if (index?.version !== version) {
        const keys = new Map<object, unknown>();
        const add = (key: unknown, child: unknown) => {
            if (child !== null && typeof child === "object" && !keys.has(child))
                keys.set(child, key);
        };
        if (raw instanceof Map) {
            for (const [key, child] of raw) add(key, child);
        } else {
            for (const key of Object.keys(raw)) add(key, Reflect.get(raw, key));
        }
        index = { version, keys };
        childIndexes.set(base, index);
    }
    return index.keys.has(value) ? { key: index.keys.get(value) } : undefined;
}

/**
 * Subscribe to a node like `useNode`, but read its data raw — native-speed,
 * proxy-free reads for render bodies that read wide.
 *
 * @remarks
 * Returns `[raw, toManaged]`:
 *
 * - `raw` is the live raw object behind the node ({@link Retree.raw}) —
 *   zero-copy and guaranteed proxy-free. Treat it as **read-only**: writes go
 *   through nodes. Raw references keep the same identity across changes, so
 *   never use them as `React.memo` props, `useMemo` deps, or equality
 *   tokens — nodes remain the identity currency.
 * - `toManaged` resolves a raw value back to its managed node. Direct children
 *   of the subscribed node always resolve (object/array children, Map
 *   values, and Set members are materialized on demand); use it to pass
 *   nodes to child components while mapping raw content.
 *
 * Invalidation follows the same contract as `useNode`: the component
 * re-renders when the node's own data changes (`nodeChanged` default). Deep
 * changes re-render only when declared — via the node's `dependencies` /
 * `@select`, via `useSelect` for derived views, or via the `treeChanged`
 * opt-in. Because `raw` is live, any render (including renders triggered by
 * a parent) reads current state.
 *
 * An inline node factory like `useRaw(() => Retree.root({ ... }))` re-runs
 * every render and silently resets state: hoist the factory (and its
 * `Retree.root` call) outside the component, or use `useRoot`.
 *
 * @param node Retree-managed node or node factory to observe.
 * @param options Optional listener type.
 * @returns `[raw, toManaged]` tuple.
 *
 * @example
 * ```tsx
 * function TaskListView({ list }: { list: TaskList }) {
 *     // Re-renders only when the array itself changes.
 *     const [tasksRaw, toManaged] = useRaw(list.tasks);
 *     return (
 *         <ul>
 *             {tasksRaw.map((rawTask, index) => (
 *                 <TaskRow key={rawTask.id} task={toManaged(rawTask, { key: index })!} />
 *             ))}
 *         </ul>
 *     );
 * }
 *
 * const TaskRow = React.memo(function TaskRow({ task }: { task: Task }) {
 *     const t = useNode(task); // node prop: own subscription, write surface
 *     return <li onClick={() => (t.isComplete = !t.isComplete)}>{t.title}</li>;
 * });
 * ```
 */
export function useRaw<TNode extends TreeNode>(
    node: TNode | NodeFactory<TNode>,
    options?: UseRawOptions
): [TNode, ToManaged] {
    const memoNode = useMemo(() => {
        return getNode(node);
    }, [node]);
    const baseProxy = getBaseProxy(memoNode);
    useNodeFactoryResetWarning("useRaw", node, baseProxy);
    const listenerType = options?.listenerType ?? "nodeChanged";

    const source = getRetreeExternalStoreSource(baseProxy, listenerType);
    useRetreeExternalStore([source]);

    const resolveChild = useMemo(
        () => createDirectChildResolver(baseProxy),
        [baseProxy]
    );
    const rawNode = Retree.raw(baseProxy);
    const toManaged: ToManaged = useCallback(
        <T extends TreeNode>(rawValue: T, location?: { key: unknown }) => {
            const existing = Retree.managed(rawValue);
            if (existing !== undefined) return existing;
            const raw = rawNode;
            const slot = location ?? findChildKey(baseProxy, raw, rawValue);
            if (slot === undefined) return undefined;
            return resolveChild(slot.key, rawValue) as T | undefined;
        },
        [baseProxy, rawNode, resolveChild]
    );

    const raw = getUnproxiedNode(baseProxy);
    if (raw === undefined) {
        throw new Error(
            "useRaw: could not resolve the raw value for the Retree-managed base proxy. This is an internal Retree invariant failure. Fix: file an issue with the node passed to useRaw and any preceding move, clone, or link operation."
        );
    }
    return useMemo(() => [raw, toManaged], [raw, toManaged]);
}
