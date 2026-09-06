import { IReactiveDependency, ReactiveNode } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import type { NodeReadRecord } from "./dependency-tracking.js";

/**
 * One dependency as produced by a collection pass. Records are shared by
 * every caller within one write version and must be treated as immutable.
 */
export interface IReactiveDependencyCollectionEntry
    extends IReactiveDependency {
    key: string;
    /**
     * Start index into `comparisons` for this dependency's comparison window.
     * `comparisons` may be an array shared across every dependency of one
     * `@select` collection pass; only values at `comparisonsOffset` and later
     * belong to this dependency. `undefined` means the whole array applies.
     */
    comparisonsOffset?: number;
    selectGetterName?: string | symbol;
    compareSelectValueBeforeNotify?: boolean;
    /**
     * Per-node read records captured while an auto-trapped `@select` getter
     * collected this dependency, so an unrelated `nodeChanged` can be
     * skipped without re-running the getter.
     */
    reads?: ReadonlyMap<TreeNode, NodeReadRecord>;
    /** Records of `reads` holding a tree version read. */
    subtreeReads?: readonly NodeReadRecord[];
    /**
     * The getter read the dependency node's tree version, so the edge also
     * listens to the node's subtree.
     */
    subtree?: boolean;
}

/**
 * One live dependency edge. The same record is stored in the dependent
 * ReactiveNode's dependency map and in the dependency node's dependents
 * registry, so a lifecycle pass allocates one object per edge.
 */
export interface IActiveReactiveDependency
    extends IReactiveDependencyCollectionEntry {
    reactiveNode: ReactiveNode;
    unproxiedReactiveNode: TreeNode;
    selectValue?: unknown;
    unsubscribeListener: (() => void) | undefined;
    unproxiedNode: TreeNode | undefined;
}

/**
 * Every dependent record one ReactiveNode holds on one dependency node, keyed
 * by dependency key. Keyed storage keeps registering N dependents on one
 * shared node (e.g. every element read of one array) O(1) per record instead
 * of an O(N) scan per record.
 */
export interface IReactiveDependentGroup {
    reactiveNode: ReactiveNode;
    dependentsByKey: Map<string, IActiveReactiveDependency>;
}

let reactiveDependentMap:
    | WeakMap<TreeNode, Map<TreeNode, IReactiveDependentGroup>>
    | undefined;

let reactiveDependenciesMap:
    | WeakMap<TreeNode, Map<string, IActiveReactiveDependency>>
    | undefined;

let reactiveDependencySubscriptionMap:
    | WeakMap<
          TreeNode,
          {
              referenceCount: number;
              unsubscribe: () => void;
          }
      >
    | undefined;

export function getReactiveDependencies(
    unproxiedNode: TreeNode
): Map<string, IActiveReactiveDependency> | undefined {
    if (!reactiveDependenciesMap) {
        reactiveDependenciesMap = new WeakMap();
        return undefined;
    }
    return reactiveDependenciesMap.get(unproxiedNode);
}

export function setReactiveDependencies(
    unproxiedNode: TreeNode,
    dependencies: Map<string, IActiveReactiveDependency>
) {
    if (!reactiveDependenciesMap) {
        reactiveDependenciesMap = new WeakMap();
    }
    return reactiveDependenciesMap.set(unproxiedNode, dependencies);
}

export function deleteReactiveDependencies(unproxiedNode: TreeNode) {
    if (!reactiveDependenciesMap) {
        reactiveDependenciesMap = new WeakMap();
        return;
    }
    reactiveDependenciesMap?.delete(unproxiedNode);
}

export function getReactiveDependents(
    unproxiedNode: TreeNode
): Map<TreeNode, IReactiveDependentGroup> | undefined {
    if (!reactiveDependentMap) {
        reactiveDependentMap = new WeakMap();
        return undefined;
    }
    return reactiveDependentMap?.get(unproxiedNode);
}

export function setReactiveDependents(
    unproxiedNode: TreeNode,
    dependent: IActiveReactiveDependency
) {
    if (!reactiveDependentMap) {
        reactiveDependentMap = new WeakMap();
    }
    let groups = reactiveDependentMap.get(unproxiedNode);
    if (groups === undefined) {
        groups = new Map();
        reactiveDependentMap.set(unproxiedNode, groups);
    }
    const group = groups.get(dependent.unproxiedReactiveNode);
    if (group === undefined) {
        groups.set(dependent.unproxiedReactiveNode, {
            reactiveNode: dependent.reactiveNode,
            dependentsByKey: new Map([[dependent.key, dependent]]),
        });
        return;
    }
    group.reactiveNode = dependent.reactiveNode;
    group.dependentsByKey.set(dependent.key, dependent);
}

export function deleteReactiveDependent(
    unproxiedDependentNode: TreeNode,
    unproxiedDependencyNode: TreeNode,
    dependencyKey?: string
) {
    if (!reactiveDependentMap) {
        reactiveDependentMap = new WeakMap();
        return;
    }
    const groups = reactiveDependentMap.get(unproxiedDependentNode);
    if (!groups) {
        return;
    }
    const group = groups.get(unproxiedDependencyNode);
    if (!group) {
        return;
    }
    if (dependencyKey !== undefined) {
        group.dependentsByKey.delete(dependencyKey);
        if (group.dependentsByKey.size > 0) {
            return;
        }
    }
    groups.delete(unproxiedDependencyNode);
    if (groups.size === 0) {
        reactiveDependentMap.delete(unproxiedDependentNode);
    }
}

export function retainReactiveDependencySubscription(
    unproxiedDependencyNode: TreeNode,
    subscribe: () => () => void
): () => void {
    if (!reactiveDependencySubscriptionMap) {
        reactiveDependencySubscriptionMap = new WeakMap();
    }

    const existing = reactiveDependencySubscriptionMap.get(
        unproxiedDependencyNode
    );
    if (existing !== undefined) {
        existing.referenceCount++;
        return () =>
            releaseReactiveDependencySubscription(unproxiedDependencyNode);
    }

    const unsubscribe = subscribe();
    reactiveDependencySubscriptionMap.set(unproxiedDependencyNode, {
        referenceCount: 1,
        unsubscribe,
    });
    return () => releaseReactiveDependencySubscription(unproxiedDependencyNode);
}

function releaseReactiveDependencySubscription(
    unproxiedDependencyNode: TreeNode
) {
    if (!reactiveDependencySubscriptionMap) {
        return;
    }

    const existing = reactiveDependencySubscriptionMap.get(
        unproxiedDependencyNode
    );
    if (existing === undefined) {
        return;
    }

    existing.referenceCount--;
    if (existing.referenceCount > 0) {
        return;
    }

    reactiveDependencySubscriptionMap.delete(unproxiedDependencyNode);
    existing.unsubscribe();
}
