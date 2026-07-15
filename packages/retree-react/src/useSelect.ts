/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo" documents intent and is belt-and-braces here: the React
// Compiler's own validation already bails on this file (committed-state refs
// are read during render by design, and the useSelect overload trampoline
// dispatches to different hooks per form). See useNodeInternalCore.ts and
// react-compiler.spec.tsx for why the directive family is load-bearing.
"use no memo";
"use client";

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
import { useEffect, useMemo, useRef } from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";
import {
    areRetreeExternalStoreSourcesEqual,
    createRetreeSwappableCompositeExternalStore,
    getRetreeExternalStoreSource,
    RetreeCompositeSnapshot,
    RetreeExternalStoreSource,
    RetreeSwappableCompositeExternalStore,
} from "./internals/externalStore.js";
import { useNodeFactoryResetWarning } from "./internals/factoryWarning.js";
import { NodeFactory } from "./types.js";

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

interface NodeSelectionSnapshot<TSelected> {
    selection: NodeSelection<TSelected>;
    snapshot: RetreeCompositeSnapshot;
}

/**
 * The value returned from the external-store snapshot getter. Its identity
 * changes exactly when the component should re-render, so it doubles as the
 * `Object.is` re-render key for `useSyncExternalStore`.
 */
interface SelectionContainer<TSelected> {
    readonly selected: TSelected;
}

/**
 * The per-render memoization instance for one `useSelect` hook call site.
 *
 * Created by `useMemo` keyed on the recompute inputs (observed node, listener
 * type, and user selector identity). The `state` object is mutable cache
 * shared with the `getSelection` closure; everything it caches is derived
 * from global Retree versions plus the instance's fixed selector, so calls
 * from discarded concurrent renders can only move the cache forward, never
 * poison committed state with render-scoped data.
 */
interface SelectInstance<TState, TSelected> {
    readonly state: TState;
    readonly getSelection: () => SelectionContainer<TSelected>;
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
            next.selection.dependencyIndices.get(source) ??
            previous.selection.dependencyIndices.get(source);
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

function isNodeSelectedEqual<TSelected>(
    previous: NodeSelectionSnapshot<TSelected>,
    next: NodeSelectionSnapshot<TSelected>,
    equals: UseSelectOptions<TSelected>["equals"]
): boolean {
    if (equals !== undefined) {
        return equals(previous.selection.selected, next.selection.selected);
    }
    const changedDependencyIndices = getChangedNodeDependencyIndices(
        previous,
        next
    );
    if (changedDependencyIndices === undefined) {
        return !defaultSelectShouldNotify(
            previous.selection.selected,
            next.selection.selected
        );
    }
    return !changedDependencyIndices.some((index) =>
        defaultSelectShouldNotify(
            previous.selection.selected,
            next.selection.selected,
            index
        )
    );
}

/**
 * Per-hook memoization state for the node form of `useSelect`.
 *
 * The user selector runs only when this state is (re)created — the observed
 * node, listener type, or selector identity changed — or when
 * {@link refreshNodeSelectState} observes a new composite-store snapshot (a
 * subscribed source's version advanced). Unrelated parent re-renders with a
 * stable selector reuse the cached selection.
 */
interface NodeSelectState<TNode extends TreeNode, TSelected> {
    readonly baseProxy: TNode;
    readonly listenerType: "nodeChanged" | "treeChanged";
    selection: NodeSelection<TSelected>;
    /**
     * Swappable so a render-phase refresh that moves the dependency sources
     * rewires the live `useSyncExternalStore` subscription in place instead
     * of stranding it on the old sources (uSES captures `subscribe` before it
     * calls `getSnapshot`, so a store replaced during that call would never
     * be resubscribed to). The handle identity — and therefore the
     * `subscribe` identity uSES sees — is stable for the life of this state.
     */
    readonly store: RetreeSwappableCompositeExternalStore;
    snapshot: RetreeCompositeSnapshot;
    container: SelectionContainer<TSelected>;
}

function createNodeSelectState<TNode extends TreeNode, TSelected>(
    baseProxy: TNode,
    listenerType: "nodeChanged" | "treeChanged",
    selector: (node: TNode) => TSelected
): NodeSelectState<TNode, TSelected> {
    const selection = getNodeSelection(baseProxy, selector, listenerType);
    const store = createRetreeSwappableCompositeExternalStore(
        selection.sources
    );
    return {
        baseProxy,
        listenerType,
        selection,
        store,
        snapshot: store.getSnapshot(),
        container: { selected: selection.selected },
    };
}

function refreshNodeSelectState<TNode extends TreeNode, TSelected>(
    state: NodeSelectState<TNode, TSelected>,
    selector: (node: TNode) => TSelected,
    equals: UseSelectOptions<TSelected>["equals"]
): SelectionContainer<TSelected> {
    const snapshot = state.store.getSnapshot();
    if (snapshot === state.snapshot) {
        return state.container;
    }
    const nextSelection = getNodeSelection(
        state.baseProxy,
        selector,
        state.listenerType
    );
    const previous: NodeSelectionSnapshot<TSelected> = {
        selection: state.selection,
        snapshot: state.snapshot,
    };
    const next: NodeSelectionSnapshot<TSelected> = {
        selection: nextSelection,
        snapshot,
    };
    const selectedEqual = isNodeSelectedEqual(previous, next, equals);
    const sourcesEqual = areRetreeExternalStoreSourcesEqual(
        state.selection.sources,
        nextSelection.sources
    );
    if (selectedEqual && sourcesEqual) {
        state.snapshot = snapshot;
        return state.container;
    }
    if (selectedEqual) {
        // Reference stabilization: the selected value is unchanged, so keep
        // handing out the previous reference even though the subscription
        // sources moved.
        nextSelection.selected = state.container.selected;
    }
    if (!sourcesEqual) {
        // Render-phase dependency move: swap the sources inside the stable
        // store handle so the live subscription rewires immediately. See
        // createRetreeSwappableCompositeExternalStore for why replacing the
        // store object here would strand the committed subscription.
        state.store.swapSources(nextSelection.sources);
    }
    state.selection = nextSelection;
    state.snapshot = state.store.getSnapshot();
    state.container = { selected: nextSelection.selected };
    return state.container;
}

/**
 * Render-phase recompute for the node form when only the user selector's
 * function identity changed (typically an inline selector capturing fresh
 * render-scoped values such as props).
 *
 * Returns a brand-new state object instead of mutating `committed`: this runs
 * during render, so a discarded concurrent render must leave the committed
 * state untouched. Container and store identities are reused from the
 * committed state when the selected value and sources are unchanged, which
 * preserves reference stabilization and avoids resubscription churn for
 * inline selectors.
 */
function recomputeNodeSelectStateForSelector<TNode extends TreeNode, TSelected>(
    committed: NodeSelectState<TNode, TSelected>,
    selector: (node: TNode) => TSelected,
    equals: UseSelectOptions<TSelected>["equals"]
): NodeSelectState<TNode, TSelected> {
    const nextSelection = getNodeSelection(
        committed.baseProxy,
        selector,
        committed.listenerType
    );
    let selectedEqual: boolean;
    if (equals !== undefined) {
        selectedEqual = equals(
            committed.container.selected,
            nextSelection.selected
        );
    } else {
        // No source version changed here (only the selector identity did), so
        // compare the whole selection — the same fallback the version-diffing
        // comparison uses when it finds no changed dependency indices.
        selectedEqual = !defaultSelectShouldNotify(
            committed.selection.selected,
            nextSelection.selected
        );
    }
    let container = committed.container;
    if (selectedEqual) {
        // Reference stabilization: keep handing out the previous reference.
        nextSelection.selected = committed.container.selected;
    } else {
        container = { selected: nextSelection.selected };
    }
    const sourcesEqual = areRetreeExternalStoreSourcesEqual(
        committed.selection.sources,
        nextSelection.sources
    );
    // Reuse the committed store handle when the sources are unchanged so the
    // `subscribe` identity stays stable (no resubscription churn for inline
    // selectors). When the sources moved, a NEW handle is created instead of
    // swapping the committed one: this runs during render for a state object
    // that has not committed yet, and the new handle's `subscribe` identity
    // makes `useSyncExternalStore` resubscribe on commit.
    let store = committed.store;
    if (!sourcesEqual) {
        store = createRetreeSwappableCompositeExternalStore(
            nextSelection.sources
        );
    }
    return {
        baseProxy: committed.baseProxy,
        listenerType: committed.listenerType,
        selection: nextSelection,
        store,
        snapshot: store.getSnapshot(),
        container,
    };
}

/**
 * Per-hook memoization state for the selector-only (tracked) form of
 * `useSelect`. Mirrors {@link NodeSelectState}; tracked runs additionally pay
 * dependency-tracking proxy overhead, so avoiding re-runs matters even more.
 */
interface TrackedSelectState<TSelected> {
    comparisonValues: readonly unknown[];
    sources: readonly RetreeExternalStoreSource[];
    /**
     * Swappable for the same reason as {@link NodeSelectState.store}: a
     * render-phase refresh that moves the tracked sources rewires the live
     * subscription in place while keeping the `subscribe` identity stable.
     */
    readonly store: RetreeSwappableCompositeExternalStore;
    snapshot: RetreeCompositeSnapshot;
    container: SelectionContainer<TSelected>;
}

function createTrackedSelectState<TSelected>(
    selector: () => TSelected
): TrackedSelectState<TSelected> {
    const selection = runTrackedSelection(selector);
    const sources = getTrackedSelectionSources(selection);
    const store = createRetreeSwappableCompositeExternalStore(sources);
    return {
        comparisonValues: getTrackedDependencyComparisonValues(
            selection.dependencies
        ),
        sources,
        store,
        snapshot: store.getSnapshot(),
        container: { selected: selection.selected },
    };
}

function refreshTrackedSelectState<TSelected>(
    state: TrackedSelectState<TSelected>,
    selector: () => TSelected,
    equals: UseSelectOptions<TSelected>["equals"]
): SelectionContainer<TSelected> {
    const snapshot = state.store.getSnapshot();
    if (snapshot === state.snapshot) {
        return state.container;
    }
    const nextSelection = runTrackedSelection(selector);
    const stabilizedSelected = stabilizeSelectedRetreeReferences(
        state.container.selected,
        nextSelection.selected
    );
    const selectedEqual =
        equals !== undefined
            ? equals(state.container.selected, stabilizedSelected)
            : !defaultTrackedSelectedChanged(
                  state.container.selected,
                  stabilizedSelected
              );
    const nextComparisonValues = getTrackedDependencyComparisonValues(
        nextSelection.dependencies
    );
    const dependenciesEqual = areTrackedComparisonValuesEqual(
        state.comparisonValues,
        nextComparisonValues
    );
    const nextSources = getTrackedSelectionSources(nextSelection);
    const sourcesEqual = areRetreeExternalStoreSourcesEqual(
        state.sources,
        nextSources
    );
    if (selectedEqual && dependenciesEqual && sourcesEqual) {
        state.snapshot = snapshot;
        return state.container;
    }
    let selected = stabilizedSelected;
    if (selectedEqual) {
        // Reference stabilization: dependencies or sources changed but the
        // selected value did not, so keep handing out the previous reference.
        selected = state.container.selected;
    }
    if (!sourcesEqual) {
        // Render-phase dependency move: swap the sources inside the stable
        // store handle so the live subscription rewires immediately. See
        // createRetreeSwappableCompositeExternalStore for why replacing the
        // store object here would strand the committed subscription.
        state.store.swapSources(nextSources);
    }
    state.comparisonValues = nextComparisonValues;
    state.sources = nextSources;
    state.snapshot = state.store.getSnapshot();
    state.container = { selected };
    return state.container;
}

/**
 * Render-phase recompute for the tracked form when only the user selector's
 * function identity changed (typically an inline selector capturing fresh
 * render-scoped values such as props).
 *
 * Runs the new selector under dependency tracking and returns a brand-new
 * state object instead of mutating `committed`: this runs during render, so a
 * discarded concurrent render must leave the committed state untouched.
 * Container and store identities are reused from the committed state when the
 * selected value and sources are unchanged; when the tracked sources moved,
 * the new store's `subscribe` identity makes `useSyncExternalStore`
 * resubscribe on commit.
 */
function recomputeTrackedSelectStateForSelector<TSelected>(
    committed: TrackedSelectState<TSelected>,
    selector: () => TSelected,
    equals: UseSelectOptions<TSelected>["equals"]
): TrackedSelectState<TSelected> {
    const nextSelection = runTrackedSelection(selector);
    const stabilizedSelected = stabilizeSelectedRetreeReferences(
        committed.container.selected,
        nextSelection.selected
    );
    const selectedEqual =
        equals !== undefined
            ? equals(committed.container.selected, stabilizedSelected)
            : !defaultTrackedSelectedChanged(
                  committed.container.selected,
                  stabilizedSelected
              );
    let container = committed.container;
    if (!selectedEqual) {
        container = { selected: stabilizedSelected };
    }
    let sources = getTrackedSelectionSources(nextSelection);
    const sourcesEqual = areRetreeExternalStoreSourcesEqual(
        committed.sources,
        sources
    );
    // Reuse the committed store handle when the sources are unchanged so the
    // `subscribe` identity stays stable (no resubscription churn for inline
    // selectors). When the sources moved, a NEW handle is created instead of
    // swapping the committed one: this runs during render for a state object
    // that has not committed yet, and the new handle's `subscribe` identity
    // makes `useSyncExternalStore` resubscribe on commit.
    let store = committed.store;
    if (sourcesEqual) {
        // Keep the committed array identity so later comparisons stay cheap.
        sources = committed.sources;
    } else {
        store = createRetreeSwappableCompositeExternalStore(sources);
    }
    return {
        comparisonValues: getTrackedDependencyComparisonValues(
            nextSelection.dependencies
        ),
        sources,
        store,
        snapshot: store.getSnapshot(),
        container,
    };
}

/**
 * Dev-time guard: the two `useSelect` forms call different React hooks, so a
 * call site flipping between them across renders would otherwise surface as
 * React's cryptic hook-order error. Detect the flip first and throw a precise
 * Retree error.
 */
function useSelectFormGuard(isNodeForm: boolean): void {
    const formRef = useRef(isNodeForm);
    if (formRef.current !== isNodeForm) {
        throw new Error(
            "useSelect switched between selector-only and node form between renders. A useSelect call site must use the same overload on every render because the two forms use different React hooks internally. Fix: keep the argument shape stable at this call site, or split the two forms into separate components."
        );
    }
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
 * The selector is memoized per hook instance: it re-runs when a subscribed
 * source changes, when the observed node changes, or when the selector's
 * function identity changes between renders. An inline selector gets a fresh
 * identity every render, so it re-runs once per render and may safely close
 * over props and other render-scoped values. A hoisted or `useCallback`-stable
 * selector skips unrelated parent re-renders entirely — so it must not close
 * over values that change between renders (other than the node and
 * Retree-managed reads); include such captures in the `useCallback` dependency
 * list so the selector identity changes with them. Changing only the `equals`
 * function identity never re-runs the selector: `equals` is consulted when a
 * recompute happens, to stabilize outputs.
 *
 * Do not use `useSelect` to cache expensive computation for reuse elsewhere.
 * Put that work behind `memo`, `@memo`, or `@fnMemo`, then select the cached
 * value.
 *
 * The node form's first argument is the Retree-managed node or node factory to
 * observe. An inline factory like `useSelect(() => Retree.root({ ... }), ...)`
 * re-runs every render and silently resets state: hoist the factory (and its
 * `Retree.root` call) outside the component, or use `useRoot`.
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
    const isNodeForm = isNodeSelector(selectorOrOptions);
    useSelectFormGuard(isNodeForm);
    if (!isNodeForm) {
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
    useNodeFactoryResetWarning("useSelect", node, baseProxy);
    const listenerType = options?.listenerType ?? "nodeChanged";
    const equals = options?.equals;

    // `equals` only stabilizes outputs, so an `equals` identity change never
    // forces a recompute. Both refs are written from the commit effect below
    // (never during render), so a discarded concurrent render cannot leave
    // its closures behind for the committed tree's store-change path. See
    // useStableRetreeExternalStoreSources in ./internals/externalStore.ts for
    // the same pattern.
    const equalsRef = useRef(equals);
    const committedStateRef = useRef<
        NodeSelectState<TNode, TSelected> | undefined
    >(undefined);

    const instance = useMemo<
        SelectInstance<NodeSelectState<TNode, TSelected>, TSelected>
    >(() => {
        const committed = committedStateRef.current;
        let state: NodeSelectState<TNode, TSelected>;
        if (
            committed !== undefined &&
            committed.baseProxy === baseProxy &&
            committed.listenerType === listenerType
        ) {
            // Only the selector identity changed: recompute with the new
            // selector so captured render-scoped values (like props) are
            // reflected immediately, stabilizing against the committed state.
            state = recomputeNodeSelectStateForSelector(
                committed,
                selector,
                equalsRef.current
            );
        } else {
            state = createNodeSelectState(baseProxy, listenerType, selector);
        }
        const getSelection = () =>
            refreshNodeSelectState(state, selector, equalsRef.current);
        return { state, getSelection };
    }, [baseProxy, listenerType, selector]);

    useEffect(() => {
        equalsRef.current = equals;
        committedStateRef.current = instance.state;
    });

    const container = useSyncExternalStore(
        instance.state.store.subscribe,
        instance.getSelection,
        instance.getSelection
    );
    return container.selected;
}

function useTrackedSelect<TSelected>(
    selector: () => TSelected,
    options?: UseSelectOptions<TSelected>
): TSelected {
    const equals = options?.equals;

    // Written from the commit effect below (never during render) so discarded
    // concurrent renders cannot poison committed state. See useNodeSelect.
    const equalsRef = useRef(equals);
    const committedStateRef = useRef<TrackedSelectState<TSelected> | undefined>(
        undefined
    );

    const instance = useMemo<
        SelectInstance<TrackedSelectState<TSelected>, TSelected>
    >(() => {
        const committed = committedStateRef.current;
        let state: TrackedSelectState<TSelected>;
        if (committed !== undefined) {
            // Only the selector identity changed: recompute under tracking so
            // captured render-scoped values (like props) are reflected
            // immediately, resubscribing if the tracked sources moved.
            state = recomputeTrackedSelectStateForSelector(
                committed,
                selector,
                equalsRef.current
            );
        } else {
            state = createTrackedSelectState(selector);
        }
        const getSelection = () =>
            refreshTrackedSelectState(state, selector, equalsRef.current);
        return { state, getSelection };
    }, [selector]);

    useEffect(() => {
        equalsRef.current = equals;
        committedStateRef.current = instance.state;
    });

    const container = useSyncExternalStore(
        instance.state.store.subscribe,
        instance.getSelection,
        instance.getSelection
    );
    return container.selected;
}
