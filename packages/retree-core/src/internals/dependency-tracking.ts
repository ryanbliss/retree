import { IReactiveDependency } from "../ReactiveNode";
import { TreeNode } from "../types";
import {
    isCustomProxy,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types";

interface DependencyAccessFrame {
    entries: DependencyAccessEntry[];
}

type DependencyAccessEntry =
    | {
          kind: "dependency";
          value: unknown;
      }
    | {
          kind: "managed-value";
          value: TCustomProxy<TreeNode>;
          unproxiedNode: TreeNode;
      };

const dependencyAccessStack: DependencyAccessFrame[] = [];

export function collectDependencyAccesses<T>(callback: () => T): unknown[] {
    const frame: DependencyAccessFrame = { entries: [] };
    dependencyAccessStack.push(frame);
    try {
        callback();
    } finally {
        dependencyAccessStack.pop();
    }
    return frame.entries.map((entry) => entry.value);
}

export function trackDependencyAccess<T>(value: T): T {
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return value;
    }
    if (typeof value === "function") {
        return value;
    }
    if (isCustomProxy(value)) {
        currentFrame.entries.push({
            kind: "managed-value",
            value,
            unproxiedNode: value["[[Handler]]"][unproxiedBaseNodeKey],
        });
        return value;
    }
    currentFrame.entries.push({ kind: "dependency", value });
    return value;
}

export function trackDependencyOwnerAccess(value: unknown): void {
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return;
    }
    if (value === null || typeof value !== "object") {
        return;
    }
    currentFrame.entries.push({ kind: "dependency", value });
}

export function trackDependencyPropertyAccess<T>(
    owner: unknown,
    propertyKey: string | symbol,
    value: T
): T {
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return value;
    }
    if (typeof value === "function") {
        return value;
    }
    if (!isCustomProxy(owner)) {
        return trackDependencyAccess(value);
    }
    const ownerUnproxiedNode = owner["[[Handler]]"][unproxiedBaseNodeKey];
    removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode);
    currentFrame.entries.push({
        kind: "dependency",
        value: {
            node: owner,
            comparisons: [value],
        } satisfies IReactiveDependency,
    });
    if (isArrayElementRead(ownerUnproxiedNode, propertyKey)) {
        return value;
    }
    return trackDependencyAccess(value);
}

function isArrayElementRead(
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
) {
    if (!Array.isArray(ownerUnproxiedNode)) {
        return false;
    }
    if (typeof propertyKey !== "string") {
        return false;
    }
    const index = Number(propertyKey);
    if (!Number.isInteger(index)) {
        return false;
    }
    return index >= 0;
}

function removePendingManagedValueAccess(
    frame: DependencyAccessFrame,
    unproxiedNode: TreeNode
) {
    for (let index = frame.entries.length - 1; index >= 0; index--) {
        const entry = frame.entries[index];
        if (entry.kind !== "managed-value") {
            continue;
        }
        if (entry.unproxiedNode !== unproxiedNode) {
            continue;
        }
        frame.entries.splice(index, 1);
    }
}
