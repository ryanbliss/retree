/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import type { IReactiveDependency } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import { getCustomProxyHandler, getUnproxiedNode } from "./proxy.js";
import { TCustomProxy } from "./proxy-types.js";

export interface NormalizedDependencySlot {
    node: TCustomProxy<TreeNode> | undefined;
    comparisons: unknown[] | undefined;
    comparisonValues: unknown[];
    explicit: boolean;
}

export function isRetreeManagedDependency(
    value: unknown
): value is TCustomProxy<TreeNode> {
    return (
        value !== null &&
        typeof value === "object" &&
        getCustomProxyHandler(value) !== undefined
    );
}

export function normalizeDependencyEntry(
    dependency: unknown
): NormalizedDependencySlot {
    if (isExplicitReactiveDependency(dependency)) {
        if (isRetreeManagedDependency(dependency.node)) {
            const comparisons = dependency.comparisons;
            return {
                node: dependency.node,
                comparisons,
                comparisonValues: [dependency.node, ...(comparisons ?? [])],
                explicit: true,
            };
        }
        const comparisons =
            dependency.comparisons === undefined
                ? [dependency.node]
                : dependency.comparisons;
        return {
            node: undefined,
            comparisons,
            comparisonValues: [...comparisons],
            explicit: true,
        };
    }
    if (isRetreeManagedDependency(dependency)) {
        return {
            node: dependency,
            comparisons: undefined,
            comparisonValues: [dependency],
            explicit: false,
        };
    }
    return {
        node: undefined,
        comparisons: [dependency],
        comparisonValues: [dependency],
        explicit: false,
    };
}

export function getDependencyComparisonValues(
    dependencies: readonly unknown[]
) {
    const comparisonValues: unknown[] = [];
    for (const dependency of dependencies) {
        comparisonValues.push(
            ...normalizeDependencyEntry(dependency).comparisonValues
        );
    }
    return comparisonValues;
}

export function areDependencyComparisonValuesEqual(
    previous: readonly unknown[],
    next: readonly unknown[]
) {
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

export function areDependencyValuesEqual(previous: unknown, next: unknown) {
    if (
        isRetreeManagedDependency(previous) &&
        isRetreeManagedDependency(next)
    ) {
        return getUnproxiedNode(previous) === getUnproxiedNode(next);
    }
    return Object.is(previous, next);
}

function isExplicitReactiveDependency(
    dependency: unknown
): dependency is IReactiveDependency {
    if (
        dependency === null ||
        typeof dependency !== "object" ||
        isRetreeManagedDependency(dependency)
    ) {
        return false;
    }
    if (!("node" in dependency)) {
        return false;
    }
    if (!hasComparisonsProperty(dependency)) {
        return true;
    }
    const comparisons = dependency.comparisons;
    return comparisons === undefined || Array.isArray(comparisons);
}

function hasComparisonsProperty(
    dependency: object
): dependency is { comparisons: unknown } {
    return "comparisons" in dependency;
}
