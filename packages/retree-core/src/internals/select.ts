/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TRetreeChangedEvents, TreeNode } from "../types";
import {
    areDependencyComparisonValuesEqual,
    getDependencyComparisonValues,
    normalizeDependencyEntry,
} from "./dependencies";
import { getBaseProxy, getUnproxiedNode } from "./proxy";
import { getReproxyNode } from "./reproxy";

export type RetreeSelectSelector<TNode extends TreeNode, TSelected> = (
    node: TNode
) => TSelected;

export type RetreeSelectEquals<TSelected> = (
    previous: TSelected,
    next: TSelected
) => boolean;

type SelectionListener<TNode extends TreeNode> = (node: TNode) => void;
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
            if (!Object.is(previous[index], next[index])) {
                return false;
            }
        }
        return true;
    }
    return Object.is(previous, next);
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
    let previous = options.selector(getReproxyNode(baseProxy));

    const updateDependencySubscriptions = (selected: TSelected) => {
        const nextDependencies: ActiveSelectDependency[] = [];
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
            const existing = activeDependencies.find(
                (active) => active.rawNode === rawNode
            );
            if (existing !== undefined) {
                existing.indices = dependencySlot.indices;
                nextDependencies.push(existing);
                continue;
            }

            nextDependencies.push({
                rawNode,
                indices: dependencySlot.indices,
                unsubscribe: options.subscribeToNode(
                    dependencySlot.baseProxy,
                    "nodeChanged",
                    () => evaluate(rawNode)
                ),
            });
        }

        for (const activeDependency of activeDependencies) {
            if (
                !nextDependencies.some(
                    (dependency) =>
                        dependency.rawNode === activeDependency.rawNode
                )
            ) {
                activeDependency.unsubscribe();
            }
        }
        activeDependencies = nextDependencies;
    };

    const evaluate = (changedDependencyRawNode?: TreeNode) => {
        const changedDependencyIndex =
            changedDependencyRawNode === undefined
                ? undefined
                : activeDependencies.find(
                      (dependency) =>
                          dependency.rawNode === changedDependencyRawNode
                  )?.indices;
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
    };
}
