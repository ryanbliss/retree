/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ReactiveNode } from "../ReactiveNode.js";
import { INodeFieldChanges, TRetreeChangedEvents, TreeNode } from "../types.js";
import {
    areDependencyComparisonValuesEqual,
    areDependencyValuesEqual,
    getDependencyComparisonValues,
    normalizeDependencyEntry,
} from "./dependencies.js";
import {
    collectTrackedSelectionAccesses,
    ITrackedNodeAccessSummary,
    ITrackedSelectionAccesses,
    runWithTrackedWriteWarningSuppressed,
} from "./dependency-tracking.js";
import { isDevMode } from "./dev.js";
import {
    getBaseProxy,
    getUnproxiedNode,
    isInternalSlotInstance,
} from "./proxy.js";
import { getReproxyNode } from "./reproxy.js";

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

export interface TrackedSelection<TSelected> {
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

export function getTrackedDependencyComparisonValues(
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

export function areTrackedComparisonValuesEqual(
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

export function defaultTrackedSelectedChanged<TSelected>(
    previous: TSelected,
    next: TSelected
): boolean {
    return !Object.is(previous, next);
}

export function stabilizeSelectedRetreeReferences<TSelected>(
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
    // Dev-only: run the first selector pass under read tracking so descendant
    // reads a nodeChanged listener can never observe are detectable. The
    // tracked run is observation-only; the selector's value and all
    // subscription behavior are identical to the untracked path.
    let initialAccessSummaries:
        | Map<TreeNode, ITrackedNodeAccessSummary>
        | undefined;
    let previous: TSelected;
    if (isDevMode() && options.listenerType === "nodeChanged") {
        const trackedInitialRun = collectTrackedSelectionAccesses(() =>
            options.selector(getReproxyNode(baseProxy))
        );
        previous = trackedInitialRun.value;
        initialAccessSummaries = trackedInitialRun.getAccessSummaries();
    } else {
        previous = options.selector(getReproxyNode(baseProxy));
    }

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
    if (initialAccessSummaries !== undefined) {
        warnOnUnsubscribedDescendantReads(
            initialAccessSummaries,
            baseRawNode,
            activeDependencyMap
        );
    }
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

/**
 * Dev-only warning for the `Retree.select(node, selector, ...)` form with the
 * default `nodeChanged` listener: reads of descendant nodes that are neither
 * the observed node nor part of the returned dependency list can never
 * trigger the callback, because `nodeChanged` only observes fields directly
 * owned by subscribed nodes. Observation only — no behavior change.
 */
function warnOnUnsubscribedDescendantReads(
    accessSummaries: Map<TreeNode, ITrackedNodeAccessSummary>,
    baseRawNode: TreeNode | undefined,
    subscribedDependencies: Map<TreeNode, ActiveSelectDependency>
): void {
    const unsubscribedReadNodes: TreeNode[] = [];
    for (const readNode of accessSummaries.keys()) {
        if (readNode === baseRawNode) {
            continue;
        }
        if (subscribedDependencies.has(readNode)) {
            continue;
        }
        unsubscribedReadNodes.push(readNode);
    }
    if (unsubscribedReadNodes.length === 0) {
        return;
    }
    const describedNodes = unsubscribedReadNodes
        .slice(0, 3)
        .map((readNode) => describeNodeKind(readNode))
        .join(", ");
    console.warn(
        `Retree.select/useSelect: a selector using the default 'nodeChanged' listener read properties of descendant node(s) [${describedNodes}] that are not part of the returned dependency list. 'nodeChanged' only observes fields directly owned by the observed node, so changes to those descendants will not re-run this selector. Fix: return the descendant nodes in the selector's dependency array, or pass { listenerType: "treeChanged" }.`
    );
}

function describeNodeKind(node: TreeNode): string {
    if (Array.isArray(node)) {
        return "Array";
    }
    return node.constructor?.name ?? "Object";
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

/**
 * Maximum number of times one synchronous cascade may re-run an effect before
 * the loop guard throws. A cascade is the initial triggered run plus every
 * re-run requested by the effect's own writes before control returns to the
 * caller; independent asynchronous triggers each start a fresh cascade.
 */
export const MAX_SYNCHRONOUS_EFFECT_RERUNS = 100;

/**
 * Auto-tracked reaction behind `Retree.effect`: runs `fn` under the same
 * dependency tracking as the selector-only `Retree.select` form, re-runs it
 * whenever a tracked dependency's `nodeChanged` fails validation, and never
 * compares a selected value — every relevant dependency change re-runs `fn`.
 */
export function createRetreeTrackedEffect(options: {
    fn: () => void;
    effectName: string;
    onError: ((error: unknown) => void) | undefined;
    subscribeToNode: SubscribeToNode;
}): () => void {
    let activeDependencies: ActiveSelectDependency[] = [];
    let activeDependencyMap = new Map<TreeNode, ActiveSelectDependency>();
    let previousAccesses: ITrackedSelectionAccesses<void> | undefined;
    let disposed = false;
    let running = false;
    let rerunRequested = false;

    const handleRunError = (error: unknown) => {
        if (options.onError !== undefined) {
            options.onError(error);
            return;
        }
        // Default: rethrow asynchronously. Swallowing would hide real bugs,
        // but throwing synchronously would propagate into the mutation that
        // triggered the run and tear down the reaction; deferring surfaces
        // the error as an uncaught exception while the effect stays
        // subscribed and recovers on the next dependency change.
        setTimeout(() => {
            throw error;
        }, 0);
    };

    const runTracked = (): ITrackedSelectionAccesses<void> => {
        let caught: { error: unknown } | undefined;
        const accesses = collectTrackedSelectionAccesses(() => {
            runWithTrackedWriteWarningSuppressed(() => {
                try {
                    options.fn();
                } catch (error) {
                    caught = { error };
                }
            });
        });
        // Handle after collection so the reads that happened before the
        // throw still subscribe; the effect re-runs (and can recover) when
        // any of them change.
        if (caught !== undefined) {
            handleRunError(caught.error);
        }
        return accesses;
    };

    const updateDependencySubscriptions = (
        trackedAccesses: ITrackedSelectionAccesses<void>
    ) => {
        const nextDependencies: ActiveSelectDependency[] = [];
        const nextDependencyMap = new Map<TreeNode, ActiveSelectDependency>();
        const nextDependencySlots = new Map<
            TreeNode,
            { baseProxy: TreeNode; indices: number[] }
        >();

        for (
            let index = 0;
            index < trackedAccesses.dependencies.length;
            index++
        ) {
            const dependency = trackedAccesses.dependencies[index];
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
                    (_node, changes) =>
                        handleDependencyChanged(rawNode, changes)
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

    const handleDependencyChanged = (
        changedRawNode: TreeNode,
        changes?: INodeFieldChanges[]
    ) => {
        if (disposed) {
            return;
        }
        // Validation gate: unrelated writes to a tracked node re-read equal
        // and are skipped without re-running the effect, exactly like the
        // tracked Retree.select form.
        if (
            previousAccesses !== undefined &&
            canSkipTrackedDependencyChange(
                changedRawNode,
                previousAccesses.getAccessSummaries().get(changedRawNode),
                changes
            )
        ) {
            return;
        }
        run();
    };

    const run = () => {
        if (running) {
            // The effect's own write re-triggered it mid-run. Defer to a
            // loop after the current run instead of recursing, so the guard
            // can count the cascade and subscriptions update once per run.
            rerunRequested = true;
            return;
        }
        running = true;
        let cascadeRuns = 0;
        try {
            do {
                rerunRequested = false;
                cascadeRuns++;
                if (cascadeRuns > MAX_SYNCHRONOUS_EFFECT_RERUNS) {
                    // @retree-throws
                    throw new Error(
                        `Retree.effect: the effect '${options.effectName}' re-triggered itself synchronously more than ${MAX_SYNCHRONOUS_EFFECT_RERUNS} times. This is expected when the effect unconditionally writes a tracked dependency it also reads, which re-runs it forever. Fix: make the write conditional so it converges, wrap reads that should not re-trigger in Retree.untracked(...), or move the write out of the effect.`
                    );
                }
                const accesses = runTracked();
                if (disposed) {
                    // The effect body called its own stop(): dispose already
                    // unsubscribed and cleared every dependency, so
                    // resubscribing from this run's accesses would leak those
                    // subscriptions with no remaining way to remove them.
                    break;
                }
                previousAccesses = accesses;
                updateDependencySubscriptions(accesses);
                if (
                    !rerunRequested &&
                    didWriteInvalidateTrackedReads(accesses)
                ) {
                    // The run wrote a property it had already read, changing
                    // its value. Subscriptions only install after a run, so
                    // no nodeChanged reached this effect for that write (the
                    // creation run has none installed at all); request the
                    // re-run the steady-state subscription path would have.
                    rerunRequested = true;
                }
            } while (rerunRequested && !disposed);
        } finally {
            running = false;
        }
    };

    run();

    return () => {
        if (disposed) {
            return;
        }
        disposed = true;
        for (const activeDependency of activeDependencies) {
            activeDependency.unsubscribe();
        }
        activeDependencies = [];
        activeDependencyMap = new Map();
    };
}

/**
 * True when a run read a tracked property, later wrote the same property in
 * the same run, and the write changed the value the read captured.
 *
 * @remarks
 * Used by `createRetreeTrackedEffect` after each run: such writes never
 * deliver a `nodeChanged` to the effect (subscriptions install only after the
 * run completes, and the read itself was retired from the dependency list by
 * the write), so without this re-check a creation-run self-write would never
 * cascade. No-op writes re-read equal and do not request a re-run, matching
 * the steady-state emission path, which skips value-unchanged writes.
 */
function didWriteInvalidateTrackedReads(
    accesses: ITrackedSelectionAccesses<void>
): boolean {
    for (const validator of accesses.writeInvalidatedReads) {
        const currentValues = validator.accessor.getValues();
        if (currentValues.length !== validator.capturedValues.length) {
            return true;
        }
        for (let index = 0; index < currentValues.length; index++) {
            if (
                !areDependencyValuesEqual(
                    validator.capturedValues[index],
                    currentValues[index]
                )
            ) {
                return true;
            }
        }
    }
    return false;
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
 * ReactiveNodes are excluded even though records now carry node identity
 * (`change.node` distinguishes own writes from dependency-forwarded records):
 * ReactiveNode property reads routinely resolve getters (`@memo`, `@select`,
 * computed getters) whose values derive from *other* own fields, so an own
 * write to a backing field would be key-scope-skipped while the read getter's
 * value changed. Scoping ReactiveNodes safely needs summaries to separate
 * data-field reads from getter reads first.
 * TODO(spec §6.1 / audit C6): once summaries record whether each validated
 * read was a plain data field, allow key scoping for ReactiveNode records
 * where `change.node === changedRawNode` and every read key is a data field.
 */
export function canSkipTrackedDependencyChange(
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
        !changes.some((change) =>
            isPossiblyRelevantFieldChange(change, changedRawNode, summary)
        )
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

/**
 * True when a change record could describe a field the summary's selector
 * read. Records are only scopable when they describe the changed node's own
 * fields with string keys; foreign (dependency-forwarded) records and
 * symbol/Map-keyed records are conservatively treated as relevant so the
 * validators decide.
 */
function isPossiblyRelevantFieldChange(
    change: INodeFieldChanges,
    changedRawNode: TreeNode,
    summary: ITrackedNodeAccessSummary
): boolean {
    if (typeof change.key !== "string") {
        return true;
    }
    if (change.node !== changedRawNode) {
        return true;
    }
    return summary.propertyKeys.has(change.key);
}
