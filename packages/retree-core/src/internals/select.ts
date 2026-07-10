/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ReactiveNode } from "../ReactiveNode";
import { INodeFieldChanges, TRetreeChangedEvents, TreeNode } from "../types";
import {
    areDependencyComparisonValuesEqual,
    areDependencyValuesEqual,
    getDependencyComparisonValues,
    normalizeDependencyEntry,
} from "./dependencies";
import {
    collectTrackedSelectionAccesses,
    ITrackedNodeAccessSummary,
} from "./dependency-tracking";
import {
    getBaseProxy,
    getUnproxiedNode,
    isInternalSlotInstance,
} from "./proxy";
import { getReproxyNode } from "./reproxy";

export type RetreeSelectSelector<TNode extends TreeNode, TSelected> = (
    node: TNode
) => TSelected;

export type RetreeTrackedSelectSelector<TSelected> = () => TSelected;

export type RetreeSelectEquals<TSelected> = (
    previous: TSelected,
    next: TSelected
) => boolean;

type SelectionListener<TNode extends TreeNode> = (
    node: TNode,
    changes?: INodeFieldChanges[]
) => void;
type SubscribeToNode = <TNode extends TreeNode>(
    node: TNode,
    listenerType: TRetreeChangedEvents,
    listener: SelectionListener<TNode>
) => () => void;

interface ActiveSelectDependency {
    rawNode: TreeNode;
    indices: number[];
    unsubscribe: () => void;
}

interface TrackedSelection<TSelected> {
    selected: TSelected;
    dependencies: readonly unknown[];
    getAccessSummaries: () => Map<TreeNode, ITrackedNodeAccessSummary>;
}

function getTrackedDependencyComparisonValue(dependency: unknown): unknown {
    const normalizedDependency = normalizeDependencyEntry(dependency);
    if (
        normalizedDependency.node !== undefined &&
        normalizedDependency.node !== null
    ) {
        return getUnproxiedNode(getBaseProxy(normalizedDependency.node));
    }
    return dependency;
}

function getTrackedDependencyComparisonValues(
    dependencies: readonly unknown[]
) {
    const comparisonValues: unknown[] = [];
    for (const dependency of dependencies) {
        const comparisonValue = getTrackedDependencyComparisonValue(dependency);
        const previousValue = comparisonValues[comparisonValues.length - 1];
        if (Object.is(previousValue, comparisonValue)) {
            continue;
        }
        comparisonValues.push(comparisonValue);
    }
    return comparisonValues;
}

function areTrackedComparisonValuesEqual(
    previous: readonly unknown[],
    next: readonly unknown[]
): boolean {
    if (previous.length !== next.length) {
        return false;
    }
    for (let index = 0; index < previous.length; index++) {
        if (!Object.is(previous[index], next[index])) {
            return false;
        }
    }
    return true;
}

function defaultTrackedSelectedChanged<TSelected>(
    previous: TSelected,
    next: TSelected
): boolean {
    return !Object.is(previous, next);
}

function stabilizeSelectedRetreeReferences<TSelected>(
    previous: TSelected,
    next: TSelected
): TSelected {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
        if (areDependencyValuesEqual(previous, next)) {
            return previous;
        }
        return next;
    }
    if (previous.length !== next.length) {
        return next;
    }
    let didStabilizeSlot = false;
    const stabilized = next.map((nextValue, index) => {
        const previousValue = previous[index];
        if (!areDependencyValuesEqual(previousValue, nextValue)) {
            return nextValue;
        }
        if (previousValue !== nextValue) {
            didStabilizeSlot = true;
        }
        return previousValue;
    });
    return (didStabilizeSlot ? stabilized : next) as TSelected;
}

export function normalizeSelectDependencies<TSelected>(
    selected: TSelected
): readonly unknown[] {
    return Array.isArray(selected) ? selected : [selected];
}

export function defaultSelectEquals<TSelected>(
    previous: TSelected,
    next: TSelected
): boolean {
    if (Array.isArray(previous) && Array.isArray(next)) {
        if (previous.length !== next.length) {
            return false;
        }
        for (let index = 0; index < previous.length; index++) {
            if (!areDependencyValuesEqual(previous[index], next[index])) {
                return false;
            }
        }
        return true;
    }
    return areDependencyValuesEqual(previous, next);
}

export function defaultSelectShouldNotify<TSelected>(
    previous: TSelected,
    next: TSelected,
    changedDependencyIndex?: number
): boolean {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
        return !defaultSelectEquals(previous, next);
    }
    if (previous.length !== next.length) {
        return true;
    }
    if (changedDependencyIndex !== undefined) {
        const currentSlot = normalizeDependencyEntry(
            next[changedDependencyIndex]
        );
        if (currentSlot.explicit) {
            const previousSlot = normalizeDependencyEntry(
                previous[changedDependencyIndex]
            );
            return !areDependencyComparisonValuesEqual(
                previousSlot.comparisonValues,
                currentSlot.comparisonValues
            );
        }
        if (changedDependencyIndex >= next.length - 1) {
            return true;
        }
        return !areDependencyComparisonValuesEqual(
            getDependencyComparisonValues(
                previous.slice(changedDependencyIndex + 1)
            ),
            getDependencyComparisonValues(
                next.slice(changedDependencyIndex + 1)
            )
        );
    }
    return !areDependencyComparisonValuesEqual(
        getDependencyComparisonValues(previous),
        getDependencyComparisonValues(next)
    );
}

export function createRetreeSelectionObserver<
    TNode extends TreeNode,
    TSelected
>(options: {
    node: TNode;
    selector: RetreeSelectSelector<TNode, TSelected>;
    equals?: RetreeSelectEquals<TSelected>;
    listenerType: TRetreeChangedEvents;
    subscribeToNode: SubscribeToNode;
    onChange: (next: TSelected, previous: TSelected) => void;
}): () => void {
    const baseProxy = getBaseProxy(options.node);
    const baseRawNode = getUnproxiedNode(baseProxy);
    let activeDependencies: ActiveSelectDependency[] = [];
    let activeDependencyMap = new Map<TreeNode, ActiveSelectDependency>();
    let previous = options.selector(getReproxyNode(baseProxy));

    const updateDependencySubscriptions = (selected: TSelected) => {
        const nextDependencies: ActiveSelectDependency[] = [];
        const nextDependencyMap = new Map<TreeNode, ActiveSelectDependency>();
        const nextDependencySlots = new Map<
            TreeNode,
            { baseProxy: TreeNode; indices: number[] }
        >();
        const dependencies = normalizeSelectDependencies(selected);

        for (let index = 0; index < dependencies.length; index++) {
            const dependency = dependencies[index];
            const normalizedDependency = normalizeDependencyEntry(dependency);
            if (normalizedDependency.node === undefined) {
                continue;
            }
            const dependencyBaseProxy = getBaseProxy(normalizedDependency.node);
            const rawNode = getUnproxiedNode(dependencyBaseProxy);
            if (rawNode === undefined || rawNode === baseRawNode) {
                continue;
            }
            const existingSlot = nextDependencySlots.get(rawNode);
            if (existingSlot !== undefined) {
                existingSlot.indices.push(index);
                continue;
            }
            nextDependencySlots.set(rawNode, {
                baseProxy: dependencyBaseProxy,
                indices: [index],
            });
        }

        for (const [rawNode, dependencySlot] of nextDependencySlots.entries()) {
            const existing = activeDependencyMap.get(rawNode);
            if (existing !== undefined) {
                existing.indices = dependencySlot.indices;
                nextDependencies.push(existing);
                nextDependencyMap.set(rawNode, existing);
                continue;
            }

            const nextDependency = {
                rawNode,
                indices: dependencySlot.indices,
                unsubscribe: options.subscribeToNode(
                    dependencySlot.baseProxy,
                    "nodeChanged",
                    () => evaluate(rawNode)
                ),
            };
            nextDependencies.push(nextDependency);
            nextDependencyMap.set(rawNode, nextDependency);
        }

        for (const activeDependency of activeDependencies) {
            if (!nextDependencySlots.has(activeDependency.rawNode)) {
                activeDependency.unsubscribe();
            }
        }
        activeDependencies = nextDependencies;
        activeDependencyMap = nextDependencyMap;
    };

    const evaluate = (changedDependencyRawNode?: TreeNode) => {
        const changedDependencyIndex =
            changedDependencyRawNode === undefined
                ? undefined
                : activeDependencyMap.get(changedDependencyRawNode)?.indices;
        const next = options.selector(getReproxyNode(baseProxy));
        updateDependencySubscriptions(next);
        const shouldNotify =
            options.equals !== undefined
                ? !options.equals(previous, next)
                : Array.isArray(changedDependencyIndex)
                ? changedDependencyIndex.some((index) =>
                      defaultSelectShouldNotify(previous, next, index)
                  )
                : defaultSelectShouldNotify(previous, next);
        if (!shouldNotify) {
            previous = next;
            return;
        }
        const previousToEmit = previous;
        previous = next;
        options.onChange(next, previousToEmit);
    };

    updateDependencySubscriptions(previous);
    const unsubscribeRoot = options.subscribeToNode(
        baseProxy,
        options.listenerType,
        evaluate
    );

    return () => {
        unsubscribeRoot();
        for (const activeDependency of activeDependencies) {
            activeDependency.unsubscribe();
        }
        activeDependencies = [];
        activeDependencyMap = new Map();
    };
}

export function createRetreeTrackedSelectionObserver<TSelected>(options: {
    selector: RetreeTrackedSelectSelector<TSelected>;
    equals?: RetreeSelectEquals<TSelected>;
    subscribeToNode: SubscribeToNode;
    onChange: (next: TSelected, previous: TSelected) => void;
}): () => void {
    let activeDependencies: ActiveSelectDependency[] = [];
    let activeDependencyMap = new Map<TreeNode, ActiveSelectDependency>();
    let previous = runTrackedSelection(options.selector);

    const updateDependencySubscriptions = (
        trackedSelection: TrackedSelection<TSelected>
    ) => {
        const nextDependencies: ActiveSelectDependency[] = [];
        const nextDependencyMap = new Map<TreeNode, ActiveSelectDependency>();
        const nextDependencySlots = new Map<
            TreeNode,
            { baseProxy: TreeNode; indices: number[] }
        >();

        for (
            let index = 0;
            index < trackedSelection.dependencies.length;
            index++
        ) {
            const dependency = trackedSelection.dependencies[index];
            const normalizedDependency = normalizeDependencyEntry(dependency);
            if (normalizedDependency.node === undefined) {
                continue;
            }
            const dependencyBaseProxy = getBaseProxy(normalizedDependency.node);
            const rawNode = getUnproxiedNode(dependencyBaseProxy);
            if (rawNode === undefined) {
                continue;
            }
            const existingSlot = nextDependencySlots.get(rawNode);
            if (existingSlot !== undefined) {
                existingSlot.indices.push(index);
                continue;
            }
            nextDependencySlots.set(rawNode, {
                baseProxy: dependencyBaseProxy,
                indices: [index],
            });
        }

        for (const [rawNode, dependencySlot] of nextDependencySlots.entries()) {
            const existing = activeDependencyMap.get(rawNode);
            if (existing !== undefined) {
                existing.indices = dependencySlot.indices;
                nextDependencies.push(existing);
                nextDependencyMap.set(rawNode, existing);
                continue;
            }

            const nextDependency = {
                rawNode,
                indices: dependencySlot.indices,
                unsubscribe: options.subscribeToNode(
                    dependencySlot.baseProxy,
                    "nodeChanged",
                    (_node, changes) => evaluateForDependency(rawNode, changes)
                ),
            };
            nextDependencies.push(nextDependency);
            nextDependencyMap.set(rawNode, nextDependency);
        }

        for (const activeDependency of activeDependencies) {
            if (!nextDependencySlots.has(activeDependency.rawNode)) {
                activeDependency.unsubscribe();
            }
        }
        activeDependencies = nextDependencies;
        activeDependencyMap = nextDependencyMap;
    };

    let previousComparisonValues = getTrackedDependencyComparisonValues(
        previous.dependencies
    );

    const evaluateForDependency = (
        changedRawNode: TreeNode,
        changes?: INodeFieldChanges[]
    ) => {
        if (
            canSkipTrackedDependencyChange(
                changedRawNode,
                previous.getAccessSummaries().get(changedRawNode),
                changes
            )
        ) {
            return;
        }
        evaluate();
    };

    const evaluate = () => {
        const next = runTrackedSelection(options.selector);
        const nextSelected = stabilizeSelectedRetreeReferences(
            previous.selected,
            next.selected
        );
        updateDependencySubscriptions(next);
        const selectedChanged =
            options.equals !== undefined
                ? !options.equals(previous.selected, nextSelected)
                : defaultTrackedSelectedChanged(
                      previous.selected,
                      nextSelected
                  );
        const nextComparisonValues = getTrackedDependencyComparisonValues(
            next.dependencies
        );
        const dependenciesChanged = !areTrackedComparisonValuesEqual(
            previousComparisonValues,
            nextComparisonValues
        );
        previousComparisonValues = nextComparisonValues;
        const previousToEmit = previous;
        previous = {
            selected: nextSelected,
            dependencies: next.dependencies,
            getAccessSummaries: next.getAccessSummaries,
        };
        if (!selectedChanged && !dependenciesChanged) {
            return;
        }
        options.onChange(nextSelected, previousToEmit.selected);
    };

    updateDependencySubscriptions(previous);

    return () => {
        for (const activeDependency of activeDependencies) {
            activeDependency.unsubscribe();
        }
        activeDependencies = [];
        activeDependencyMap = new Map();
    };
}

export function runTrackedSelection<TSelected>(
    selector: RetreeTrackedSelectSelector<TSelected>
): TrackedSelection<TSelected> {
    const accesses = collectTrackedSelectionAccesses(selector);
    return {
        selected: accesses.value,
        dependencies: accesses.dependencies,
        getAccessSummaries: accesses.getAccessSummaries,
    };
}

/**
 * Decide whether a dependency's `nodeChanged` can be skipped without
 * re-running the tracked selector.
 *
 * A change is skippable when every value the selector read from the changed
 * node re-reads equal. For plain-object nodes the emitted field changes can
 * short-circuit that check entirely when none of the changed keys were read.
 * Arrays are excluded from key scoping because an index write (e.g. `push`)
 * implicitly changes `length` without emitting a `length` change record.
 * ReactiveNodes are excluded because dependency-driven emissions forward the
 * dependency's change records, whose keys do not describe the node's own
 * fields.
 */
function canSkipTrackedDependencyChange(
    changedRawNode: TreeNode,
    summary: ITrackedNodeAccessSummary | undefined,
    changes: INodeFieldChanges[] | undefined
): boolean {
    if (summary === undefined) {
        return false;
    }
    if (summary.wholeNodeRead) {
        return false;
    }
    const keyScopingAllowed =
        summary.keyScopable &&
        !Array.isArray(changedRawNode) &&
        !(changedRawNode instanceof ReactiveNode) &&
        !isInternalSlotInstance(changedRawNode);
    if (
        keyScopingAllowed &&
        changes !== undefined &&
        changes.length > 0 &&
        !changes.some((change) => summary.propertyKeys.has(change.key))
    ) {
        return true;
    }
    for (const validator of summary.validators) {
        const currentValues = validator.accessor.getValues();
        if (currentValues.length !== validator.capturedValues.length) {
            return false;
        }
        for (let index = 0; index < currentValues.length; index++) {
            if (
                !areDependencyValuesEqual(
                    validator.capturedValues[index],
                    currentValues[index]
                )
            ) {
                return false;
            }
        }
    }
    return true;
}
