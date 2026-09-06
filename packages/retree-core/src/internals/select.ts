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
    areTrackedReadsEqual,
    collectTrackedSelectionAccesses,
    DependencySubscriptionKind,
    ITrackedDependencySource,
    ITrackedSelectionAccesses,
    NodeReadRecord,
    runWithTrackedWriteWarningSuppressed,
} from "./dependency-tracking.js";
import { isDevMode } from "./dev.js";
import {
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
    isInternalSlotInstance,
} from "./proxy.js";
import { unproxiedBaseNodeKey } from "./proxy-types.js";
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

/**
 * Listener for a subtree subscription: `changedRawNode` is the raw node that
 * emitted `nodeChanged` somewhere in the subscribed node's subtree (the node
 * itself included), with that emission's change records.
 */
export type TSubtreeChangedListener = (
    changedRawNode: TreeNode,
    changes: INodeFieldChanges[]
) => void;

type SubscribeToSubtree = (
    node: TreeNode,
    listener: TSubtreeChangedListener
) => () => void;

/**
 * Key of the internal `Retree` static that subscribes a subtree listener.
 * Unlike `treeChanged`, a subtree subscription never refreshes ancestor
 * identities; it only routes descendant emissions to one listener.
 */
export const SUBSCRIBE_SUBTREE_CHANGED_SYMBOL =
    "RETREE_SUBSCRIBE_SUBTREE_CHANGED_SYMBOL";

export interface TrackedSelection<TSelected> {
    selected: TSelected;
    sources: readonly ITrackedDependencySource[];
    reads: ReadonlyMap<TreeNode, NodeReadRecord>;
}

interface DependencySubscription {
    kind: DependencySubscriptionKind;
    unsubscribe: () => void;
}

/**
 * The subscriptions a selector or effect holds on the covers of its last
 * run. `update` diffs against the previous run so unchanged covers keep
 * their subscription and only added, removed or re-kinded covers churn.
 */
function createDependencySubscriptionSet(
    subscribeToNode: SubscribeToNode,
    subscribeToSubtree: SubscribeToSubtree | undefined,
    onDependencyChanged: (
        rawNode: TreeNode,
        changes?: INodeFieldChanges[]
    ) => void
) {
    let active = new Map<TreeNode, DependencySubscription>();
    const subscribe = (
        source: ITrackedDependencySource
    ): DependencySubscription => {
        const rawNode = source.rawNode;
        if (source.kind === DependencySubscriptionKind.Node) {
            return {
                kind: source.kind,
                unsubscribe: subscribeToNode(
                    source.baseProxy,
                    "nodeChanged",
                    (_node, changes) => onDependencyChanged(rawNode, changes)
                ),
            };
        }
        if (subscribeToSubtree === undefined) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed: a tracked run produced a subtree dependency source but its observer has no subtree subscriber. This is unexpected and likely a Retree bug. Please file an issue with the selector that triggered this."
            );
        }
        return {
            kind: source.kind,
            unsubscribe: subscribeToSubtree(
                source.baseProxy,
                onDependencyChanged
            ),
        };
    };
    return {
        update(sources: readonly ITrackedDependencySource[]) {
            const next = new Map<TreeNode, DependencySubscription>();
            for (const source of sources) {
                const existing = active.get(source.rawNode);
                if (existing !== undefined && existing.kind === source.kind) {
                    next.set(source.rawNode, existing);
                    continue;
                }
                next.set(source.rawNode, subscribe(source));
            }
            for (const [rawNode, subscription] of active) {
                if (next.get(rawNode) !== subscription) {
                    subscription.unsubscribe();
                }
            }
            active = next;
        },
        dispose() {
            for (const subscription of active.values()) {
                subscription.unsubscribe();
            }
            active = new Map();
        },
    };
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
    let dependencyIndicesByRawNode = new Map<TreeNode, number[]>();
    const subscriptions = createDependencySubscriptionSet(
        options.subscribeToNode,
        undefined,
        (rawNode) => evaluate(rawNode)
    );
    // Dev-only: run the first selector pass under read tracking so descendant
    // reads a nodeChanged listener can never observe are detectable. The
    // tracked run is observation-only; the selector's value and all
    // subscription behavior are identical to the untracked path.
    let initialReads: ReadonlyMap<TreeNode, NodeReadRecord> | undefined;
    let previous: TSelected;
    if (isDevMode() && options.listenerType === "nodeChanged") {
        const trackedInitialRun = collectTrackedSelectionAccesses(() =>
            options.selector(getReproxyNode(baseProxy))
        );
        previous = trackedInitialRun.value;
        initialReads = trackedInitialRun.reads;
    } else {
        previous = options.selector(getReproxyNode(baseProxy));
    }

    const updateDependencySubscriptions = (selected: TSelected) => {
        const dependencies = normalizeSelectDependencies(selected);
        const sources: ITrackedDependencySource[] = [];
        const indicesByRawNode = new Map<TreeNode, number[]>();
        for (let index = 0; index < dependencies.length; index++) {
            const normalizedDependency = normalizeDependencyEntry(
                dependencies[index]
            );
            if (normalizedDependency.node === undefined) {
                continue;
            }
            const handler = getCustomProxyHandler(normalizedDependency.node);
            if (handler === undefined) {
                continue;
            }
            const rawNode = handler[unproxiedBaseNodeKey];
            if (rawNode === baseRawNode) {
                continue;
            }
            const indices = indicesByRawNode.get(rawNode);
            if (indices !== undefined) {
                indices.push(index);
                continue;
            }
            indicesByRawNode.set(rawNode, [index]);
            sources.push({
                rawNode,
                baseProxy: handler.baseProxy,
                kind: DependencySubscriptionKind.Node,
            });
        }
        dependencyIndicesByRawNode = indicesByRawNode;
        subscriptions.update(sources);
    };

    const evaluate = (changedDependencyRawNode?: TreeNode) => {
        const changedDependencyIndex =
            changedDependencyRawNode === undefined
                ? undefined
                : dependencyIndicesByRawNode.get(changedDependencyRawNode);
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
    if (initialReads !== undefined) {
        warnOnUnsubscribedDescendantReads(
            initialReads,
            baseRawNode,
            dependencyIndicesByRawNode
        );
    }
    const unsubscribeRoot = options.subscribeToNode(
        baseProxy,
        options.listenerType,
        evaluate
    );

    return () => {
        unsubscribeRoot();
        subscriptions.dispose();
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
    reads: ReadonlyMap<TreeNode, NodeReadRecord>,
    baseRawNode: TreeNode | undefined,
    subscribedDependencies: ReadonlyMap<TreeNode, unknown>
): void {
    const unsubscribedReadNodes: TreeNode[] = [];
    for (const readNode of reads.keys()) {
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
    subscribeToSubtree: SubscribeToSubtree;
    onChange: (next: TSelected, previous: TSelected) => void;
}): () => void {
    let previous = runTrackedSelection(options.selector);
    const subscriptions = createDependencySubscriptionSet(
        options.subscribeToNode,
        options.subscribeToSubtree,
        (rawNode, changes) => evaluateForDependency(rawNode, changes)
    );

    const evaluateForDependency = (
        changedRawNode: TreeNode,
        changes?: INodeFieldChanges[]
    ) => {
        // Subtree subscriptions deliver every descendant emission; a node
        // the run never read cannot change what it selected.
        const record = previous.reads.get(changedRawNode);
        if (record === undefined) {
            return;
        }
        if (canSkipTrackedDependencyChange(changedRawNode, record, changes)) {
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
        subscriptions.update(next.sources);
        const selectedChanged =
            options.equals !== undefined
                ? !options.equals(previous.selected, nextSelected)
                : defaultTrackedSelectedChanged(
                      previous.selected,
                      nextSelected
                  );
        const dependenciesChanged = !areTrackedReadsEqual(
            previous.reads,
            next.reads
        );
        const previousToEmit = previous;
        previous = {
            selected: nextSelected,
            sources: next.sources,
            reads: next.reads,
        };
        if (!selectedChanged && !dependenciesChanged) {
            return;
        }
        options.onChange(nextSelected, previousToEmit.selected);
    };

    subscriptions.update(previous.sources);

    return () => subscriptions.dispose();
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
    subscribeToSubtree: SubscribeToSubtree;
}): () => void {
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

    const subscriptions = createDependencySubscriptionSet(
        options.subscribeToNode,
        options.subscribeToSubtree,
        (rawNode, changes) => handleDependencyChanged(rawNode, changes)
    );

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
        if (previousAccesses !== undefined) {
            const record = previousAccesses.reads.get(changedRawNode);
            if (record === undefined) {
                return;
            }
            if (
                canSkipTrackedDependencyChange(changedRawNode, record, changes)
            ) {
                return;
            }
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
                subscriptions.update(accesses.sources);
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
        subscriptions.dispose();
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
    for (const read of accesses.writeInvalidatedReads) {
        if (!read.isUnchanged()) {
            return true;
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
        sources: accesses.sources,
        reads: accesses.reads,
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
    record: NodeReadRecord | undefined,
    changes: INodeFieldChanges[] | undefined
): boolean {
    if (record === undefined) {
        return false;
    }
    if (record.wholeNodeRead) {
        return false;
    }
    const keyScopingAllowed =
        record.keyScopable &&
        !Array.isArray(changedRawNode) &&
        !(changedRawNode instanceof ReactiveNode) &&
        !isInternalSlotInstance(changedRawNode);
    if (
        keyScopingAllowed &&
        changes !== undefined &&
        changes.length > 0 &&
        !changes.some((change) =>
            isPossiblyRelevantFieldChange(change, changedRawNode, record)
        )
    ) {
        return true;
    }
    return record.isUnchanged();
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
    record: NodeReadRecord
): boolean {
    if (typeof change.key !== "string") {
        return true;
    }
    if (change.node !== changedRawNode) {
        return true;
    }
    return record.hasPropertyKey(change.key);
}
