import { IReactiveDependency, ReactiveNode } from "../ReactiveNode";
import { TreeNode } from "../types";

export interface IActiveReactiveDependency extends IReactiveDependency {
    key: string;
    unsubscribeListener: (() => void) | undefined;
    unproxiedNode: TreeNode | undefined;
}

export interface IPreviousReactiveDependent {
    reactiveNode: ReactiveNode;
    unproxiedReactiveNode: TreeNode;
    comparisons?: any[];
    key: string;
}

let reactiveDependentMap:
    | WeakMap<TreeNode, IPreviousReactiveDependent[]>
    | undefined;

let reactiveDependenciesMap:
    | WeakMap<TreeNode, IActiveReactiveDependency[]>
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
): IActiveReactiveDependency[] | undefined {
    if (!reactiveDependenciesMap) {
        reactiveDependenciesMap = new WeakMap();
        return undefined;
    }
    return reactiveDependenciesMap.get(unproxiedNode);
}

export function setReactiveDependencies(
    unproxiedNode: TreeNode,
    dependencies: IActiveReactiveDependency[]
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
): IPreviousReactiveDependent[] | undefined {
    if (!reactiveDependentMap) {
        reactiveDependentMap = new WeakMap();
        return undefined;
    }
    return reactiveDependentMap?.get(unproxiedNode);
}

export function setReactiveDependents(
    unproxiedNode: TreeNode,
    dependent: IPreviousReactiveDependent
) {
    const reactiveDeps = getReactiveDependents(unproxiedNode);
    if (!reactiveDeps) {
        reactiveDependentMap?.set(unproxiedNode, [dependent]);
        return;
    }

    for (const existingDependent of reactiveDeps) {
        if (
            existingDependent.unproxiedReactiveNode ===
                dependent.unproxiedReactiveNode &&
            existingDependent.key === dependent.key
        ) {
            existingDependent.reactiveNode = dependent.reactiveNode;
            existingDependent.comparisons = dependent.comparisons;
            return;
        }
    }

    reactiveDeps.push(dependent);
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
    const dependents = reactiveDependentMap?.get(unproxiedDependentNode);
    if (!dependents) {
        return;
    }
    const newDependents = dependents.filter((dep) => {
        if (dep.unproxiedReactiveNode !== unproxiedDependencyNode) {
            return true;
        }
        if (dependencyKey === undefined) {
            return false;
        }
        return dep.key !== dependencyKey;
    });
    if (newDependents.length === 0) {
        reactiveDependentMap?.delete(unproxiedDependentNode);
        return;
    }
    reactiveDependentMap.set(unproxiedDependentNode, newDependents);
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
