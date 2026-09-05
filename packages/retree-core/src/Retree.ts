/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    materializeAsync,
    RetreeMaterializeOptions,
} from "./materializeAsync.js";
import {
    buildProxy,
    getBaseProxy,
    getCustomProxyHandler,
    getUnproxiedNode,
    getUnproxiedNodeFromProxy,
} from "./internals/index.js";
import { TreeChangeEmitter } from "./internals/NodeChangeEmitter.js";
import {
    ICustomProxyHandler,
    isCustomProxy,
    proxiedParentKey,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./internals/proxy-types.js";
import {
    getNodeVersionOfHandler,
    getStructureVersion,
    getTreeVersionOfHandler,
} from "./internals/snapshot-version.js";
import {
    deleteReactiveDependencies,
    deleteReactiveDependent,
    getReactiveDependencies,
    getReactiveDependents,
    IActiveReactiveDependency,
    IReactiveDependencyCollectionEntry,
    IReactiveDependentGroup,
    retainReactiveDependencySubscription,
    setReactiveDependencies,
    setReactiveDependents,
} from "./internals/reactive-node-utils.js";
import {
    getBaseHandlerForUnproxiedNode,
    getManagedProxyForUnproxiedNode,
    getReproxyNode,
    getReproxyNodeForUnproxiedNode,
    invalidateReproxyNodeForUnproxiedNode,
    updateReproxyNodeForChange,
} from "./internals/reproxy.js";
import {
    canSkipTrackedDependencyChange,
    createRetreeSelectionObserver,
    createRetreeTrackedEffect,
    createRetreeTrackedSelectionObserver,
    defaultSelectEquals,
    normalizeSelectDependencies,
    RetreeSelectEquals,
    RetreeSelectSelector,
    RetreeTrackedSelectSelector,
    SUBSCRIBE_SUBTREE_CHANGED_SYMBOL,
    TSubtreeChangedListener,
} from "./internals/select.js";
import {
    applyNodeFieldChangesForward,
    applyNodeFieldChangesInverse,
} from "./internals/apply-node-changes.js";
import {
    notifyRetreeDebugTaps,
    registerRetreeRootName,
    retreeDebugTapCount,
} from "./internals/debug-tap.js";
import {
    noteUntrackedRead,
    runWithIsolatedDependencyTracking,
    runWithoutDependencyTracking,
} from "./internals/dependency-tracking.js";
import {
    areDependencyValuesEqual,
    normalizeDependencyEntry,
    NormalizedDependencySlot,
} from "./internals/dependencies.js";
import {
    setTransactionLifecycleDrain,
    Transactions,
} from "./internals/transactions.js";
import {
    bumpGlobalWriteVersion,
    getGlobalWriteVersion,
} from "./internals/write-version.js";
import {
    LINKED_KEYS_SYMBOL,
    IReactiveSelectGetter,
    ReactiveNode,
    RUN_CHANGED_EFFECT_SYMBOL,
    RUN_OBSERVED_EFFECT_SYMBOL,
    RUN_UNOBSERVED_EFFECT_SYMBOL,
    SELECT_GETTERS_SYMBOL,
    setReactiveNodeLinkImplementation,
    setReactiveNodeMoveImplementation,
    setReactiveNodeRawImplementation,
    setReactiveNodePeekIntoImplementation,
    setReactiveNodeUntrackedImplementation,
} from "./ReactiveNode.js";
import {
    RetreeObjectMoveKey,
    TRetreeEvents,
    TNodeChangedListener,
    TRetreeListeners,
    TreeNode,
    TRetreeChangedEvents,
    INodeFieldChanges,
} from "./types.js";

export interface RetreeSelectOptions<TSelected = unknown> {
    equals?: RetreeSelectEquals<TSelected>;
    listenerType?: TRetreeChangedEvents;
}

/**
 * Options for {@link Retree.effect}.
 */
export interface RetreeEffectOptions {
    /**
     * Called with any error the effect function throws during a run.
     *
     * @remarks
     * When omitted, errors are rethrown asynchronously (as an uncaught
     * exception on a fresh stack) so one bad run neither kills the reaction
     * nor propagates into the mutation that triggered it. Either way the
     * effect stays subscribed: dependencies read before the throw re-run it,
     * so it can recover on the next relevant change.
     */
    onError?: (error: unknown) => void;
}

type TInternalNodeChangedListener = (
    node: TreeNode,
    proxyNode: TCustomProxy<TreeNode>,
    reproxiedNode: TreeNode,
    changes: INodeFieldChanges[]
) => void;

/**
 * The value one `@select` getter contributes to its collection pass. Trapped
 * getters resolve eagerly — the tracked collection already ran the getter, so
 * its return value is free. Explicit-selector getters resolve lazily so an
 * unchanged-dependency validation never runs the output getter at all; the
 * first consumer (notification comparison or lifecycle capture) computes it
 * once per collection.
 */
interface IReactiveSelectValueCell {
    resolved: boolean;
    value: unknown;
    compute: (() => unknown) | undefined;
}

/**
 * One full dependency-collection pass for a ReactiveNode, stamped with the
 * global write version it observed. `dependencies` records are shared across
 * callers within one version and must be treated as immutable. `selectValues`
 * holds a value cell per `@select` getter whose value gates notification.
 */
interface IReactiveDependencyCollection {
    version: number;
    dependencies: IReactiveDependencyCollectionEntry[];
    selectValues: Map<string | symbol, IReactiveSelectValueCell> | undefined;
}

/**
 * Dependency keys are positional and rebuilt on every collection pass, so
 * they are interned per position instead of re-allocated per dependency.
 */
const dependenciesGetterKeys: string[] = [];
const selectGetterKeys = new Map<string | symbol, string[]>();

function internDependencyKey(
    keys: string[],
    prefix: string,
    index: number
): string {
    while (keys.length <= index) {
        keys.push(`${prefix}:${keys.length}`);
    }
    return keys[index];
}

function getDependenciesGetterKey(index: number): string {
    return internDependencyKey(dependenciesGetterKeys, "dependencies", index);
}

function getSelectDependencyKey(
    getterName: string | symbol,
    index: number
): string {
    let keys = selectGetterKeys.get(getterName);
    if (keys === undefined) {
        keys = [];
        selectGetterKeys.set(getterName, keys);
    }
    return internDependencyKey(keys, `select:${String(getterName)}`, index);
}

function resolveReactiveSelectValueCell(cell: IReactiveSelectValueCell) {
    if (!cell.resolved) {
        if (cell.compute === undefined) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed: an unresolved @select value cell had no compute function. This is unexpected and likely a Retree bug. Please file an issue with the @select getter that triggered this."
            );
        }
        cell.value = cell.compute();
        cell.resolved = true;
        cell.compute = undefined;
    }
    return cell.value;
}

/**
 * Reactive pointer to a Retree-managed node owned somewhere else.
 *
 * @remarks
 * `RetreeLink` is created by {@link Retree.link}. Store it in a Retree tree
 * when one part of state needs to point at another node without becoming that
 * node's structural parent. Replacing {@link RetreeLink.current} emits for the
 * link. Mutating `current` emits from the target's structural location.
 *
 * Most code should call {@link Retree.link} instead of constructing this class
 * directly.
 *
 * @example
 * ```ts
 * const root = Retree.root({
 *     tasks: [{ title: "Docs" }],
 *     selected: null as RetreeLink<{ title: string }> | null,
 * });
 *
 * root.selected = Retree.link(root.tasks[0]);
 * root.selected.current.title = "Better docs";
 * ```
 */
export class RetreeLink<
    TNode extends TreeNode = TreeNode
> extends ReactiveNode {
    /**
     * The linked Retree-managed node.
     *
     * @remarks
     * Replacing `current` emits for the link node. Mutating the target emits
     * where that target is structurally owned.
     */
    public current: TNode;

    constructor(node: TNode) {
        super();
        this[LINKED_KEYS_SYMBOL].add("current");
        this.current = node;
    }

    get dependencies() {
        return [];
    }
}

/**
 * Main entry point for use with Retree package.
 * Exposes utility functions for observing to changes to an object and its children.
 */
export class Retree {
    static {
        setReactiveNodeLinkImplementation((node) => Retree.link(node));
        setReactiveNodeMoveImplementation((node, destination, key) =>
            Retree.moveInternal(node, destination, key)
        );
        setReactiveNodeRawImplementation((node) => Retree.raw(node));
        setReactiveNodeUntrackedImplementation((fn) => Retree.untracked(fn));
        setReactiveNodePeekIntoImplementation((node, fn) =>
            Retree.peekInto(node, fn)
        );
        setTransactionLifecycleDrain(() =>
            Retree.drainPendingReactiveLifecycles()
        );
    }

    private static nodeChangeListener: TInternalNodeChangedListener | null =
        null;
    private static nodeRemovedListener: TInternalNodeChangedListener | null =
        null;
    private static pendingReactiveSelectValueMap = new WeakMap<
        ReactiveNode,
        Map<string | symbol, unknown>
    >();

    /**
     * ReactiveNodes whose lifecycle pass (dependency collection + `@select`
     * value capture) was deferred because a transaction's mutation phase was
     * still running. Keyed by raw node so repeat writes coalesce into one
     * pass; drained by {@link Retree.drainPendingReactiveLifecycles} before
     * each pending-transaction emission, when state is settled.
     */
    private static pendingReactiveLifecycleNodes = new Map<
        TreeNode,
        ReactiveNode
    >();

    /**
     * Per-node dependency collections stamped with the global write version.
     * Within one flush (no interleaved writes) every validation pass and the
     * lifecycle pass share a single collection instead of re-running the
     * `dependencies` getter and every `@select` getter per changed dependency.
     */
    private static reactiveDependencyCollectionCache = new WeakMap<
        TreeNode,
        IReactiveDependencyCollection
    >();

    // Listener registries are WeakMaps keyed by raw nodes so a forgotten
    // unsubscribe cannot pin a node (plus its subtree and listener closures)
    // in memory forever. They are never iterated; the live-listener counters
    // below stand in for the old `Map.size` gates.
    //
    // Counter-leak trade-off: the counters cannot observe GC. A forgotten
    // unsubscribe on a node that has since been garbage-collected leaves its
    // increment in the counters forever, overcounting live listeners and
    // keeping the snapshot-version advancement gate open (every write keeps
    // paying the ancestor version walk). That is strictly better than the
    // old strong-Map registries, where the same forgotten unsubscribe pinned
    // the node, its subtree, and its listener closures in memory instead.
    private static treeChangedListeners: WeakMap<
        TreeNode,
        TNodeChangedListener[]
    > = new WeakMap();
    private static nodeChangedListeners: WeakMap<
        TreeNode,
        TNodeChangedListener[]
    > = new WeakMap();
    private static nodeRemovedListeners: WeakMap<TreeNode, (() => void)[]> =
        new WeakMap();
    /**
     * Internal subtree subscriptions (tracked selectors and effects). A
     * listener here receives every `nodeChanged` emitted by the node or a
     * descendant, keyed by the raw node that emitted, and never refreshes
     * ancestor identities the way `treeChanged` does.
     */
    private static subtreeChangedListeners: WeakMap<
        TreeNode,
        TNodeChangedListener[]
    > = new WeakMap();
    private static treeChangedListenerCount = 0;
    private static nodeChangedListenerCount = 0;
    private static nodeRemovedListenerCount = 0;
    private static subtreeChangedListenerCount = 0;
    private static nodeChangeEmitter = new TreeChangeEmitter();
    private static reactiveDependentNodeChangedListener = (
        reproxy: TreeNode,
        changes: INodeFieldChanges[]
    ) => {
        this.handleReactiveDependentNodeChanged(reproxy, changes);
    };

    /**
     * @deprecated
     * Use {@link root} instead.
     *
     * @example
     * ```ts
     * const state = Retree.use({ count: 0 }); // deprecated
     * const state = Retree.root({ count: 0 }); // preferred
     * ```
     */
    static use<T extends TreeNode = TreeNode>(object: T): T {
        return this.root(object);
    }

    /**
     * Builds a Retree compatible root node for the root object of your tree.
     * @remarks
     * Use this once where plain state enters Retree. The returned proxy is
     * compatible with {@link Retree.on}, {@link Retree.parent},
     * {@link Retree.move}, {@link Retree.link}, and React hooks from
     * `@retreejs/react`.
     *
     * Do mutate the returned tree directly with normal JavaScript assignment
     * and collection methods. Do not call `Retree.root(...)` on every child
     * you assign into the tree; Retree prepares children as they are attached
     * or read.
     *
     * @param object a root TreeNode for your tree
     * @returns a Retree compatible object of type T
     * 
     * @example
     * ```ts
     const counter = Retree.root({ count: 0 });
     Retree.on(counter, "nodeChanged", () => console.log(counter.count));
     counter.count = counter.count + 1;
     ```
     */
    static root<T extends TreeNode = TreeNode>(object: T): T {
        return buildProxy<T>(object, this.nodeChangeEmitter);
    }

    /**
     * Build a result cooperatively from an existing managed tree.
     *
     * Yield from the iterator after each bounded piece of work. Retree resumes
     * the same iterator across host tasks and returns only its final value.
     * The budget is checked between steps; a getter, constructor, or root()
     * call cannot itself be interrupted. Keep each step small.
     *
     * By default, source-tree writes reject with AbortError and silent blocks
     * conservatively invalidate all pending materializations. getRevision
     * replaces these checks with an application revision, allowing cache writes
     * that do not change inputs. Include every source input in that revision.
     * Use an AbortSignal when selection changes. Completed proxy reads and memo
     * caches retain their ordinary identities; cancellation does not undo them.
     * Keep partial output local to the iterator and do not write to the source.
     *
     * Work runs untracked, while nested memos retain their own tracking.
     * peekInto and managed work normally. Use getRevision for linked or external
     * inputs. No ambient dependency collector or transaction spans an await.
     *
     * @example
     * ```ts
     * const rows = await Retree.materializeAsync(source, function* (node) {
     *     const rows: string[] = [];
     *     for (const item of node.items) {
     *         rows.push(item.title);
     *         yield;
     *     }
     *     return rows;
     * }, { signal: controller.signal, budgetMs: 4 });
     * ```
     */
    static materializeAsync<TNode extends TreeNode, TResult>(
        root: TNode,
        build: (root: TNode) => Iterator<void, TResult, void>,
        options: RetreeMaterializeOptions = {}
    ): Promise<TResult> {
        this.assertRetreeManagedNode(root, "Retree.materializeAsync");
        return materializeAsync(getBaseProxy(root) as TNode, build, options);
    }

    /**
     * Create a reactive pointer to an existing Retree-managed node.
     *
     * @remarks
     * The returned link can be stored in a Retree tree without reparenting the
     * linked target. Replacing `link.current` emits for the link; mutating the
     * linked target emits from its structural location.
     *
     * Use this for selected items, cross-references, and pointers into another
     * part of the same tree. Do not use a link when ownership should move; use
     * {@link Retree.move} instead. Do not use a link when the two locations
     * should diverge independently; use {@link Retree.clone} instead.
     *
     * @param node Existing Retree-managed node to point at.
     * @returns A Retree-managed link object whose `current` points at `node`.
     *
     * @example
     * ```ts
     * const root = Retree.root({
     *     tasks: [{ title: "Docs" }],
     *     selected: null as RetreeLink<{ title: string }> | null,
     * });
     *
     * root.selected = Retree.link(root.tasks[0]); // ✅ emits on root
     * root.selected.current.title = "Better docs"; // ✅ emits where task is owned
     * Retree.parent(root.selected.current) === root.tasks; // true
     * ```
     */
    static link<TNode extends TreeNode>(node: TNode): RetreeLink<TNode> {
        this.assertRetreeManagedNode(node, "Retree.link");
        return this.root(new RetreeLink(node));
    }

    /**
     * Clone a Retree-managed node into a detached object that can be assigned
     * somewhere else as a new structural child.
     *
     * @remarks
     * Use this when two places need independent state initialized from the
     * same current data. The clone is detached until you assign it into a
     * Retree tree. Mutating the clone after assignment emits for the clone's
     * new structural location, not the source node.
     *
     * Do not use `clone` when the original object should simply move; use
     * {@link Retree.move}. Do not use `clone` for a selected-item pointer; use
     * {@link Retree.link} or `@link`.
     *
     * @param node Existing Retree-managed node to copy.
     * @returns A detached copy of the node's current raw data.
     *
     * @example
     * ```ts
     * const project = Retree.root({ tasks: [{ title: "Draft" }] });
     * const copy = Retree.clone(project.tasks[0]);
     *
     * project.tasks.push(copy); // ✅ copy becomes a new child
     * project.tasks[1].title = "Published"; // source task is unchanged
     * ```
     */
    static clone<TNode extends TreeNode>(node: TNode): TNode {
        this.assertRetreeManagedNode(node, "Retree.clone");
        return this.cloneValue(
            getUnproxiedNode(node),
            new WeakMap(),
            "node"
        ) as TNode;
    }

    /**
     * Move an existing Retree-managed node from its current parent to a new parent.
     *
     * @remarks
     * Retree is a pure tree: each node has one structural parent. Use `move`
     * when ownership should transfer from the old parent to the destination.
     * Retree finds the current parent with {@link Retree.parent} and removes
     * the node safely before inserting it into the destination.
     *
     * Arrays accept an optional numeric insertion index. Maps and plain
     * objects require a key. Sets ignore the key. Do not manually delete the
     * node from its old parent before calling `move`.
     *
     * @param node Existing Retree-managed node to move.
     * @param destination Retree-managed array, map, set, or object destination.
     * @param key Insertion index for arrays, map key for maps, or property key
     * for objects.
     * @returns The latest reproxy for the moved node.
     *
     * @example
     * ```ts
     * const workspace = Retree.root({
     *     todo: [{ title: "Docs" }],
     *     done: [] as { title: string }[],
     * });
     *
     * const moved = Retree.move(workspace.todo[0], workspace.done);
     * workspace.todo.length; // 0
     * workspace.done[0] === moved; // true
     * ```
     */
    static move<TNode extends TreeNode, TValue extends TreeNode = TNode>(
        node: TNode extends TValue ? TNode : never,
        destination: TValue[],
        key?: number
    ): TNode;
    static move<
        TNode extends TreeNode,
        TKey = unknown,
        TValue extends TreeNode = TNode
    >(
        node: TNode extends TValue ? TNode : never,
        destination: Map<TKey, TValue>,
        key: TKey
    ): TNode;
    static move<TNode extends TreeNode, TValue extends TreeNode = TNode>(
        node: TNode extends TValue ? TNode : never,
        destination: Set<TValue>
    ): TNode;
    static move<
        TNode extends TreeNode,
        TDestination extends TreeNode = TreeNode
    >(
        node: TNode,
        destination: TDestination,
        key: RetreeObjectMoveKey<TDestination, TNode>
    ): TNode;
    static move<TNode extends TreeNode>(
        node: TNode,
        destination: TreeNode,
        key?: unknown
    ): TNode {
        return this.moveInternal(node, destination, key);
    }

    private static moveInternal<TNode extends TreeNode>(
        node: TNode,
        destination: TreeNode,
        key?: unknown
    ): TNode {
        this.assertRetreeManagedNode(node, "Retree.move");
        this.assertRetreeManagedNode(destination, "Retree.move");

        const parent = this.getParentInternal(node);
        if (!parent) {
            // @retree-throws
            throw new Error(
                "Retree.move: cannot move a root node because it does not have a parent. This is expected when the node was created directly with Retree.root(...). Fix: move one of the root's children, assign the root into another tree as a cloned value with Retree.clone(...), or create the root under the desired parent first."
            );
        }

        const nodeToMove = getBaseProxy(node);
        Retree.runTransaction(() => {
            this.removeNodeFromParent(nodeToMove, parent.proxyNode);
            this.insertNodeIntoDestination(nodeToMove, destination, key);
        });
        return getReproxyNode(nodeToMove) as TNode;
    }

    /**
     * Listen for changes to a node.
     * @remarks
     * Use `nodeChanged` for changes directly owned by the node.
     * Use `treeChanged` for changes to the node or descendants.
     * Use `nodeRemoved` for when this node is removed from its parent.
     *
     * @param node the object to listen for changes to.
     * @param listenerType the type of {@link TRetreeEvents} change events to listen to.
     * @param callback the callback function for your listener.
     * @returns an unsubscribe function to clean up your listeners.
     * 
     * @example
     ```ts
     // Create the root node
     const counter = Retree.root({ count: 0 });
     // Listen for changes to values of the node
     const unsubscribe = Retree.on(counter, "nodeChanged", (reproxy) => {
        console.log(reproxy !== counter); // output: false
        console.log(reproxy.count === counter.count); // output: true
     });
     // Make a change
     counter.count = counter.count + 1;
     // Stop listening for changes
     unsubscribe();
     ```
     */
    static on<
        T extends TreeNode = TreeNode,
        TEvent extends TRetreeEvents = TRetreeEvents
    >(
        node: T,
        listenerType: TEvent,
        callback: TEvent extends TRetreeChangedEvents
            ? (reproxiedNode: T, changes: INodeFieldChanges[]) => void
            : () => void
    ): () => void {
        if (!this.nodeChangeListener) {
            this.startListening();
        }

        const unproxiedNode = getUnproxiedNode(node);
        if (!unproxiedNode) {
            // @retree-throws
            throw new Error(
                "Retree.on: expected a Retree-managed node but received an unproxied value. This is expected when listening to a plain object. Fix: pass the object to Retree.root(...) first, or listen to a child value read from an existing Retree tree."
            );
        }
        const relevantListenerMap =
            listenerType === "nodeChanged"
                ? this.nodeChangedListeners
                : listenerType === "treeChanged"
                ? this.treeChangedListeners
                : this.nodeRemovedListeners;
        return this.addListener(
            node,
            unproxiedNode,
            relevantListenerMap,
            callback as TRetreeListeners
        );
    }

    /**
     * @internal
     * Subscribe to every `nodeChanged` emitted by `node` or any node beneath
     * it. Tracked selectors subscribe their read covers this way so a scan
     * over thousands of rows holds one subscription instead of one per row.
     * Unlike `treeChanged`, no ancestor identity is refreshed: the listener
     * receives the raw node that emitted plus its change records.
     */
    static [SUBSCRIBE_SUBTREE_CHANGED_SYMBOL](
        node: TreeNode,
        listener: TSubtreeChangedListener
    ): () => void {
        if (!this.nodeChangeListener) {
            this.startListening();
        }
        const unproxiedNode = getUnproxiedNode(node);
        if (!unproxiedNode) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed: a subtree subscription was requested for an unproxied value. This is unexpected and likely a Retree bug. Please file an issue with the selector that triggered this."
            );
        }
        return this.addListener(
            node,
            unproxiedNode,
            this.subtreeChangedListeners,
            listener
        );
    }

    /**
     * Register `callback` in one registry and run the ReactiveNode observed
     * lifecycle when a change registry gains the node's first listener.
     */
    private static addListener(
        node: TreeNode,
        unproxiedNode: TreeNode,
        relevantListenerMap: WeakMap<TreeNode, TRetreeListeners[]>,
        callback: TRetreeListeners
    ): () => void {
        const isReactiveChangeListener =
            relevantListenerMap !== this.nodeRemovedListeners;
        const wasObserved =
            node instanceof ReactiveNode &&
            isReactiveChangeListener &&
            this.hasReactiveChangedListeners(unproxiedNode);

        let listeners = relevantListenerMap.get(unproxiedNode);
        if (!listeners) {
            listeners = [callback];
            relevantListenerMap.set(unproxiedNode, listeners);
        } else {
            listeners.push(callback);
        }
        this.handleListenerCountChanged(relevantListenerMap, 1);
        if (node instanceof ReactiveNode && isReactiveChangeListener) {
            if (!wasObserved) {
                ReactiveNode[RUN_OBSERVED_EFFECT_SYMBOL](node);
            }
            this.scheduleReactiveNodeLifecycle(node, unproxiedNode);
        }
        return this.buildUnsubscribeCallback(
            unproxiedNode,
            node,
            callback,
            relevantListenerMap
        );
    }

    /**
     * Subscribe to a derived value from any Retree-managed node.
     *
     * @remarks
     * `select` recomputes the selected value when the observed node or selected
     * reactive dependencies emit, then calls `callback` only when the selection
     * changes. Selectors may return one value or an ordered dependency list.
     * Reactive entries in a dependency list are subscribed to; primitive and
     * plain entries are compared by identity.
     *
     * Dependency-list subscriptions are observational: if a selected dependency
     * emits, `select` calls your callback when the selection changes, but it
     * does not force the node passed to `select` to receive a fresh reproxy.
     * Use `@select` when a `ReactiveNode` owner should emit `nodeChanged`.
     * This is a subscription primitive, not a memo cache: use `memo` /
     * `fnMemo` to cache computation, and `select` to narrow notifications.
     *
     * By default `select` listens to `nodeChanged`, which is correct when the
     * selector reads fields directly owned by `node`. Pass
     * `listenerType: "treeChanged"` when the selector intentionally reads
     * descendants that are not included as reactive entries in a dependency
     * list.
     *
     * You can also call `Retree.select(() => value, callback)` without a node.
     * That form traps reads automatically. Whole Retree-managed values are
     * subscribed to broadly. Property reads subscribe to the owner node but
     * compare the specific property value, so `task.done` can react to task
     * replacement or `done` changes without reacting to unrelated task fields.
     * Primitive reads are kept as comparison values, so the callback only runs
     * when the trapped reads make the selected value or dependency set change.
     *
     * @param node Retree-managed node to observe.
     * @param selector Function that reads a selected value or dependency list
     * from the latest reproxy.
     * @param callback Called only when the selected value or dependency list
     * changes.
     * @param options Optional listener type and equality comparison for the
     * whole selected value or tuple.
     * @returns Unsubscribe function.
     *
     * @example
     * ```ts
     * const project = Retree.root({
     *     tasks: [{ done: false }, { done: true }],
     * });
     *
     * const unsubscribe = Retree.select(
     *     project.tasks,
     *     (tasks) => tasks.filter((task) => task.done).length,
     *     (next, previous) => console.log({ next, previous }),
     *     { listenerType: "treeChanged" }
     * );
     *
     * project.tasks[0].done = true; // ✅ callback: 1 -> 2
     * project.tasks[0].done = true; // ❌ selected value did not change
     * unsubscribe();
     * ```
     *
     * @example
     * ```ts
     * Retree.select(
     *     row,
     *     (self) => [self.attributes, self.attributeId, self.attribute],
     *     ([, , attribute]) => console.log(attribute)
     * );
     * ```
     *
     * @example
     * ```ts
     * Retree.select(
     *     () => project.tasks.filter((task) => task.done).length,
     *     (doneCount) => console.log(doneCount)
     * );
     * ```
     */
    static select<TNode extends TreeNode, TSelected>(
        node: TNode,
        selector: RetreeSelectSelector<TNode, TSelected>,
        callback: (next: TSelected, previous: TSelected) => void,
        options?: RetreeSelectOptions<TSelected>
    ): () => void;
    static select<TSelector extends RetreeTrackedSelectSelector<unknown>>(
        selector: TSelector,
        callback: (
            next: ReturnType<TSelector>,
            previous: ReturnType<TSelector>
        ) => void,
        options?: RetreeSelectOptions<ReturnType<TSelector>>
    ): () => void;
    static select<TNode extends TreeNode, TSelected>(
        nodeOrSelector: TNode | RetreeTrackedSelectSelector<TSelected>,
        selectorOrCallback:
            | RetreeSelectSelector<TNode, TSelected>
            | ((next: TSelected, previous: TSelected) => void),
        callbackOrOptions?:
            | ((next: TSelected, previous: TSelected) => void)
            | RetreeSelectOptions<TSelected>,
        options: RetreeSelectOptions<TSelected> = {}
    ): () => void {
        if (typeof nodeOrSelector === "function") {
            return createRetreeTrackedSelectionObserver({
                selector: nodeOrSelector,
                equals: (callbackOrOptions as RetreeSelectOptions<TSelected>)
                    ?.equals,
                subscribeToNode: (
                    selectedNode,
                    selectedListenerType,
                    listener
                ) => this.on(selectedNode, selectedListenerType, listener),
                subscribeToSubtree: (selectedNode, listener) =>
                    this[SUBSCRIBE_SUBTREE_CHANGED_SYMBOL](
                        selectedNode,
                        listener
                    ),
                onChange: selectorOrCallback as (
                    next: TSelected,
                    previous: TSelected
                ) => void,
            });
        }
        const node = nodeOrSelector;
        const selector = selectorOrCallback as RetreeSelectSelector<
            TNode,
            TSelected
        >;
        const callback = callbackOrOptions as (
            next: TSelected,
            previous: TSelected
        ) => void;
        const listenerType = options.listenerType ?? "nodeChanged";
        return createRetreeSelectionObserver({
            node,
            selector,
            equals: options.equals,
            listenerType,
            subscribeToNode: (selectedNode, selectedListenerType, listener) =>
                this.on(selectedNode, selectedListenerType, listener),
            onChange: callback,
        });
    }

    /**
     * Run an auto-tracked reaction: `fn` runs immediately under dependency
     * tracking and re-runs whenever a tracked dependency changes.
     *
     * @remarks
     * `effect` is the third subscription primitive next to {@link Retree.on}
     * (one node, every change) and {@link Retree.select} (derived value,
     * change-compared). It has no selected value and no comparison: every
     * dependency change that survives validation re-runs `fn`. Reads are
     * trapped exactly like the selector-only `Retree.select(() => ...)` form
     * — property reads subscribe to their owner node and validate by value,
     * so unrelated writes to a tracked node skip the re-run. Wrap reads that
     * should not subscribe in {@link Retree.untracked}.
     *
     * `fn` may write Retree state. A run that changes the value of a
     * property it already read re-runs after the current run completes —
     * including the creation run, so a self-converging effect reaches its
     * fixed point before `Retree.effect` returns. A cascade of more than 100
     * synchronous re-runs throws an error naming the effect, because the
     * effect cannot converge. Note that reads of a property the same run
     * also writes are excluded from dependency tracking, exactly as in
     * tracked selectors.
     *
     * Errors thrown by `fn` do not kill the reaction: they are passed to
     * `options.onError` when provided, and rethrown asynchronously (as an
     * uncaught exception) otherwise. See {@link RetreeEffectOptions.onError}.
     *
     * @param fn Reaction body; run once immediately, then on every relevant
     * dependency change.
     * @param options Optional {@link RetreeEffectOptions}.
     * @returns Unsubscribe function that stops all re-runs.
     *
     * @example
     * ```ts
     * const settings = Retree.root({ theme: "dark", fontSize: 14 });
     *
     * const stop = Retree.effect(() => {
     *     document.body.dataset.theme = settings.theme;
     * });
     *
     * settings.theme = "light"; // ✅ effect re-runs
     * settings.fontSize = 16; // ❌ not read by the effect; skipped
     * stop();
     * ```
     */
    static effect(
        fn: () => void,
        options: RetreeEffectOptions = {}
    ): () => void {
        if (typeof fn !== "function") {
            // @retree-throws
            throw new Error(
                "Retree.effect: expected a function as the first argument. This is expected when a value or the result of calling the function is passed instead. Fix: pass the effect function itself, e.g. Retree.effect(() => { ... })."
            );
        }
        return createRetreeTrackedEffect({
            fn,
            effectName: fn.name === "" ? "anonymous" : fn.name,
            onError: options.onError,
            subscribeToNode: (node, listenerType, listener) =>
                this.on(node, listenerType, listener),
            subscribeToSubtree: (node, listener) =>
                this[SUBSCRIBE_SUBTREE_CHANGED_SYMBOL](node, listener),
        });
    }

    /**
     * Apply the inverse of a change batch, restoring the state the records
     * describe mutating away from.
     *
     * @remarks
     * Records are applied in reverse order; for each one, `previous` is
     * restored at `record.key` on the managed node behind `record.node`
     * (see {@link Retree.managed}). Structural records restore structure
     * exactly: array `insert`/`remove` records splice elements back into
     * place, `add`-marked records delete the key they created, `delete`-
     * marked records restore the deleted entry, and `Map.clear`/`Set.clear`
     * restore every discarded entry from their per-entry records (see
     * {@link TNodeFieldChangeOp}).
     *
     * The whole batch applies inside one {@link Retree.runTransaction}, and
     * every write goes through managed nodes, so listeners (and React)
     * observe the restoration as one normal batched change.
     *
     * Known inexact inverses, by design: a direct `array.length = n`
     * assignment that shrank the array restores only the length (the
     * discarded elements emitted no records), and a plain write that
     * implicitly extended an array restores the value but not the shorter
     * length.
     *
     * Throws when a record's node is no longer Retree-managed — records must
     * be applied to the live tree that emitted them.
     *
     * @param changes Change records exactly as emitted to a
     * {@link Retree.on} listener (one batch).
     *
     * @example
     * ```ts
     * const project = Retree.root({ tasks: [{ title: "Docs" }] });
     * let lastChanges: INodeFieldChanges[] = [];
     * Retree.on(project, "treeChanged", (_node, changes) => {
     *     lastChanges = changes;
     * });
     *
     * project.tasks.push({ title: "Tests" });
     * Retree.applyInverse(lastChanges); // ✅ tasks is back to one entry
     * ```
     */
    static applyInverse(changes: INodeFieldChanges[]): void {
        this.runTransaction(() => {
            applyNodeFieldChangesInverse(changes, "Retree.applyInverse");
        });
    }

    /**
     * Replay a change batch forward, re-applying the state the records
     * describe mutating to.
     *
     * @remarks
     * The redo counterpart of {@link Retree.applyInverse}: records apply in
     * emission order and each record's `new` state is applied at
     * `record.key` on the managed node behind `record.node`. Structural
     * records replay structurally (array `insert`/`remove` records splice,
     * `delete`-marked records delete, `clear` summary records clear), so
     * replaying a batch that {@link Retree.applyInverse} undid restores the
     * exact post-mutation state.
     *
     * The whole batch applies inside one {@link Retree.runTransaction}.
     * Throws when a record's node is no longer Retree-managed.
     *
     * @param changes Change records exactly as emitted to a
     * {@link Retree.on} listener (one batch).
     *
     * @example
     * ```ts
     * project.tasks.push({ title: "Tests" });
     * Retree.applyInverse(lastChanges); // undo
     * Retree.applyChanges(lastChanges); // ✅ redo: "Tests" is back
     * ```
     */
    static applyChanges(changes: INodeFieldChanges[]): void {
        this.runTransaction(() => {
            applyNodeFieldChangesForward(changes, "Retree.applyChanges");
        });
    }

    /**
     * Register a display name for a Retree root node.
     *
     * @remarks
     * Named roots exist for tooling: debug taps report the name of the tree
     * a change happened in, and `@retreejs/devtools` uses the registry to
     * enumerate and label live trees. Naming a root changes no runtime
     * behavior and does not keep the tree alive (the registry holds it
     * weakly).
     *
     * Re-registering the same node replaces its name; re-registering the
     * same name points it at the new node.
     *
     * @param node A Retree-managed node; typically the object returned by
     * {@link Retree.root}. The name attaches to the node's tree root
     * identity, so pass the root itself.
     * @param name Display name for the tree.
     *
     * @example
     * ```ts
     * const settings = Retree.root({ theme: "dark" });
     * Retree.registerRootName(settings, "settings");
     * ```
     */
    static registerRootName(node: TreeNode, name: string): void {
        this.assertRetreeManagedNode(node, "Retree.registerRootName");
        if (typeof name !== "string" || name.length === 0) {
            // @retree-throws
            throw new Error(
                "Retree.registerRootName: expected a non-empty string name. This is expected when the name argument is missing or empty. Fix: pass a display name, e.g. Retree.registerRootName(root, 'settings')."
            );
        }
        const rawNode = getUnproxiedNode(node);
        if (!rawNode) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed in Retree.registerRootName: the node passed managed-node validation but has no raw node. This is unexpected and likely a Retree bug. Please file an issue with how the node was created."
            );
        }
        registerRetreeRootName(rawNode, name);
    }

    /**
     * Get a parent node for a given child node, if it exists
     * @param node a child node to get the parent of
     * @returns the parent node if it exists, otherwise null
     * 
     * @example
     ```js
     const tree = Retree.root({
        count: 0,
        child: {
            count: 0,
            child: {
                count: 0,
            },
        },
     });
     function recursiveLog(node) {
        console.log(node.count);
        // Get the parent of node, if it exists
        const parent = Retree.parent(node);
        if (!parent) return; // at top of tree
        recursiveLog(parent);
     }
     Retree.on(tree.child.child, "nodeChanged", (child) => {
        // Recursively log the count of this node and all its parents
        recursiveLog(child);
     });
     tree.child.child.count = 1;
     ```
     */
    static parent(node: TreeNode): TreeNode | null {
        const response = this.getParentInternal(node);
        if (response === null) return null;
        return (
            getManagedProxyForUnproxiedNode(response.rawNode) ??
            response.proxyNode
        );
    }

    /**
     * Check whether a value is a Retree-managed node.
     *
     * @remarks
     * Returns `true` only for values wrapped by a Retree proxy — objects
     * returned by {@link Retree.root} or read through an existing Retree
     * tree. Raw values are not managed nodes: this returns `false` for the
     * objects behind {@link Retree.raw}, for `previous`/`new` change payload
     * values, and for plain objects that were never rooted.
     *
     * Use this as the guard in front of APIs that require a managed node
     * when a value may come from either side of the proxy boundary, such as
     * data that is sometimes Retree state and sometimes plain wire data:
     * `Retree.isNode(value) ? Retree.raw(value) : value`.
     *
     * @param value Value to check; any type is accepted.
     * @returns `true` when the value is a Retree-managed node.
     *
     * @example
     * ```ts
     * const project = Retree.root({ items: [{ score: 1 }] });
     *
     * Retree.isNode(project); // true
     * Retree.isNode(project.items[0]); // true
     * Retree.isNode(Retree.raw(project)); // false — raw values are not managed
     * Retree.isNode({ score: 1 }); // false — never rooted
     * ```
     */
    static isNode(value: unknown): value is TreeNode {
        if (value === null) {
            return false;
        }
        if (typeof value !== "object") {
            return false;
        }
        return getCustomProxyHandler(value) !== undefined;
    }

    /**
     * Get the raw, unproxied object behind a Retree-managed node for
     * read-only, non-reactive access.
     *
     * @remarks
     * Reads through Retree proxies pay per-property trap overhead. That is
     * usually irrelevant, but algorithms that scan large collections of
     * deeply nested nodes can read the raw object at native speed instead.
     *
     * Treat the returned object as read-only. Mutating it directly skips
     * Retree change emission and can desynchronize memoized comparisons; make
     * all writes through the managed node. Reads through `raw` are invisible
     * to reactivity: they are not trapped by `useSelect`/`Retree.select`
     * selectors or `@memo` dependency collection, and children read this way
     * are not prepared for `Retree.parent` / `Retree.on` usage.
     *
     * **Raw purity guarantee:** the returned subtree contains zero Retree
     * proxies, under every write path — including reparenting assignments,
     * `Retree.move`, Map/Set value reads, and post-construction assignment of
     * class instances or collections. Every value is plain data, every read
     * is native speed, and `structuredClone(Retree.raw(node))` is a valid
     * point-in-time copy. Use {@link Retree.managed} to resolve a raw value
     * back to its managed node.
     *
     * Throws when the value is not a Retree-managed node. When a value may
     * come from either side of the proxy boundary, guard with
     * {@link Retree.isNode}: `Retree.isNode(value) ? Retree.raw(value) : value`.
     *
     * @param node Retree-managed node to unwrap.
     * @returns The raw object behind the node.
     *
     * @example
     * ```ts
     * const project = Retree.root({ items: [{ score: 1 }, { score: 92 }] });
     *
     * const rawItems = Retree.raw(project.items);
     * const total = rawItems.reduce((sum, item) => sum + item.score, 0); // ✅ native-speed read
     *
     * project.items[0].score = 50; // ✅ writes stay on the managed tree
     * ```
     */
    static raw<TNode extends TreeNode>(node: TNode): TNode {
        this.assertRetreeManagedNode(node, "Retree.raw");
        noteUntrackedRead();
        return getUnproxiedNode(node) as TNode;
    }

    /**
     * Resolve a raw value back to its Retree-managed node.
     *
     * @remarks
     * This is the inverse of {@link Retree.raw} for values that belong to a
     * Retree tree: given a raw object (for example an element read while
     * scanning a {@link Retree.raw} subtree, or a `previous`/`new` value from
     * a change payload), it returns the latest managed node — ready for
     * mutation, subscription, or navigation. Passing a managed node returns
     * its latest managed identity.
     *
     * Returns `undefined` when the value has never been materialized as a
     * Retree node or is not part of a Retree tree; a miss is a normal query
     * outcome, not an error. Values become materialized when they are read
     * through a managed node, so scanning via managed proxies first (or using
     * `useRaw`'s `toManaged`, which materializes direct children on demand)
     * guarantees resolution.
     *
     * @param value Raw object to resolve.
     * @returns The managed node, or `undefined` when none exists.
     *
     * @example
     * ```ts
     * const project = Retree.root({ items: [{ score: 1 }] });
     * project.items.forEach(() => {}); // materialize
     *
     * const rawItem = Retree.raw(project.items)[0];
     * const item = Retree.managed(rawItem);
     * if (item) item.score = 2; // ✅ emits normally
     * ```
     */
    static managed<TNode extends TreeNode>(value: TNode): TNode | undefined {
        if (value === null || typeof value !== "object") {
            return undefined;
        }
        const managed = getManagedProxyForUnproxiedNode(
            getUnproxiedNode(value) as TreeNode
        );
        return managed as TNode | undefined;
    }

    /**
     * The version of a node's own fields: a number that advances exactly
     * when the node receives a fresh identity for a change of its own.
     *
     * @remarks
     * Two reads of a node are `===` while `Retree.version` is unchanged, so
     * the number is the node's identity in a form a cache can store and
     * compare without holding the node. It advances with `nodeChanged`, not
     * with descendant writes; use {@link Retree.treeVersion} for those.
     * `Retree.runSilent(fn)` skips reproxying and leaves it unchanged, the
     * same way it leaves identities equal.
     *
     * Accepts a managed node or the raw object behind one. Throws for a
     * value that has never been materialized as a Retree node.
     *
     * @param node Managed node or raw object to read the version of.
     * @returns The node's own-field version.
     *
     * @example
     * ```ts
     * const project = Retree.root({ tasks: [{ done: false }] });
     * let cachedVersion = Retree.version(project.tasks);
     * let cachedCount = project.tasks.filter((task) => task.done).length;
     *
     * function doneCount(): number {
     *     const version = Retree.version(project.tasks);
     *     if (version !== cachedVersion) {
     *         cachedVersion = version;
     *         cachedCount = project.tasks.filter((task) => task.done).length;
     *     }
     *     return cachedCount;
     * }
     * ```
     */
    static version(node: TreeNode): number {
        return getNodeVersionOfHandler(
            this.resolveBaseHandler(node, "Retree.version")
        );
    }

    /**
     * The version of a node's subtree: a number that advances when the node
     * or any structural descendant changes.
     *
     * @remarks
     * Matches what `treeChanged` observes, without needing a listener: a
     * write anywhere under the node advances it, a write elsewhere does not.
     * Reading it settles pending ancestor stamps for the node's root, the
     * same lazy walk `useSelect` performs. Accepts a managed node or the raw
     * object behind one; `Retree.runSilent(fn)` leaves it unchanged.
     *
     * @param node Managed node or raw object to read the version of.
     * @returns The node's subtree version.
     */
    static treeVersion(node: TreeNode): number {
        return getTreeVersionOfHandler(
            this.resolveBaseHandler(node, "Retree.treeVersion")
        );
    }

    private static resolveBaseHandler(node: TreeNode, apiName: string) {
        if (node === null || typeof node !== "object") {
            // @retree-throws
            throw new Error(
                `${apiName}: expected a Retree-managed node or the raw object behind one but received a ${typeof node}.`
            );
        }
        const handler = getBaseHandlerForUnproxiedNode(
            getUnproxiedNode(node) as TreeNode
        );
        if (handler === undefined) {
            // @retree-throws
            throw new Error(
                `${apiName}: expected a Retree-managed node or the raw object behind one, but the value has never been materialized as a Retree node. Read it through its managed parent first, or pass a node returned by Retree.root(...).`
            );
        }
        return handler;
    }

    /**
     * Run a synchronous function with Retree dependency tracking paused.
     *
     * @remarks
     * Inside tracked contexts — `Retree.select(() => ...)`, `useSelect`
     * selectors, and auto-trapped `@memo` / `@fnMemo` / `@select` bodies —
     * every Retree read is recorded as a dependency. Wrap bulk reads in
     * `untracked` when they should not subscribe, such as a wide scan whose
     * result is already covered by a narrower dependency.
     *
     * Reads inside `untracked` still go through Retree proxies (combine with
     * {@link Retree.raw} for native-speed scans). Writes inside `untracked`
     * still emit normally; this pauses dependency collection, not change
     * emission.
     *
     * @param fn Function to run without dependency tracking.
     * @returns The function's return value.
     *
     * @example
     * ```ts
     * const doneCount = Retree.select(
     *     () => {
     *         const tasks = project.tasks; // ✅ tracked: subscribes to tasks
     *         return Retree.untracked(
     *             () => tasks.filter((task) => task.done).length
     *         );
     *     },
     *     (count) => console.log(count)
     * );
     * ```
     */
    static untracked<T>(fn: () => T): T {
        return runWithoutDependencyTracking(fn);
    }

    /**
     * Run a read-only query against a node's raw object at native speed, then
     * resolve the result back to its Retree-managed node when one exists.
     *
     * @remarks
     * `peekInto` combines {@link Retree.raw} and {@link Retree.untracked}:
     * the callback receives the raw object behind `node`, so every read
     * inside it skips proxy traps and dependency tracking. If the callback
     * returns an object that belongs to a Retree tree, the latest managed
     * node (reproxy, or base proxy when the node has never reproxied) is
     * returned instead, ready for mutation or subscription. Primitives,
     * `null`, `undefined`, and unmanaged objects are returned as-is.
     *
     * Only the returned value itself is resolved. A container built inside
     * the callback — a `filter` result, a tuple, an object literal — is
     * returned unchanged with raw elements; resolve elements individually
     * when they must be managed. Children that have never been read through
     * the managed tree are not yet materialized and resolve to their raw
     * value; traverse the path once, or use `prepareTree` / `autoPrepare`,
     * when a managed result is required.
     *
     * @param node Retree-managed node to query.
     * @param fn Read-only callback that receives the raw object behind
     * `node`.
     * @returns The callback result, resolved to its managed node when one
     * exists.
     *
     * @example
     * ```ts
     * const project = Retree.root({
     *     tasks: [
     *         { id: "a", done: false },
     *         { id: "b", done: true },
     *     ],
     * });
     * const index = Retree.peekInto(project.tasks, (rawTasks) =>
     *     rawTasks.findIndex((candidate) => candidate.id === "b")
     * );
     * // Resolve just the selected path through the managed tree before writing.
     * if (index >= 0) project.tasks[index].done = false; // emits
     *
     * const doneCount = Retree.peekInto(
     *     project.tasks,
     *     (rawTasks) => rawTasks.filter((candidate) => candidate.done).length
     * ); // ✅ primitive result returned as-is
     * ```
     */
    static peekInto<TNode extends TreeNode, TResult>(
        node: TNode,
        fn: (raw: TNode) => TResult
    ): TResult {
        const raw = this.raw(node);
        const result = runWithoutDependencyTracking(() => fn(raw));
        if (result === null || typeof result !== "object") {
            return result;
        }
        if (isCustomProxy(result)) {
            return getReproxyNode(result) as TResult;
        }
        const managedProxy = getManagedProxyForUnproxiedNode(
            result as TreeNode
        );
        if (managedProxy !== undefined) {
            return managedProxy as TResult;
        }
        return result;
    }

    /**
     * Run a synchronous transaction that will not cause `{@link Retree.on} listeners to emit.
     *
     * @remarks
     * Use `runSilent` for non-rendered bookkeeping or integration state that
     * should update without notifying Retree listeners. By default it also
     * skips reproxying, so old and new object identities stay equal for later
     * comparison checks.
     *
     * Pass `skipReproxy = false` when you want to suppress listener emission
     * but still refresh reproxy identities.
     *
     * **Silence means silence, in both modes.** The only difference between
     * `skipReproxy = true` and `skipReproxy = false` is whether reproxy
     * identities (and parent identities) refresh. Everything observable is
     * suppressed identically in both modes: `Retree.on` listeners do not
     * emit, {@link ReactiveNode} lifecycle does not run (`onChanged` is not
     * called), dependency subscriptions are not refreshed, and dependents of
     * changed dependencies are not notified. If a silent write changes what
     * a `ReactiveNode.dependencies` getter returns, subscriptions resync on
     * that node's next non-silent change.
     *
     * @param transaction transaction function to run
     * @param skipReproxy skip reproxying nodes such that subsequent comparisons are equal.
     * defaults to true.
     *
     * @example
     * ```ts
     * const state = Retree.root({ rendered: 0, telemetry: 0 });
     * Retree.on(state, "nodeChanged", () => console.log("render"));
     *
     * Retree.runSilent(() => {
     *     state.telemetry += 1;
     * }); // ❌ no listener emit
     *
     * state.rendered += 1; // ✅ emits
     * ```
     */
    static runSilent(transaction: () => void, skipReproxy = true) {
        // Save/restore rather than reset-to-false so a nested runSilent does
        // not re-enable emission for the remainder of an outer runSilent body.
        const previousSkipEmit = Transactions.skipEmit;
        const previousSkipReproxy = Transactions.skipReproxy;
        Transactions.skipEmit = true;
        Transactions.skipReproxy = skipReproxy;
        try {
            transaction();
        } finally {
            // Silent mode uses global flags, so always restore them even when the caller's work fails.
            Transactions.skipEmit = previousSkipEmit;
            Transactions.skipReproxy = previousSkipReproxy;
            // Writes made while reproxying was skipped never reached the
            // reproxy chokepoint, so conservatively invalidate
            // version-stamped dependency caches once per silent block.
            bumpGlobalWriteVersion();
        }
    }

    /**
     * Run a synchronous transaction that will not cause {@link Retree.on} listeners for changed nodes to emit multiple times.
     * @remarks
     * If multiple nodes changed during the transaction, {@link Retree.on} events will be emitted for each node that changed.
     * If using React, this should still be flattened to a single render, but it is not guaranteed.
     * It may be reasonable to combine this with `React.startTransition` if this is a concern.
     *
     * @param transaction transaction function to run
     * 
     * @example
     ```ts
     const counter = Retree.root({ count: 0 });
     Retree.on(counter, "nodeChanged", () => console.log(counter.count));
     // Will only emit "nodeChanged" once
     Retree.runTransaction(() => {
        counter.count = counter.count + 1;
        counter.count = counter.count * 2;
     });
     ```
     */
    static runTransaction(transaction: () => void) {
        if (Transactions.runningTransaction) {
            transaction();
            return;
        }

        // Debug taps observe outermost transaction boundaries; the numeric
        // gate keeps the zero-tap path allocation- and call-free.
        if (retreeDebugTapCount > 0) {
            notifyRetreeDebugTaps({ kind: "transactionStart" });
        }
        Transactions.runningTransaction = true;
        try {
            transaction();
        } finally {
            try {
                // Node changes made during the transaction will emit up to one nodeChanged, treeChanged, and/or nodeRemoved listener.
                Transactions.runPendingTransactions();
            } finally {
                // Listener callbacks run during the flush can throw; never leave future updates stuck in transaction mode.
                Transactions.runningTransaction = false;
                if (retreeDebugTapCount > 0) {
                    notifyRetreeDebugTaps({ kind: "transactionEnd" });
                }
            }
        }
    }

    /**
     * Clear all listeners for a given node.
     * @remarks
     * Equivalent to calling each `unsubscribe` function returned by {@link Retree.on}.
     *
     * Prefer storing and calling the unsubscribe returned from
     * {@link Retree.on} when you own a single subscription. Use
     * `clearListeners` when you own every listener for a node, such as during
     * teardown of a Retree-managed integration.
     *
     * @param node node to clear all listeners for
     * @param shallow when false, also unsubscribes every descendant node —
     * the full subtree, not just direct children.
     *
     * @example
     * ```ts
     * const root = Retree.root({ child: { grandchild: { count: 0 } } });
     * Retree.on(root, "nodeChanged", () => {});
     * Retree.on(root.child, "nodeChanged", () => {});
     * Retree.on(root.child.grandchild, "nodeChanged", () => {});
     *
     * Retree.clearListeners(root, false); // clears all three
     * ```
     */
    public static clearListeners(node: TreeNode, shallow: boolean = true) {
        const rawNode = getUnproxiedNode(node);
        if (!rawNode) {
            // @retree-throws
            throw new Error(
                "Retree.clearListeners: expected a Retree-managed node but received an unproxied value. This is expected when clearing listeners for a plain object. Fix: pass the same Retree.root(...) result or Retree child proxy that was used with Retree.on(...), or call the unsubscribe function returned by Retree.on(...)."
            );
        }
        const shouldStopReactiveNode =
            node instanceof ReactiveNode &&
            this.hasReactiveChangedListeners(rawNode);
        this.deleteListenerRegistryEntry(this.nodeChangedListeners, rawNode);
        this.deleteListenerRegistryEntry(this.nodeRemovedListeners, rawNode);
        this.deleteListenerRegistryEntry(this.treeChangedListeners, rawNode);
        this.deleteListenerRegistryEntry(this.subtreeChangedListeners, rawNode);
        if (shouldStopReactiveNode) {
            this.stopReactiveNode(node, rawNode);
            ReactiveNode[RUN_UNOBSERVED_EFFECT_SYMBOL](node);
        }
        if (this.liveListenerCount() === 0) {
            this.stopListening();
        }
        if (shallow) return;
        this.clearDescendantListeners(node, new Set([rawNode]));
    }

    /**
     * Recursive half of `clearListeners(node, false)`: shallow-clears every
     * node reachable from `node`'s fields. `seen` is keyed by unproxied
     * nodes (stable across reproxies) so cycles — e.g. a `Retree.link`
     * pointing back at an ancestor — are visited exactly once.
     */
    private static clearDescendantListeners(
        node: TreeNode,
        seen: Set<TreeNode>
    ) {
        // `Object.values` returns [] for Map/Set, so their entries must be
        // walked explicitly or descendants stored inside them stay subscribed.
        let children: unknown[];
        if (node instanceof Map) {
            children = [...node.values()];
        } else if (node instanceof Set) {
            children = [...node.values()];
        } else {
            children = Object.values(node);
        }
        children.forEach((child) => {
            if (child === null || typeof child !== "object") {
                return;
            }
            const rawChild = getUnproxiedNode(child);
            if (!rawChild) {
                // Unmanaged plain value (e.g. behind @ignore) — nothing can
                // be subscribed to it, so there is nothing to clear.
                return;
            }
            if (seen.has(rawChild)) {
                return;
            }
            seen.add(rawChild);
            this.clearListeners(child);
            this.clearDescendantListeners(child, seen);
        });
    }

    /**
     * Live listeners across all three registries. Stands in for the old
     * `Map.size` checks now that the registries are non-iterable WeakMaps.
     */
    private static liveListenerCount(): number {
        return (
            this.nodeChangedListenerCount +
            this.treeChangedListenerCount +
            this.nodeRemovedListenerCount +
            this.subtreeChangedListenerCount
        );
    }

    /**
     * Adjust registry counts and invalidate cached tree-listener paths when
     * their subscriptions change. Snapshot versions do not depend on listeners.
     */
    private static handleListenerCountChanged(
        relevantListenerMap: WeakMap<TreeNode, TRetreeListeners[]>,
        delta: number
    ): void {
        if (relevantListenerMap === this.nodeChangedListeners) {
            this.nodeChangedListenerCount += delta;
        } else if (relevantListenerMap === this.treeChangedListeners) {
            this.treeChangedListenerCount += delta;
            this.treeListenerVersion++;
        } else if (relevantListenerMap === this.subtreeChangedListeners) {
            this.subtreeChangedListenerCount += delta;
        } else {
            this.nodeRemovedListenerCount += delta;
        }
    }

    /**
     * Remove a node's whole entry from one registry, keeping the live
     * counter in sync with the number of listeners dropped.
     */
    private static deleteListenerRegistryEntry(
        relevantListenerMap: WeakMap<TreeNode, TRetreeListeners[]>,
        rawNode: TreeNode
    ): void {
        const listeners = relevantListenerMap.get(rawNode);
        if (listeners === undefined) {
            return;
        }
        relevantListenerMap.delete(rawNode);
        this.handleListenerCountChanged(relevantListenerMap, -listeners.length);
    }

    private static buildUnsubscribeCallback(
        unproxiedNode: TreeNode,
        proxiedNode: TreeNode,
        callback: TRetreeListeners,
        relevantListenerMap: WeakMap<TreeNode, TNodeChangedListener[]>
    ) {
        // Idempotency flag: React cleanup (especially StrictMode) routinely
        // calls unsubscribe twice. Without it, the second call's
        // `findIndex === -1` would `splice(-1, 1)` and silently remove some
        // other subscriber's listener.
        let unsubscribed = false;
        const unsubscribe = () => {
            if (unsubscribed) return;
            unsubscribed = true;
            const _listeners = relevantListenerMap.get(unproxiedNode);
            if (_listeners) {
                const findIndex = _listeners.findIndex((l) => l === callback);
                if (findIndex !== -1) {
                    _listeners.splice(findIndex, 1);
                    this.handleListenerCountChanged(relevantListenerMap, -1);
                }
                if (_listeners.length === 0) {
                    relevantListenerMap.delete(unproxiedNode);
                }
            }
            const isReactiveChangeListenerMap =
                relevantListenerMap !== this.nodeRemovedListeners;
            if (
                proxiedNode instanceof ReactiveNode &&
                isReactiveChangeListenerMap &&
                !this.hasReactiveChangedListeners(unproxiedNode)
            ) {
                // Stop listening to reactive dependencies
                this.stopReactiveNode(proxiedNode, unproxiedNode);
                ReactiveNode[RUN_UNOBSERVED_EFFECT_SYMBOL](proxiedNode);
            }
            if (this.liveListenerCount() === 0) {
                this.stopListening();
            }
        };
        return unsubscribe;
    }

    private static hasReactiveChangedListeners(unproxiedNode: TreeNode) {
        const nodeChangedListeners =
            this.nodeChangedListeners.get(unproxiedNode);
        if (
            nodeChangedListeners !== undefined &&
            nodeChangedListeners.length > 0
        ) {
            return true;
        }
        const treeChangedListeners =
            this.treeChangedListeners.get(unproxiedNode);
        if (
            treeChangedListeners !== undefined &&
            treeChangedListeners.length > 0
        ) {
            return true;
        }
        const subtreeChangedListeners =
            this.subtreeChangedListeners.get(unproxiedNode);
        return (
            subtreeChangedListeners !== undefined &&
            subtreeChangedListeners.length > 0
        );
    }

    /**
     * Deliver one node's `nodeChanged` to the subtree listeners on it and on
     * each ancestor. Listeners resolve at emission time, like `nodeChanged`,
     * so a cover subscribed mid-flush still sees later emissions.
     */
    private static notifySubtreeChanged(
        unproxiedNode: TreeNode,
        changes: INodeFieldChanges[]
    ): void {
        if (this.subtreeChangedListenerCount === 0) {
            return;
        }
        let handler: ICustomProxyHandler<TreeNode> | undefined =
            getBaseHandlerForUnproxiedNode(unproxiedNode);
        while (handler !== undefined) {
            const listeners = this.subtreeChangedListeners.get(
                handler[unproxiedBaseNodeKey]
            );
            if (listeners !== undefined) {
                this.notifyChangedListeners(listeners, unproxiedNode, changes);
            }
            handler = handler[proxiedParentKey]?.handler ?? undefined;
        }
    }

    private static notifyChangedListeners(
        listeners: TNodeChangedListener[],
        reproxyNode: TreeNode,
        changes: INodeFieldChanges[]
    ): void {
        const firstListener = listeners[0];
        if (firstListener === undefined) {
            return;
        }
        if (listeners.length === 1) {
            firstListener(reproxyNode, changes);
            return;
        }
        for (const callback of [...listeners]) {
            callback(reproxyNode, changes);
        }
    }

    private static notifyRemovedListeners(listeners: (() => void)[]): void {
        const firstListener = listeners[0];
        if (firstListener === undefined) {
            return;
        }
        if (listeners.length === 1) {
            firstListener();
            return;
        }
        for (const callback of [...listeners]) {
            callback();
        }
    }

    private static treeListenerVersion = 0;
    private static treeListenerPaths = new WeakMap<
        TreeNode,
        { structure: number; listeners: number; observed: boolean }
    >();

    private static hasTreeChangedListenerOnAncestorPath(
        proxyNode: TCustomProxy<TreeNode>
    ): boolean {
        const structure = getStructureVersion();
        const listeners = this.treeListenerVersion;
        let handler = getCustomProxyHandler<TreeNode>(proxyNode);
        const path: TreeNode[] = [];
        let observed = false;
        while (handler !== undefined) {
            const raw = handler[unproxiedBaseNodeKey];
            const cached = this.treeListenerPaths.get(raw);
            if (
                cached?.structure === structure &&
                cached.listeners === listeners
            ) {
                observed = cached.observed;
                break;
            }
            path.push(raw);
            if (this.treeChangedListeners.has(raw)) {
                observed = true;
                break;
            }
            const parent = handler[proxiedParentKey]?.handler;
            if (!parent) break;
            handler = parent;
        }
        const entry = { structure, listeners, observed };
        for (const raw of path) this.treeListenerPaths.set(raw, entry);
        return observed;
    }

    /**
     * Schedule `treeChanged` emissions for a change at `proxyNode`. Every
     * ancestor up to the topmost node with a treeChanged listener is
     * reproxied (so consumers see fresh identities along the path) and each
     * listened node on that path is notified. Only reached once
     * {@link Retree.hasTreeChangedListenerOnAncestorPath} found a listener.
     */
    private static handleNotifyTreeChanged(
        unproxiedNode: TreeNode,
        proxyNode: TCustomProxy<TreeNode>,
        changes: INodeFieldChanges[]
    ) {
        // Walk to the root over parent-edge handlers: plain property reads
        // per level and no per-level result objects. Listener arrays are
        // snapshotted at write time so the deferred emission notifies the
        // listeners that existed when the change happened.
        let listenersByProxyNode:
            | Map<TCustomProxy<TreeNode>, TRetreeListeners[]>
            | undefined;
        let topProxyNodeListenedTo: TCustomProxy<TreeNode> | null = null;
        const parentHandlers: ICustomProxyHandler<TreeNode>[] = [];
        const changedHandler = getCustomProxyHandler<TreeNode>(proxyNode);
        if (changedHandler === undefined) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed in handleNotifyTreeChanged: the changed node has no Retree proxy metadata. This is unexpected and likely a Retree bug. Please file an issue with the mutation that triggered this."
            );
        }
        let handler: ICustomProxyHandler<TreeNode> = changedHandler;
        let currentProxyNode = proxyNode;
        let currentUnproxiedNode = unproxiedNode;
        for (;;) {
            const listeners =
                this.treeChangedListeners.get(currentUnproxiedNode);
            if (listeners !== undefined && listeners.length > 0) {
                listenersByProxyNode ??= new Map();
                listenersByProxyNode.set(currentProxyNode, listeners.slice());
                topProxyNodeListenedTo = currentProxyNode;
            }
            const parentHandler = handler[proxiedParentKey]?.handler;
            if (!parentHandler) {
                break;
            }
            handler = parentHandler;
            parentHandlers.push(handler);
            currentProxyNode = handler.baseProxy;
            currentUnproxiedNode = handler[unproxiedBaseNodeKey];
        }
        if (listenersByProxyNode === undefined) {
            return;
        }
        const changedNodeListeners = listenersByProxyNode.get(proxyNode);
        if (changedNodeListeners !== undefined && !Transactions.skipEmit) {
            this.scheduleTreeChangedEmission(
                unproxiedNode,
                changes,
                (changesToNotify) =>
                    this.notifyChangedListeners(
                        changedNodeListeners,
                        getReproxyNode(proxyNode),
                        changesToNotify
                    )
            );
        }
        // If the topmost listener is on the node that changed, skip parents.
        if (topProxyNodeListenedTo === proxyNode) {
            return;
        }
        for (const parentHandler of parentHandlers) {
            const parentProxyNode = parentHandler.baseProxy;
            const parentUnproxiedNode = parentHandler[unproxiedBaseNodeKey];
            // Ancestors only lose their identity here; a listened ancestor
            // materializes its view now because its emission hands it out.
            invalidateReproxyNodeForUnproxiedNode(parentUnproxiedNode);
            const parentListeners = listenersByProxyNode.get(parentProxyNode);
            if (parentListeners !== undefined && !Transactions.skipEmit) {
                const parentReproxyNode =
                    getReproxyNodeForUnproxiedNode(parentUnproxiedNode) ??
                    parentProxyNode;
                this.scheduleTreeChangedEmission(
                    parentUnproxiedNode,
                    changes,
                    (changesToNotify) =>
                        this.notifyChangedListeners(
                            parentListeners,
                            parentReproxyNode,
                            changesToNotify
                        )
                );
            }
            // Stop invalidating above the topmost node anyone listens to.
            if (parentProxyNode === topProxyNodeListenedTo) {
                return;
            }
        }
    }

    private static scheduleTreeChangedEmission(
        unproxiedNode: TreeNode,
        changes: INodeFieldChanges[],
        emitTreeChanged: (changes: INodeFieldChanges[]) => void
    ) {
        // In a transaction, defer so repeat changes to one node emit once.
        if (Transactions.runningTransaction) {
            Transactions.upsertPendingTransaction(unproxiedNode, {
                emitTreeChanged,
                treeChanges: changes,
            });
            return;
        }
        Transactions.runListenerFlush(() => emitTreeChanged(changes));
    }

    private static startListening() {
        const _nodeChangeListener = (
            unproxiedNode: TreeNode,
            proxyNode: TCustomProxy<TreeNode>,
            reproxyNode: TreeNode,
            changes: INodeFieldChanges[]
        ) => {
            if (
                proxyNode instanceof ReactiveNode &&
                !Transactions.runningTransaction
            ) {
                // Internal wrapper, not a user transaction: mark it so undo
                // history records this flush as a discrete write (one step
                // per write, eligible for coalescing) rather than a
                // user-transaction step.
                Transactions.runningInternalReactiveNodeTransaction = true;
                try {
                    this.runTransaction(() => {
                        this.handleNodeChanged(
                            unproxiedNode,
                            proxyNode,
                            reproxyNode,
                            changes
                        );
                    });
                } finally {
                    Transactions.runningInternalReactiveNodeTransaction = false;
                }
                return;
            }

            this.handleNodeChanged(
                unproxiedNode,
                proxyNode,
                reproxyNode,
                changes
            );
        };
        this.nodeChangeListener = _nodeChangeListener.bind(this);
        this.nodeChangeEmitter.on("nodeChanged", this.nodeChangeListener);

        const _nodeRemovedListener = (node: TreeNode) => {
            // If in a skipEmit transaction state, skip emitting
            if (Transactions.skipEmit) return;
            const emitNodeRemovedListeners = () => {
                const listenersToNotify =
                    this.nodeRemovedListeners.get(node) ?? [];
                this.notifyRemovedListeners(listenersToNotify);
            };
            // If running a transaction, schedule this to emit later.
            // That way if this same node gets changed later, we can only emit once for that node.
            if (Transactions.runningTransaction) {
                Transactions.upsertPendingTransaction(node, {
                    emitNodeRemoved: emitNodeRemovedListeners,
                });
            } else {
                // emit immediately
                Transactions.runListenerFlush(emitNodeRemovedListeners);
            }
            // TODO: notify all child nodes as well? or maybe add a treeRemoved listener?
        };
        this.nodeRemovedListener = _nodeRemovedListener.bind(this);
        this.nodeChangeEmitter.on("nodeRemoved", this.nodeRemovedListener);
    }

    private static handleNodeChanged(
        unproxiedNode: TreeNode,
        proxyNode: TCustomProxy<TreeNode>,
        reproxyNode: TreeNode,
        changes: INodeFieldChanges[]
    ) {
        return runWithIsolatedDependencyTracking(() => {
            // runSilent semantics: silence means silence. During a skipEmit
            // window (either runSilent mode), no ReactiveNode lifecycle runs —
            // no onChanged effect, no dependency resubscription, no dependent
            // notification — so both runSilent modes behave identically apart
            // from reproxying. Subscriptions refresh on the next non-silent
            // change of the node.
            const runReactiveNodeLifecycle =
                proxyNode instanceof ReactiveNode && !Transactions.skipEmit;
            if (runReactiveNodeLifecycle) {
                this.scheduleReactiveNodeLifecycle(proxyNode, unproxiedNode);
            }

            if (!Transactions.skipEmit) {
                const emitNodeChangedListeners = (
                    changesToNotify: INodeFieldChanges[]
                ) => {
                    const listeners =
                        this.nodeChangedListeners.get(unproxiedNode);
                    if (listeners !== undefined) {
                        this.notifyChangedListeners(
                            listeners,
                            reproxyNode,
                            changesToNotify
                        );
                    }
                };
                // In a transaction, defer so repeat changes to one node emit
                // once.
                if (Transactions.runningTransaction) {
                    Transactions.upsertPendingTransaction(unproxiedNode, {
                        emitNodeChanged: emitNodeChangedListeners,
                        nodeChanges: changes,
                    });
                } else {
                    Transactions.runListenerFlush(() =>
                        emitNodeChangedListeners(changes)
                    );
                }
                if (this.subtreeChangedListenerCount > 0) {
                    if (Transactions.runningTransaction) {
                        Transactions.upsertPendingTransaction(unproxiedNode, {
                            emitSubtreeChanged: (changesToNotify) =>
                                this.notifySubtreeChanged(
                                    unproxiedNode,
                                    changesToNotify
                                ),
                        });
                    } else {
                        Transactions.runListenerFlush(() =>
                            this.notifySubtreeChanged(unproxiedNode, changes)
                        );
                    }
                }
            }

            // Still handle here so we reproxy parents, despite skipping emit later in biz logic.
            // If no treeChanged listener exists on the changed node or any of
            // its ancestors, nothing can observe this work, so the allocating
            // ancestor walk in handleNotifyTreeChanged is skipped entirely.
            // Note that we should never have gotten this far if skipReproxy is true, so we skip checking again.
            if (
                this.treeChangedListenerCount > 0 &&
                this.hasTreeChangedListenerOnAncestorPath(proxyNode)
            ) {
                this.handleNotifyTreeChanged(unproxiedNode, proxyNode, changes);
            }

            if (runReactiveNodeLifecycle) {
                ReactiveNode[RUN_CHANGED_EFFECT_SYMBOL](proxyNode, changes);
            }
        });
    }

    private static stopListening() {
        if (this.nodeChangeListener) {
            this.nodeChangeEmitter.off("nodeChanged", this.nodeChangeListener);
        }
        if (this.nodeRemovedListener) {
            this.nodeChangeEmitter.off("nodeRemoved", this.nodeRemovedListener);
        }
        this.nodeChangeListener = null;
        this.nodeRemovedListener = null;
        // No registry clearing: stopListening only runs once liveListenerCount()
        // is zero, so every WeakMap entry has already been emptied and deleted
        // by unsubscribe/clearListeners (and WeakMaps cannot be iterated).
    }

    private static getParentInternal(node: TreeNode): {
        propName: string | symbol | null;
        rawNode: TreeNode;
        proxyNode: TCustomProxy<TreeNode>;
    } | null {
        const oldHandler = getCustomProxyHandler(node);
        if (oldHandler) {
            const parent = oldHandler[proxiedParentKey];
            const parentHandler = parent?.handler;
            if (!parentHandler) return null;
            return {
                propName: parent.propName,
                proxyNode: parentHandler.baseProxy,
                rawNode: parentHandler[unproxiedBaseNodeKey],
            };
        }
        // @retree-throws
        throw new Error(
            "Retree.parent: expected a Retree-managed node but received a value without Retree proxy metadata. Pass an object returned by Retree.root(...) or a child read from that tree."
        );
    }

    private static assertRetreeManagedNode(node: TreeNode, apiName: string) {
        if (!getCustomProxyHandler(node)) {
            // @retree-throws
            throw new Error(
                `${apiName}: expected a Retree-managed node but received a value without Retree proxy metadata. Pass an object returned by Retree.root(...) or read a child from an existing Retree tree.`
            );
        }
    }

    private static removeNodeFromParent(
        node: TreeNode,
        parent: TCustomProxy<TreeNode>
    ) {
        if (Array.isArray(parent)) {
            const index = this.findArrayChildIndex(parent, node);
            if (index === -1) {
                // @retree-throws
                throw new Error(
                    "Retree.move: could not find the node in its array parent while removing it. Call Retree.move(node, destination, key) before deleting or reassigning the old entry."
                );
            }
            parent.splice(index, 1);
            return;
        }

        if (parent instanceof Map) {
            const key = this.findMapChildKey(parent, node);
            if (!key.found) {
                // @retree-throws
                throw new Error(
                    "Retree.move: could not find the node in its Map parent while removing it. Call Retree.move(node, destination, key) before deleting or reassigning the old entry."
                );
            }
            parent.delete(key.value);
            return;
        }

        if (parent instanceof Set) {
            if (!parent.delete(node)) {
                // @retree-throws
                throw new Error(
                    "Retree.move: could not find the node in its Set parent while removing it. Call Retree.move(node, destination) before deleting the old Set entry."
                );
            }
            return;
        }

        const parentInfo = this.getParentInternal(node);
        if (!parentInfo || parentInfo.propName === null) {
            // @retree-throws
            throw new Error(
                "Retree.move: could not determine the object property that currently owns this node. Call Retree.move(...) before deleting or reassigning the old property."
            );
        }
        if (!this.isSameTreeNode((parent as any)[parentInfo.propName], node)) {
            // @retree-throws
            throw new Error(
                `Retree.move: parent property ${String(
                    parentInfo.propName
                )} no longer points to the node being moved. Call Retree.move(...) before deleting or overwriting the old property.`
            );
        }
        delete (parent as any)[parentInfo.propName];
    }

    private static insertNodeIntoDestination(
        node: TreeNode,
        destination: TreeNode,
        key: unknown
    ) {
        if (Array.isArray(destination)) {
            if (key === undefined) {
                destination.push(node);
                return;
            }
            if (typeof key !== "number") {
                // @retree-throws
                throw new Error(
                    "Retree.move: array destinations require a numeric key, or no key to append. Pass a number index, or omit the key to append to the array."
                );
            }
            destination.splice(key, 0, node);
            return;
        }

        if (destination instanceof Map) {
            if (key === undefined) {
                // @retree-throws
                throw new Error(
                    "Retree.move: Map destinations require a key. Pass the Map key as the third argument."
                );
            }
            destination.set(key, node);
            return;
        }

        if (destination instanceof Set) {
            destination.add(node);
            return;
        }

        if (typeof key !== "string" && typeof key !== "symbol") {
            // @retree-throws
            throw new Error(
                "Retree.move: object destinations require a string or symbol key. Pass the destination property name as the third argument."
            );
        }
        (destination as any)[key] = node;
    }

    private static findArrayChildIndex(parent: TreeNode[], node: TreeNode) {
        for (let index = 0; index < parent.length; index++) {
            if (this.isSameTreeNode(parent[index], node)) {
                return index;
            }
        }
        return -1;
    }

    private static findMapChildKey(
        parent: Map<unknown, unknown>,
        node: TreeNode
    ): { found: true; value: unknown } | { found: false } {
        for (const [key, value] of parent.entries()) {
            if (this.isSameTreeNode(value, node)) {
                return { found: true, value: key };
            }
        }
        return { found: false };
    }

    private static isSameTreeNode(value: unknown, node: TreeNode) {
        if (value !== null && typeof value === "object") {
            return getUnproxiedNode(value) === getUnproxiedNode(node);
        }
        return false;
    }

    private static cloneValue(
        value: unknown,
        seen: WeakMap<object, object>,
        path: string
    ): unknown {
        if (typeof value === "function") {
            // @retree-throws
            throw new Error(
                `Retree.clone: cannot clone the function stored at "${path}". Function values close over the original instance, so sharing them across clones would silently keep operating on the source node. Fix: define behavior on the class prototype (regular methods clone-safe automatically), mark the field with @ignore, or delete it before cloning.`
            );
        }
        if (value === null || typeof value !== "object") {
            return value;
        }

        // Values reached through Retree.raw(...) are always raw already, but
        // a caller-supplied proxy at the root (or an @ignore field holding a
        // managed node) still resolves to its raw node here.
        const rawValue = getUnproxiedNode(value) ?? value;
        if (seen.has(rawValue)) {
            return seen.get(rawValue);
        }
        this.assertCloneableExoticValue(rawValue, path);

        if (rawValue instanceof Date) {
            const clonedDate = new Date(rawValue.getTime());
            seen.set(rawValue, clonedDate);
            return clonedDate;
        }

        if (rawValue instanceof Map) {
            const clonedMap = new Map();
            seen.set(rawValue, clonedMap);
            for (const [mapKey, mapValue] of rawValue.entries()) {
                clonedMap.set(
                    mapKey,
                    this.cloneValue(
                        mapValue,
                        seen,
                        `${path}.get(${String(mapKey)})`
                    )
                );
            }
            return clonedMap;
        }

        if (rawValue instanceof Set) {
            const clonedSet = new Set();
            seen.set(rawValue, clonedSet);
            let memberIndex = 0;
            for (const setValue of rawValue.values()) {
                clonedSet.add(
                    this.cloneValue(
                        setValue,
                        seen,
                        `${path}<Set member ${memberIndex}>`
                    )
                );
                memberIndex++;
            }
            return clonedSet;
        }

        if (Array.isArray(rawValue)) {
            const clonedArray: unknown[] = [];
            seen.set(rawValue, clonedArray);
            rawValue.forEach((item, index) => {
                clonedArray[index] = this.cloneValue(
                    item,
                    seen,
                    `${path}[${index}]`
                );
            });
            return clonedArray;
        }

        const clonedObject = Object.create(Object.getPrototypeOf(rawValue));
        seen.set(rawValue, clonedObject);
        for (const key of Reflect.ownKeys(rawValue)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(rawValue, key);
            if (!descriptor) {
                continue;
            }
            if ("value" in descriptor) {
                Reflect.defineProperty(clonedObject, key, {
                    ...descriptor,
                    value: this.cloneValue(
                        descriptor.value,
                        seen,
                        `${path}.${String(key)}`
                    ),
                });
                continue;
            }
            Reflect.defineProperty(clonedObject, key, descriptor);
        }
        return clonedObject;
    }

    /**
     * Throw a pinpointed error for exotic object types `Retree.clone` would
     * otherwise mangle (their data lives in internal slots that a
     * `Reflect.ownKeys` walk cannot copy).
     */
    private static assertCloneableExoticValue(
        rawValue: object,
        path: string
    ): void {
        if (rawValue instanceof RegExp) {
            // @retree-throws
            throw new Error(
                `Retree.clone: cannot clone the RegExp stored at "${path}". RegExp state lives in internal slots, so a property-walk clone would produce a broken empty object. Fix: mark the field with @ignore, or store the pattern as { source, flags } strings and build the RegExp where it is used.`
            );
        }
        if (rawValue instanceof ArrayBuffer) {
            // @retree-throws
            throw new Error(
                `Retree.clone: cannot clone the ArrayBuffer stored at "${path}". Binary buffer contents live in internal slots, so a property-walk clone would silently drop the bytes. Fix: mark the field with @ignore, or store the data in a plain number array.`
            );
        }
        if (
            typeof SharedArrayBuffer !== "undefined" &&
            rawValue instanceof SharedArrayBuffer
        ) {
            // @retree-throws
            throw new Error(
                `Retree.clone: cannot clone the SharedArrayBuffer stored at "${path}". Shared binary buffer contents live in internal slots, so a property-walk clone would silently drop the bytes. Fix: mark the field with @ignore.`
            );
        }
        if (ArrayBuffer.isView(rawValue)) {
            // @retree-throws
            throw new Error(
                `Retree.clone: cannot clone the ${rawValue.constructor.name} stored at "${path}". Typed-array and DataView contents live in internal slots, so a property-walk clone would silently drop the bytes. Fix: mark the field with @ignore, or store the data in a plain number array.`
            );
        }
    }

    /**
     * Run the ReactiveNode lifecycle pass now, or defer it to the transaction
     * flush when a transaction is running.
     *
     * @remarks
     * Deferral is the fix for eager `@select` value capture: evaluating
     * select getters (and any memos they read) between two writes of one
     * transaction observes torn state — e.g. a memo keyed on a revision
     * counter that was bumped before its backing state was written caches the
     * pre-write state under the new revision permanently. Deferred passes run
     * once per flush per node against settled state, which also collapses N
     * writes' worth of dependency collection into one pass.
     */
    private static scheduleReactiveNodeLifecycle(
        proxiedDependentNode: ReactiveNode,
        unproxiedDependentNode: TreeNode
    ) {
        if (Transactions.runningTransaction) {
            this.pendingReactiveLifecycleNodes.set(
                unproxiedDependentNode,
                proxiedDependentNode
            );
            return;
        }
        this.handleReactiveNode(proxiedDependentNode, unproxiedDependentNode);
    }

    /**
     * Run every deferred lifecycle pass. Invoked by the transaction flush
     * before each pending emission and once after the last one, so passes
     * observe settled state even when listeners write mid-flush.
     */
    private static drainPendingReactiveLifecycles() {
        if (this.pendingReactiveLifecycleNodes.size === 0) {
            return;
        }
        // The synchronous lifecycle path ran inside handleNodeChanged's
        // isolation; the drain must match it. Without isolation, a flush
        // triggered by a write inside a tracked selector or memo would leak
        // every collection-pass read into the caller's tracking frame and
        // poison its comparisons.
        runWithIsolatedDependencyTracking(() => {
            // Delete each entry before processing it: a lifecycle pass that
            // throws (e.g. a throwing `dependencies` getter) must not drop
            // every other queued node's pass — the remainder stays queued for
            // the next drain — and must not retry itself forever.
            // One live iterator also visits nodes queued mid-drain, where a
            // fresh `entries().next()` per node scanned past every deleted
            // slot and made the drain quadratic in queued nodes.
            for (const [unproxiedNode, proxiedNode] of this
                .pendingReactiveLifecycleNodes) {
                this.pendingReactiveLifecycleNodes.delete(unproxiedNode);
                this.handleReactiveNode(proxiedNode, unproxiedNode);
            }
        });
    }

    private static handleReactiveNode(
        proxiedDependentNode: ReactiveNode,
        unproxiedDependentNode: TreeNode
    ) {
        const collection =
            this.getReactiveNodeDependencyCollection(proxiedDependentNode);
        const currentDependencies = collection.dependencies;
        // Resolved once per getter here instead of stamping every shared
        // record: a getter with N dependency records would otherwise cost N
        // record clones per lifecycle pass. Resolution runs without emitting,
        // matching where the getter ran before lazy cells existed — a getter
        // that writes must not emit, reproxy, and re-trigger itself forever.
        const resolvedSelectValues = this.runWithoutEmitting(() =>
            this.resolveReactiveSelectValues(proxiedDependentNode, collection)
        );
        const previousDependencies = getReactiveDependencies(
            unproxiedDependentNode
        );
        if (currentDependencies.length === 0) {
            if (previousDependencies !== undefined) {
                this.unsubscribeReactiveDependencies(
                    previousDependencies,
                    unproxiedDependentNode
                );
                deleteReactiveDependencies(unproxiedDependentNode);
            }
            return;
        }
        const nextDependencies = new Map<string, IActiveReactiveDependency>();
        for (const currentDependency of currentDependencies) {
            const key = currentDependency.key;
            const previousDependency = previousDependencies?.get(key);
            const newDependencyNode = currentDependency.node;
            const previousUnproxiedDependencyNode =
                previousDependency?.unproxiedNode;
            let currentUnproxiedDependencyNode: TreeNode | undefined;

            if (
                previousDependency?.node !== undefined &&
                previousDependency.node !== null &&
                previousUnproxiedDependencyNode === undefined
            ) {
                // @retree-throws
                throw new Error(
                    "Retree internal invariant failed: a previous ReactiveNode dependency had a node but no cached raw node. This is unexpected and likely a Retree bug. Please file an issue with the ReactiveNode.dependencies implementation and the mutation that triggered this."
                );
            }
            if (
                previousDependency !== undefined &&
                previousDependency.node === newDependencyNode
            ) {
                currentUnproxiedDependencyNode =
                    previousDependency.unproxiedNode;
            } else if (newDependencyNode) {
                const unproxiedDependencyNode =
                    getUnproxiedNode(newDependencyNode);
                if (!unproxiedDependencyNode) {
                    // @retree-throws
                    throw new Error(
                        "ReactiveNode.dependencies returned an object that is not Retree-managed. This is expected when a dependency points at a plain object. Fix: return null/undefined for inactive dependencies, or return a node created by Retree.root(...) or read from an existing Retree tree."
                    );
                }
                currentUnproxiedDependencyNode = unproxiedDependencyNode;
            }

            // A dependency written this flush whose emission has not been
            // validated yet must keep the baseline listeners last observed:
            // overwriting it with post-write values here (the drain runs
            // before emissions) would make the validation judge "unchanged"
            // and silently absorb the pending change. New records (no
            // previous baseline) store undefined, which validation treats as
            // "assume changed" — a conservative notify instead of a lost one.
            // Access summaries are a validation gate over the same baseline.
            const preserveBaseline =
                currentUnproxiedDependencyNode !== undefined &&
                Transactions.hasPendingEmissionFor(
                    currentUnproxiedDependencyNode
                );
            const selectGetterName = currentDependency.selectGetterName;
            let selectValue: unknown;
            if (preserveBaseline) {
                selectValue = previousDependency?.selectValue;
            } else if (selectGetterName !== undefined) {
                selectValue = resolvedSelectValues?.get(selectGetterName);
            }
            const comparisons = preserveBaseline
                ? previousDependency?.comparisons
                : currentDependency.comparisons;
            const comparisonsOffset = preserveBaseline
                ? previousDependency?.comparisonsOffset
                : currentDependency.comparisonsOffset;
            const reads = preserveBaseline
                ? previousDependency?.reads
                : currentDependency.reads;

            // One record serves both registries and survives across passes:
            // a retained edge refreshes its baselines in place with no
            // allocation and no re-subscription.
            let record: IActiveReactiveDependency;
            if (previousDependency !== undefined) {
                record = previousDependency;
                record.node = newDependencyNode;
                record.comparisons = comparisons;
                record.comparisonsOffset = comparisonsOffset;
                record.selectGetterName = selectGetterName;
                record.selectValue = selectValue;
                record.compareSelectValueBeforeNotify =
                    currentDependency.compareSelectValueBeforeNotify;
                record.reads = reads;
                record.reactiveNode = proxiedDependentNode;
            } else {
                record = {
                    key,
                    node: newDependencyNode,
                    comparisons,
                    comparisonsOffset,
                    selectGetterName,
                    selectValue,
                    compareSelectValueBeforeNotify:
                        currentDependency.compareSelectValueBeforeNotify,
                    reads,
                    reactiveNode: proxiedDependentNode,
                    unproxiedReactiveNode: unproxiedDependentNode,
                    unsubscribeListener: undefined,
                    unproxiedNode: currentUnproxiedDependencyNode,
                };
            }

            if (
                previousUnproxiedDependencyNode !== undefined &&
                previousUnproxiedDependencyNode ===
                    currentUnproxiedDependencyNode
            ) {
                setReactiveDependents(previousUnproxiedDependencyNode, record);
            } else {
                record.unsubscribeListener?.();
                record.unsubscribeListener = undefined;
                if (previousUnproxiedDependencyNode !== undefined) {
                    deleteReactiveDependent(
                        previousUnproxiedDependencyNode,
                        unproxiedDependentNode,
                        key
                    );
                }
                record.unproxiedNode = currentUnproxiedDependencyNode;
                if (currentUnproxiedDependencyNode !== undefined) {
                    setReactiveDependents(
                        currentUnproxiedDependencyNode,
                        record
                    );
                    if (newDependencyNode) {
                        record.unsubscribeListener =
                            retainReactiveDependencySubscription(
                                currentUnproxiedDependencyNode,
                                () =>
                                    this.on(
                                        newDependencyNode,
                                        // TODO: figure out if I should support treeChanged for this...seems expensive
                                        "nodeChanged",
                                        this
                                            .reactiveDependentNodeChangedListener
                                    )
                            );
                    }
                }
            }
            nextDependencies.set(key, record);
        }
        if (previousDependencies !== undefined) {
            for (const [key, previousDependency] of previousDependencies) {
                if (nextDependencies.has(key)) {
                    continue;
                }
                previousDependency.unsubscribeListener?.();
                const previousUnproxiedDependencyNode =
                    previousDependency.unproxiedNode;
                if (previousUnproxiedDependencyNode !== undefined) {
                    deleteReactiveDependent(
                        previousUnproxiedDependencyNode,
                        unproxiedDependentNode,
                        key
                    );
                }
            }
        }
        setReactiveDependencies(unproxiedDependentNode, nextDependencies);
    }

    private static getReactiveSelectDependencies(
        proxiedDependentNode: ReactiveNode,
        captureSelectValue: (
            getterName: string | symbol,
            cell: IReactiveSelectValueCell
        ) => void
    ): IReactiveDependencyCollectionEntry[] {
        const selectGetters = proxiedDependentNode[SELECT_GETTERS_SYMBOL];
        const dependencies: IReactiveDependencyCollectionEntry[] = [];
        const unproxiedDependentNode = getUnproxiedNode(proxiedDependentNode);
        for (const [getterName, selectGetter] of selectGetters.entries()) {
            const trackedAccesses =
                selectGetter.collectTrackedDependencies?.(proxiedDependentNode);
            const selected =
                trackedAccesses !== undefined
                    ? trackedAccesses.getDependencies()
                    : selectGetter.getDependencies(proxiedDependentNode);
            const selectedDependencies = normalizeSelectDependencies(selected);
            if (selectedDependencies.length === 0) {
                continue;
            }
            if (selectGetter.compareValueBeforeNotify) {
                // Trapped getters already ran during collection, so their
                // value is captured for free instead of running the getter a
                // second time. Explicit-selector getters stay lazy so an
                // unchanged-dependency validation never runs the output
                // getter at all.
                captureSelectValue(
                    getterName,
                    trackedAccesses !== undefined
                        ? {
                              resolved: true,
                              value: trackedAccesses.value,
                              compute: undefined,
                          }
                        : {
                              resolved: false,
                              value: undefined,
                              compute: () =>
                                  selectGetter.getValue(proxiedDependentNode),
                          }
                );
            }
            // Each non-explicit dependency compares against the flattened
            // comparison values of every dependency after it. Normalize each
            // entry once and build one shared flattened array with per-entry
            // start offsets, so building every suffix is O(total values)
            // instead of O(N^2) slice-and-renormalize passes.
            const normalizedEntries: NormalizedDependencySlot[] = [];
            const flatComparisonValues: unknown[] = [];
            const entryStartOffsets: number[] = [];
            for (const selectedDependency of selectedDependencies) {
                const normalizedEntry =
                    normalizeDependencyEntry(selectedDependency);
                normalizedEntries.push(normalizedEntry);
                entryStartOffsets.push(flatComparisonValues.length);
                for (const comparisonValue of normalizedEntry.comparisonValues) {
                    flatComparisonValues.push(comparisonValue);
                }
            }
            for (
                let dependencyIndex = 0;
                dependencyIndex < selectedDependencies.length;
                dependencyIndex++
            ) {
                const normalizedEntry = normalizedEntries[dependencyIndex];
                const key = getSelectDependencyKey(getterName, dependencyIndex);
                if (
                    normalizedEntry.node !== undefined &&
                    normalizedEntry.node !== null &&
                    getUnproxiedNode(normalizedEntry.node) ===
                        unproxiedDependentNode
                ) {
                    continue;
                }
                const suffixOffset =
                    dependencyIndex + 1 < entryStartOffsets.length
                        ? entryStartOffsets[dependencyIndex + 1]
                        : flatComparisonValues.length;
                const useOwnComparisons =
                    normalizedEntry.explicit ||
                    suffixOffset === flatComparisonValues.length;
                dependencies.push({
                    key,
                    node: normalizedEntry.node,
                    comparisons: useOwnComparisons
                        ? normalizedEntry.comparisons
                        : flatComparisonValues,
                    comparisonsOffset: useOwnComparisons
                        ? undefined
                        : suffixOffset,
                    selectGetterName: getterName,
                    compareSelectValueBeforeNotify:
                        selectGetter.compareValueBeforeNotify,
                    reads: trackedAccesses?.reads,
                });
            }
        }
        return dependencies;
    }

    /**
     * Resolve the select value a lifecycle pass should store as "previous"
     * for one getter: a value pending from the notification comparison takes
     * priority (it is the exact instance listeners were compared against);
     * otherwise the value captured by the current collection pass is used.
     */
    private static consumeReactiveSelectValue(
        proxiedDependentNode: ReactiveNode,
        getterName: string | symbol,
        cell: IReactiveSelectValueCell
    ) {
        const pendingValues =
            this.pendingReactiveSelectValueMap.get(proxiedDependentNode);
        if (pendingValues !== undefined && pendingValues.has(getterName)) {
            const value = pendingValues.get(getterName);
            pendingValues.delete(getterName);
            if (pendingValues.size === 0) {
                this.pendingReactiveSelectValueMap.delete(proxiedDependentNode);
            }
            return value;
        }
        // Resolve only on a pending miss: for explicit-selector getters the
        // cell is lazy, and a pending value must not cost an extra getter run.
        return resolveReactiveSelectValueCell(cell);
    }

    private static setPendingReactiveSelectValue(
        proxiedDependentNode: ReactiveNode,
        getterName: string | symbol,
        value: unknown
    ) {
        const existingValues =
            this.pendingReactiveSelectValueMap.get(proxiedDependentNode);
        if (existingValues !== undefined) {
            existingValues.set(getterName, value);
            return;
        }
        this.pendingReactiveSelectValueMap.set(
            proxiedDependentNode,
            new Map([[getterName, value]])
        );
    }

    /**
     * Resolve the select value each `@select` getter should store as its
     * "previous" for this lifecycle pass, keyed by getter name. Pending
     * notification-compared values take priority over collection-captured
     * ones (see {@link Retree.consumeReactiveSelectValue}).
     */
    private static resolveReactiveSelectValues(
        proxiedDependentNode: ReactiveNode,
        collection: IReactiveDependencyCollection
    ): Map<string | symbol, unknown> | undefined {
        const selectValues = collection.selectValues;
        if (selectValues === undefined) {
            return undefined;
        }
        const resolvedValues = new Map<string | symbol, unknown>();
        for (const [getterName, cell] of selectValues.entries()) {
            resolvedValues.set(
                getterName,
                this.consumeReactiveSelectValue(
                    proxiedDependentNode,
                    getterName,
                    cell
                )
            );
        }
        return resolvedValues;
    }

    /**
     * Version-stamped memo cell over one full dependency-collection pass
     * (`dependencies` getter + every `@select` getter). Validation passes for
     * N changed dependencies in one flush and the lifecycle pass that follows
     * all share a single collection instead of re-running every getter.
     */
    private static getReactiveNodeDependencyCollection(
        proxiedDependentNode: ReactiveNode
    ): IReactiveDependencyCollection {
        const unproxiedNode = getUnproxiedNode(proxiedDependentNode);
        const version = getGlobalWriteVersion();
        if (unproxiedNode !== undefined) {
            const cached =
                this.reactiveDependencyCollectionCache.get(unproxiedNode);
            if (cached !== undefined && cached.version === version) {
                return cached;
            }
        }
        const collection = this.runWithoutEmitting(
            (): IReactiveDependencyCollection => {
                let selectValues:
                    | Map<string | symbol, IReactiveSelectValueCell>
                    | undefined;
                const dependencies = [
                    ...proxiedDependentNode.dependencies.map(
                        (dependency, index) =>
                            this.normalizeReactiveNodeDependency(
                                dependency,
                                getDependenciesGetterKey(index)
                            )
                    ),
                    ...this.getReactiveSelectDependencies(
                        proxiedDependentNode,
                        (getterName, cell) => {
                            selectValues ??= new Map();
                            selectValues.set(getterName, cell);
                        }
                    ),
                ];
                return { version, dependencies, selectValues };
            }
        );
        if (unproxiedNode !== undefined) {
            this.reactiveDependencyCollectionCache.set(
                unproxiedNode,
                collection
            );
        }
        return collection;
    }

    private static runWithoutEmitting<T>(callback: () => T): T {
        const previousSkipEmit = Transactions.skipEmit;
        const previousSkipReproxy = Transactions.skipReproxy;
        Transactions.skipEmit = true;
        Transactions.skipReproxy = true;
        try {
            return callback();
        } finally {
            Transactions.skipEmit = previousSkipEmit;
            Transactions.skipReproxy = previousSkipReproxy;
        }
    }

    private static normalizeReactiveNodeDependency(
        dependency: unknown,
        key: string
    ): IReactiveDependencyCollectionEntry {
        const normalizedDependency = normalizeDependencyEntry(dependency);
        return {
            key,
            node: normalizedDependency.node,
            comparisons: normalizedDependency.comparisons,
        };
    }

    private static unsubscribeReactiveDependencies(
        dependencies: Map<string, IActiveReactiveDependency>,
        unproxiedNode: TreeNode
    ) {
        for (const dependency of dependencies.values()) {
            dependency.unsubscribeListener?.();
            const unproxiedDependencyNode = dependency.unproxiedNode;
            if (unproxiedDependencyNode !== undefined) {
                deleteReactiveDependent(
                    unproxiedDependencyNode,
                    unproxiedNode,
                    dependency.key
                );
            }
        }
    }

    private static stopReactiveNode(
        proxiedNode: ReactiveNode,
        unproxiedNode: TreeNode
    ) {
        // A deferred lifecycle pass must not resurrect subscriptions for a
        // node that was stopped before the flush drained it; a later write
        // re-schedules it exactly like the eager sequence would have.
        this.pendingReactiveLifecycleNodes.delete(unproxiedNode);
        const previous = getReactiveDependencies(unproxiedNode);
        if (previous !== undefined) {
            this.unsubscribeReactiveDependencies(previous, unproxiedNode);
        }
        deleteReactiveDependencies(unproxiedNode);
    }

    /**
     * Handler for when a dependent node changed for a reactive node
     * @param reproxy the reproxied node that changed
     */
    private static handleReactiveDependentNodeChanged(
        reproxy: TreeNode,
        changes: INodeFieldChanges[]
    ) {
        const _unproxy = getUnproxiedNode(reproxy);
        if (!_unproxy) {
            // @retree-throws
            throw new Error(
                "Retree internal invariant failed: a ReactiveNode dependency change arrived with an unproxied node. This is unexpected and likely a Retree bug. Please file an issue with the dependency node and mutation that triggered this."
            );
        }
        const dependents = getReactiveDependents(_unproxy);
        if (!dependents) {
            return;
        }
        const groupedDependents = this.groupReactiveDependents(dependents);
        groupedDependents.forEach((group) => {
            // All dependents in a group share one ReactiveNode, so its current
            // dependency list is computed at most once per group. Recomputing it
            // per dependent re-runs the `dependencies` getter and every @select
            // getter M times for a node with M edges onto the changed node.
            let latestDependenciesByKey:
                | Map<string, IReactiveDependencyCollectionEntry>
                | undefined;
            const getLatestDependenciesByKey = () => {
                if (latestDependenciesByKey === undefined) {
                    latestDependenciesByKey = new Map();
                    const latestDependencies =
                        this.getReactiveNodeDependencyCollection(
                            group.reactiveNode
                        ).dependencies;
                    for (const dependency of latestDependencies) {
                        latestDependenciesByKey.set(dependency.key, dependency);
                    }
                }
                return latestDependenciesByKey;
            };
            if (
                !group.dependents.some((dependent) =>
                    this.shouldNotifyReactiveDependent(
                        dependent,
                        _unproxy,
                        changes,
                        getLatestDependenciesByKey
                    )
                )
            ) {
                return;
            }
            // Reproxy node and emit listener
            const dependentBaseProxy = getBaseProxy(group.reactiveNode);
            const dependentUnproxied =
                getUnproxiedNodeFromProxy(dependentBaseProxy);
            const dependentReproxy = Transactions.skipReproxy
                ? getReproxyNodeForUnproxiedNode(dependentUnproxied)
                : this.reproxyDependentForNotification(
                      dependentBaseProxy,
                      dependentUnproxied
                  );
            if (!dependentReproxy) {
                // @retree-throws
                throw new Error(
                    "Retree internal invariant failed: unexpectedly found no reproxy value for a dependent ReactiveNode. This is unexpected and likely a Retree bug. Please file an issue with the ReactiveNode.dependencies implementation and whether the mutation happened inside Retree.runSilent(...)."
                );
            }
            this.nodeChangeListener?.(
                dependentUnproxied,
                dependentBaseProxy,
                dependentReproxy,
                changes
            );
        });
    }

    /**
     * Reproxy a dependent ReactiveNode whose dependency changed. The reproxy
     * bumps the global write version, but the only state it changes is this
     * node's own proxy identity, which its own dependency collection cannot
     * observe. Re-stamping the collection that validation just built lets
     * the deferred lifecycle pass reuse it instead of re-running the
     * `dependencies` getter and every `@select` getter a second time.
     */
    private static reproxyDependentForNotification(
        dependentBaseProxy: TCustomProxy<ReactiveNode>,
        dependentUnproxied: TreeNode
    ) {
        const cached =
            this.reactiveDependencyCollectionCache.get(dependentUnproxied);
        const cachedIsCurrent =
            cached !== undefined && cached.version === getGlobalWriteVersion();
        const reproxy = updateReproxyNodeForChange(dependentBaseProxy);
        if (cachedIsCurrent) {
            cached.version = getGlobalWriteVersion();
        }
        return reproxy;
    }

    private static groupReactiveDependents(
        dependentGroups: Map<TreeNode, IReactiveDependentGroup>
    ) {
        // Snapshot the live store: notifying a group can re-run
        // handleReactiveNode, which mutates these maps while we iterate.
        const groups: {
            reactiveNode: ReactiveNode;
            dependents: IActiveReactiveDependency[];
        }[] = [];
        for (const group of dependentGroups.values()) {
            groups.push({
                reactiveNode: group.reactiveNode,
                dependents: Array.from(group.dependentsByKey.values()),
            });
        }
        return groups;
    }

    private static shouldNotifyReactiveDependent(
        dependent: IActiveReactiveDependency,
        changedUnproxiedNode: TreeNode,
        changes: INodeFieldChanges[],
        getLatestDependenciesByKey: () => Map<
            string,
            IReactiveDependencyCollectionEntry
        >
    ) {
        // Auto-trapped @select dependents carry per-node read summaries from
        // their last collection pass. When every value the getter read from
        // the changed node re-reads equal, skip without re-running the
        // getter's dependency collection at all.
        const reads = dependent.reads;
        if (
            reads !== undefined &&
            canSkipTrackedDependencyChange(
                changedUnproxiedNode,
                reads.get(changedUnproxiedNode),
                changes
            )
        ) {
            return false;
        }
        const dependencyChanged = this.hasReactiveDependencyChanged(
            dependent,
            changedUnproxiedNode,
            getLatestDependenciesByKey
        );
        if (!dependencyChanged) {
            return false;
        }
        const selectValueChanged =
            this.hasReactiveSelectValueChanged(dependent);
        if (selectValueChanged !== undefined) {
            return selectValueChanged;
        }
        return true;
    }

    private static hasReactiveDependencyChanged(
        dependent: IActiveReactiveDependency,
        changedUnproxiedNode: TreeNode,
        getLatestDependenciesByKey: () => Map<
            string,
            IReactiveDependencyCollectionEntry
        >
    ) {
        const previousComparisons = dependent.comparisons;
        if (previousComparisons === undefined) {
            return true;
        }
        const latest = getLatestDependenciesByKey().get(dependent.key);
        if (latest === undefined) {
            return true;
        }
        if (latest.node !== undefined && latest.node !== null) {
            if (getUnproxiedNode(latest.node) !== changedUnproxiedNode) {
                return true;
            }
        }
        const latestComparisons = latest.comparisons;
        if (latestComparisons === undefined) {
            return true;
        }
        // `comparisons` may be an array shared across every dependency of one
        // collection pass; each side's offset marks where this dependency's
        // comparison window starts.
        const previousOffset = dependent.comparisonsOffset ?? 0;
        const latestOffset = latest.comparisonsOffset ?? 0;
        const previousLength = previousComparisons.length - previousOffset;
        const latestLength = latestComparisons.length - latestOffset;
        if (latestLength !== previousLength) {
            return true;
        }
        for (let i = 0; i < latestLength; i++) {
            if (
                !areDependencyValuesEqual(
                    previousComparisons[previousOffset + i],
                    latestComparisons[latestOffset + i]
                )
            ) {
                return true;
            }
        }
        return false;
    }

    private static hasReactiveSelectValueChanged(
        dependent: IActiveReactiveDependency
    ): boolean | undefined {
        const selectGetterName = dependent.selectGetterName;
        if (selectGetterName === undefined) {
            return undefined;
        }
        if (!dependent.compareSelectValueBeforeNotify) {
            return undefined;
        }
        const selectGetter =
            dependent.reactiveNode[SELECT_GETTERS_SYMBOL].get(selectGetterName);
        if (selectGetter === undefined) {
            return true;
        }
        // Read the latest value from the shared collection pass so a flush
        // with N changed dependencies runs the getter once, not N times. The
        // getter-call fallback covers getters the collection pass skipped
        // (e.g. a selector that returned no dependencies this pass).
        const collection = this.getReactiveNodeDependencyCollection(
            dependent.reactiveNode
        );
        const latestValueCell = collection.selectValues?.get(selectGetterName);
        const latestValue =
            latestValueCell !== undefined
                ? resolveReactiveSelectValueCell(latestValueCell)
                : selectGetter.getValue(dependent.reactiveNode);
        const changed =
            selectGetter.equals !== undefined
                ? !selectGetter.equals(
                      dependent.reactiveNode,
                      dependent.selectValue,
                      latestValue
                  )
                : !defaultSelectEquals(dependent.selectValue, latestValue);
        if (changed) {
            this.setPendingReactiveSelectValue(
                dependent.reactiveNode,
                selectGetterName,
                latestValue
            );
        }
        return changed;
    }
}
