/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { RetreeSelectOptions, TreeNode } from "@retreejs/core";
import {
    createRetreeTrackedSelectionObserver,
    createRetreeSelectionObserver,
    getBaseProxy,
    getReproxyNode,
    runTrackedSelection,
} from "@retreejs/core/internal";
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeToNode } from "./internals/subscriptionHub";
import { NodeFactory } from "./types";

export type UseSelectOptions<TSelected> = RetreeSelectOptions<TSelected>;

type UseTrackedSelectArgs<TSelected> = [
    selector: () => TSelected,
    options?: UseSelectOptions<TSelected>
];

type UseNodeSelectArgs<TNode extends TreeNode, TSelected> = [
    node: TNode | NodeFactory<TNode>,
    selector: (node: TNode) => TSelected,
    options?: UseSelectOptions<TSelected>
];

function getNode<T extends TreeNode = TreeNode>(node: T | NodeFactory<T>) {
    if (typeof node === "function") {
        return node();
    }
    return node;
}

/**
 * Subscribe to a selected value from any Retree-managed node.
 *
 * @remarks
 * `useSelect` narrows React updates to changes in the selected value or
 * ordered dependency list. Reactive entries in a dependency list are
 * subscribed to; primitive and plain entries are compared by identity. It is a
 * subscription primitive, not a memo cache: use `memo` / `fnMemo` for caching
 * computation and `useSelect` for reducing re-renders.
 *
 * By default `useSelect` listens to `nodeChanged`, which is best when the
 * selector reads fields directly owned by the node. Pass
 * `listenerType: "treeChanged"` when the selector reads descendants that are
 * not included as reactive entries in a dependency list. Pass `equals` when
 * the selected value or tuple should be compared structurally.
 *
 * Dependency-list subscriptions are observational: if a tuple entry changes,
 * `useSelect` may re-render this component, but it does not force the node
 * passed to `useSelect` to receive a fresh reproxy. Use `@select` on a
 * `ReactiveNode` getter when the owner node itself should emit `nodeChanged`.
 * You can also call `useSelect(() => value)` without a node. That form traps
 * reads automatically. Whole Retree-managed values are subscribed to broadly.
 * Property reads subscribe to the owner node but compare the specific property
 * value, so `task.done` can react to task replacement or `done` changes
 * without reacting to unrelated task fields. Primitive reads are kept as
 * comparison values.
 *
 * Do not use `useSelect` to cache expensive computation for reuse elsewhere.
 * Put that work behind `memo`, `@memo`, or `@fnMemo`, then select the cached
 * value.
 *
 * @param node Retree-managed node or node factory to observe.
 * @param selector Function that reads a selected value or dependency list from
 * the latest reproxy.
 * @param options Optional listener type and equality comparison.
 * @returns The latest selected value.
 *
 * @example
 * ```tsx
 * import { Retree } from "@retreejs/core";
 * import { useSelect } from "@retreejs/react";
 *
 * const project = Retree.root({
 *     tasks: [
 *         { title: "Docs", done: false },
 *         { title: "Tests", done: true },
 *     ],
 * });
 *
 * function DoneCount() {
 *     const doneCount = useSelect(
 *         project.tasks,
 *         (tasks) => tasks.filter((task) => task.done).length,
 *         { listenerType: "treeChanged" }
 *     );
 *
 *     return <span>{doneCount}</span>;
 * }
 *
 * project.tasks[0].done = true; // ✅ re-renders DoneCount
 * project.tasks[0].title = "Better docs"; // ❌ no re-render
 * ```
 *
 * @example
 * ```tsx
 * const [, , attribute] = useSelect(row, (self) => [
 *     self.attributes,
 *     self.attributeId,
 *     self.attribute,
 * ]);
 * ```
 *
 * @example
 * ```tsx
 * function DoneCount() {
 *     const doneCount = useSelect(() =>
 *         project.tasks.filter((task) => task.done).length
 *     );
 *
 *     return <span>{doneCount}</span>;
 * }
 * ```
 */
export function useSelect<TNode extends TreeNode, TSelected>(
    ...args:
        | UseTrackedSelectArgs<TSelected>
        | UseNodeSelectArgs<TNode, TSelected>
): TSelected {
    const [nodeOrSelector, selectorOrOptions, options] = args;
    if (args.length < 2) {
        return useTrackedSelect(nodeOrSelector as () => TSelected);
    }
    if (typeof selectorOrOptions !== "function") {
        return useTrackedSelect(
            nodeOrSelector as () => TSelected,
            selectorOrOptions
        );
    }
    return useNodeSelect(
        nodeOrSelector as TNode | NodeFactory<TNode>,
        selectorOrOptions,
        options
    );
}

function useNodeSelect<TNode extends TreeNode, TSelected>(
    node: TNode | NodeFactory<TNode>,
    selector: (node: TNode) => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected {
    const memoNode = useMemo(() => {
        return getNode(node);
    }, [node]);
    const baseProxy = getBaseProxy<TNode>(memoNode);
    const listenerType = options?.listenerType ?? "nodeChanged";
    const equals = options?.equals;
    const selectorRef = useRef(selector);
    const equalsRef = useRef(equals);
    selectorRef.current = selector;
    equalsRef.current = equals;

    const [selectedState, setSelectedState] = useState<{
        baseProxy: TNode;
        selected: TSelected;
    }>(() => ({
        baseProxy,
        selected: selector(getReproxyNode(memoNode)),
    }));

    if (selectedState.baseProxy !== baseProxy) {
        selectedState.baseProxy = baseProxy;
        selectedState.selected = selector(getReproxyNode(baseProxy));
    }

    useEffect(() => {
        return createRetreeSelectionObserver({
            node: baseProxy,
            selector: (reproxy) => selectorRef.current(reproxy),
            equals: equalsRef.current,
            listenerType,
            subscribeToNode,
            onChange: (next) => {
                setSelectedState(() => {
                    return {
                        baseProxy,
                        selected: next,
                    };
                });
            },
        });
    }, [baseProxy, listenerType]);

    return selectedState.selected;
}

function useTrackedSelect<TSelected>(
    selector: () => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected {
    const equals = options?.equals;
    const selectorRef = useRef(selector);
    const equalsRef = useRef(equals);
    selectorRef.current = selector;
    equalsRef.current = equals;

    const [selectedState, setSelectedState] = useState(() => ({
        selected: runTrackedSelection(selector).selected,
    }));

    useEffect(() => {
        return createRetreeTrackedSelectionObserver({
            selector: () => selectorRef.current(),
            equals: equalsRef.current,
            subscribeToNode,
            onChange: (next) => {
                setSelectedState(() => {
                    return {
                        selected: next,
                    };
                });
            },
        });
    }, []);

    return selectedState.selected;
}
