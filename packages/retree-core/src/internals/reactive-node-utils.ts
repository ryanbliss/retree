import { IReactiveDependency, ReactiveNode } from "../ReactiveNode";
import { TreeNode } from "../types";
import { getUnproxiedNode } from "./proxy";

export interface IActiveReactiveDependency extends IReactiveDependency {
    unsubscribeListener: (() => void) | undefined;
}

export interface IPreviousReactiveDependent {
    reactiveNode: ReactiveNode;
    comparisons?: any[];
    index: number;
}

let reactiveDependentMap:
    | WeakMap<TreeNode, IPreviousReactiveDependent[]>
    | undefined;

let reactiveDependenciesMap:
    | WeakMap<TreeNode, IActiveReactiveDependency[]>
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
    const unproxy = getUnproxiedNode(dependent.reactiveNode);
    if (!unproxy) {
        throw new Error(
            "Unexpected no unproxy node for new dependent node being checked"
        );
    }
    const reactiveDeps = getReactiveDependents(unproxiedNode);
    if (!reactiveDeps) {
        reactiveDependentMap?.set(unproxiedNode, [dependent]);
        return;
    }
    let replacedExisting = false;
    const dependents = reactiveDeps.map((cDep) => {
        const cUnproxy = getUnproxiedNode(cDep.reactiveNode);
        if (!cUnproxy) {
            throw new Error(
                "Unexpected no unproxy node for the reactive node being checked"
            );
        }
        if (cUnproxy === unproxy) {
            replacedExisting = true;
            return dependent;
        }
        return cDep;
    });
    if (!replacedExisting) {
        dependents.push(dependent);
    }

    reactiveDependentMap?.set(unproxiedNode, dependents);
}

export function deleteReactiveDependent(
    unproxiedDependentNode: TreeNode,
    unproxiedDependencyNode: TreeNode
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
        const unproxiedDep = getUnproxiedNode(dep.reactiveNode);
        if (!unproxiedDep) {
            throw new Error(
                "Unexpected no unproxy node for the reactive node being checked"
            );
        }
        return unproxiedDep !== unproxiedDependencyNode;
    });
    if (newDependents.length === 0) {
        reactiveDependentMap?.delete(unproxiedDependentNode);
        return;
    }
    reactiveDependentMap.set(unproxiedDependentNode, newDependents);
}
