/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { RetreeSelectOptions, TreeNode } from "@retreejs/core";
import {
    areTrackedComparisonValuesEqual,
    defaultSelectShouldNotify,
    defaultTrackedSelectedChanged,
    getBaseProxy,
    getReproxyNode,
    getTrackedDependencyComparisonValues,
    normalizeDependencyEntry,
    normalizeSelectDependencies,
    runTrackedSelection,
    stabilizeSelectedRetreeReferences,
    TrackedSelection,
} from "@retreejs/core/internal";
import { useMemo } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
import {
    areRetreeExternalStoreSourcesEqual,
    getRetreeExternalStoreSource,
    RetreeCompositeSnapshot,
    RetreeExternalStoreSource,
    useRetreeCompositeExternalStore,
} from "./internals/externalStore";
import { NodeFactory } from "./types";

export type UseSelectOptions<TSelected> = RetreeSelectOptions<TSelected>;

function getNode<T extends TreeNode = TreeNode>(node: T | NodeFactory<T>) {
    if (typeof node === "function") {
        return node();
    }
    return node;
}

function isTrackedSelector(value: unknown): value is () => unknown {
    return typeof value === "function";
}

function isNodeSelector(value: unknown): value is (node: TreeNode) => unknown {
    return typeof value === "function";
}

function isNodeOrFactory(
    value: unknown
): value is TreeNode | NodeFactory<TreeNode> {
    return (
        typeof value === "function" ||
        (value !== null && typeof value === "object")
    );
}

function getOptions(
    value: unknown,
    argumentName: string
): UseSelectOptions<unknown> | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        throw new Error(
            `useSelect: ${argumentName} must be an options object or undefined, but received null.`
        );
    }
    if (typeof value !== "object") {
        throw new Error(
            `useSelect: ${argumentName} must be an options object or undefined, but received ${typeof value}.`
        );
    }
    return value;
}

interface NodeSelection<TSelected> {
    selected: TSelected;
    sources: readonly RetreeExternalStoreSource[];
    dependencyIndices: ReadonlyMap<
        RetreeExternalStoreSource,
        readonly number[]
    >;
}

interface NodeSelectionSnapshot<TSelected> extends NodeSelection<TSelected> {
    snapshot: RetreeCompositeSnapshot;
}

interface TrackedSelectionSnapshot<TSelected> {
    selection: TrackedSelection<TSelected>;
    snapshot: RetreeCompositeSnapshot;
    sources: readonly RetreeExternalStoreSource[];
}

function getNodeSelection<TNode extends TreeNode, TSelected>(
    baseProxy: TNode,
    selector: (node: TNode) => TSelected,
    listenerType: "nodeChanged" | "treeChanged"
): NodeSelection<TSelected> {
    const selected = selector(getReproxyNode(baseProxy));
    const rootSource = getRetreeExternalStoreSource(baseProxy, listenerType);
    const sources: RetreeExternalStoreSource[] = [rootSource];
    const dependencyIndices = new Map<RetreeExternalStoreSource, number[]>();
    const dependencies = normalizeSelectDependencies(selected);

    for (let index = 0; index < dependencies.length; index++) {
        const dependency = normalizeDependencyEntry(dependencies[index]);
        if (dependency.node === undefined) {
            continue;
        }
        const dependencyBaseProxy = getBaseProxy(dependency.node);
        if (dependencyBaseProxy === baseProxy) {
            continue;
        }
        const source = getRetreeExternalStoreSource(
            dependencyBaseProxy,
            "nodeChanged"
        );
        const existingIndices = dependencyIndices.get(source);
        if (existingIndices !== undefined) {
            existingIndices.push(index);
            continue;
        }
        dependencyIndices.set(source, [index]);
        sources.push(source);
    }

    return {
        selected,
        sources,
        dependencyIndices,
    };
}

function getTrackedSelectionSources(
    selection: TrackedSelection<unknown>
): readonly RetreeExternalStoreSource[] {
    const sources: RetreeExternalStoreSource[] = [];
    const seen = new Set<RetreeExternalStoreSource>();
    for (const dependency of selection.dependencies) {
        const normalized = normalizeDependencyEntry(dependency);
        if (normalized.node === undefined) {
            continue;
        }
        const source = getRetreeExternalStoreSource(
            getBaseProxy(normalized.node),
            "nodeChanged"
        );
        if (seen.has(source)) {
            continue;
        }
        seen.add(source);
        sources.push(source);
    }
    return sources;
}

function getChangedNodeDependencyIndices<TSelected>(
    previous: NodeSelectionSnapshot<TSelected>,
    next: NodeSelectionSnapshot<TSelected>
): readonly number[] | undefined {
    const indices = new Set<number>();
    let foundVersionChange = false;
    for (let index = 0; index < next.snapshot.sources.length; index++) {
        if (
            Object.is(
                previous.snapshot.versions[index],
                next.snapshot.versions[index]
            )
        ) {
            continue;
        }
        foundVersionChange = true;
        const source = next.snapshot.sources[index];
        const dependencyIndices =
            next.dependencyIndices.get(source) ??
            previous.dependencyIndices.get(source);
        if (dependencyIndices === undefined) {
            return undefined;
        }
        for (const dependencyIndex of dependencyIndices) {
            indices.add(dependencyIndex);
        }
    }
    if (!foundVersionChange) {
        return undefined;
    }
    return [...indices];
}

function areNodeSelectionsEqual<TSelected>(
    previous: NodeSelectionSnapshot<TSelected>,
    next: NodeSelectionSnapshot<TSelected>,
    equals: UseSelectOptions<TSelected>["equals"]
): boolean {
    let selectedEqual: boolean;
    if (equals !== undefined) {
        selectedEqual = equals(previous.selected, next.selected);
    } else {
        const changedDependencyIndices = getChangedNodeDependencyIndices(
            previous,
            next
        );
        if (changedDependencyIndices === undefined) {
            selectedEqual = !defaultSelectShouldNotify(
                previous.selected,
                next.selected
            );
        } else {
            selectedEqual = !changedDependencyIndices.some((index) =>
                defaultSelectShouldNotify(
                    previous.selected,
                    next.selected,
                    index
                )
            );
        }
    }

    if (selectedEqual) {
        next.selected = previous.selected;
    }
    return (
        selectedEqual &&
        areRetreeExternalStoreSourcesEqual(previous.sources, next.sources)
    );
}

function areTrackedSelectionsEqual<TSelected>(
    previous: TrackedSelectionSnapshot<TSelected>,
    next: TrackedSelectionSnapshot<TSelected>,
    equals: UseSelectOptions<TSelected>["equals"]
): boolean {
    const stabilizedSelected = stabilizeSelectedRetreeReferences(
        previous.selection.selected,
        next.selection.selected
    );
    next.selection.selected = stabilizedSelected;
    const selectedEqual =
        equals !== undefined
            ? equals(previous.selection.selected, stabilizedSelected)
            : !defaultTrackedSelectedChanged(
                  previous.selection.selected,
                  stabilizedSelected
              );
    const dependenciesEqual = areTrackedComparisonValuesEqual(
        getTrackedDependencyComparisonValues(previous.selection.dependencies),
        getTrackedDependencyComparisonValues(next.selection.dependencies)
    );

    if (selectedEqual) {
        next.selection.selected = previous.selection.selected;
    }
    return (
        selectedEqual &&
        dependenciesEqual &&
        areRetreeExternalStoreSourcesEqual(previous.sources, next.sources)
    );
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
 * The node form's first argument is the Retree-managed node or node factory to
 * observe.
 *
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
export function useSelect<TSelected>(
    selector: () => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected;
// TypeScript overload signatures intentionally share the exported hook name.
// eslint-disable-next-line no-redeclare
export function useSelect<TNode extends TreeNode, TSelected>(
    node: TNode | NodeFactory<TNode>,
    selector: (node: TNode) => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected;
// eslint-disable-next-line no-redeclare
export function useSelect(...args: unknown[]): unknown {
    const [nodeOrSelector, selectorOrOptions, optionsValue] = args;
    if (!isNodeSelector(selectorOrOptions)) {
        if (!isTrackedSelector(nodeOrSelector)) {
            throw new Error(
                "useSelect: the selector-only form requires a selector function as its first argument."
            );
        }
        const options = getOptions(selectorOrOptions, "second argument");
        return useTrackedSelect(nodeOrSelector, options);
    }
    if (!isNodeOrFactory(nodeOrSelector)) {
        throw new Error(
            "useSelect: the node form requires a Retree-managed node or node factory as its first argument."
        );
    }
    const options = getOptions(optionsValue, "third argument");
    return useNodeSelect(nodeOrSelector, selectorOrOptions, options);
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
    const renderSelection = getNodeSelection(baseProxy, selector, listenerType);
    const store = useRetreeCompositeExternalStore(renderSelection.sources);
    const selection = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        (snapshot): NodeSelectionSnapshot<TSelected> => ({
            ...getNodeSelection(baseProxy, selector, listenerType),
            snapshot,
        }),
        (previous, next) => areNodeSelectionsEqual(previous, next, equals)
    );

    return selection.selected;
}

function useTrackedSelect<TSelected>(
    selector: () => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected {
    const equals = options?.equals;
    const renderSelection = runTrackedSelection(selector);
    const renderSources = getTrackedSelectionSources(renderSelection);
    const store = useRetreeCompositeExternalStore(renderSources);
    const selection = useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
        (snapshot): TrackedSelectionSnapshot<TSelected> => {
            const trackedSelection = runTrackedSelection(selector);
            return {
                selection: trackedSelection,
                snapshot,
                sources: getTrackedSelectionSources(trackedSelection),
            };
        },
        (previous, next) => areTrackedSelectionsEqual(previous, next, equals)
    );

    return selection.selection.selected;
}
