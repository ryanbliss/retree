/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { RetreeSelectOptions, TreeNode } from "@retreejs/core";
import { getBaseProxy, getReproxyNode } from "@retreejs/core/internal";
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeToNode } from "./internals/subscriptionHub";
import { NodeFactory } from "./types";

export type UseSelectOptions<TSelected> = RetreeSelectOptions<TSelected>;

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
 * `useSelect` narrows React updates to changes in the selected value. It is
 * a subscription primitive, not a memo cache: use `memo` / `fnMemo` for
 * caching computation and `useSelect` for reducing re-renders.
 *
 * By default `useSelect` listens to `nodeChanged`, which is best when the
 * selector reads fields directly owned by the node. Pass
 * `listenerType: "treeChanged"` when the selector reads descendants. Pass
 * `equals` when the selector returns a new object or array that should be
 * compared structurally.
 *
 * Do not use `useSelect` to cache expensive computation for reuse elsewhere.
 * Put that work behind `memo`, `@memo`, or `@fnMemo`, then select the cached
 * value.
 *
 * @param node Retree-managed node or node factory to observe.
 * @param selector Function that reads a selected value from the latest reproxy.
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
 */
export function useSelect<TNode extends TreeNode, TSelected>(
    node: TNode | NodeFactory<TNode>,
    selector: (node: TNode) => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected {
    const memoNode = useMemo(() => {
        return getNode(node);
    }, [node]);
    const baseProxy = getBaseProxy<TNode>(memoNode);
    const listenerType = options?.listenerType ?? "nodeChanged";
    const equals = options?.equals ?? Object.is;
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
        let previous = selectorRef.current(getReproxyNode(baseProxy));
        return subscribeToNode<TNode>(baseProxy, listenerType, (reproxy) => {
            const next = selectorRef.current(reproxy);
            if (equalsRef.current(previous, next)) {
                return;
            }
            previous = next;
            setSelectedState((previousState) => {
                if (equalsRef.current(previousState.selected, next)) {
                    return previousState;
                }
                return {
                    baseProxy,
                    selected: next,
                };
            });
        });
    }, [baseProxy, listenerType]);

    return selectedState.selected;
}
