import { IReactiveDependency } from "../ReactiveNode";
import { TreeNode } from "../types";
import {
    isCustomProxy,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types";

interface DependencyAccessFrame {
    entries: DependencyAccessEntry[];
    mode: "dependencies" | "comparisons";
    writes: DependencyPropertyWrite[];
}

interface DependencyPropertyWrite {
    ownerUnproxiedNode: TreeNode;
    propertyKey: string | symbol;
}

export interface DependencyComparisonAccessor {
    readonly kind: "retree-dependency-comparison-accessor";
    getValues(): unknown[];
}

type DependencyAccessEntry =
    | {
          kind: "dependency";
          value: unknown;
          comparisonAccessor?: DependencyComparisonAccessor;
          ownerUnproxiedNode?: TreeNode;
          propertyKey?: string | symbol;
          valueUnproxiedNode?: TreeNode;
      }
    | {
          kind: "managed-value";
          value: TCustomProxy<TreeNode>;
          unproxiedNode: TreeNode;
      };

const dependencyAccessStack: DependencyAccessFrame[] = [];
let pauseDependencyTrackingDepth = 0;

export function runWithoutDependencyTracking<T>(callback: () => T): T {
    pauseDependencyTrackingDepth++;
    try {
        return callback();
    } finally {
        pauseDependencyTrackingDepth--;
    }
}

export function runWithIsolatedDependencyTracking<T>(callback: () => T): T {
    const outerFrames = dependencyAccessStack.splice(
        0,
        dependencyAccessStack.length
    );
    try {
        return callback();
    } finally {
        dependencyAccessStack.splice(0, 0, ...outerFrames);
    }
}

export function collectDependencyAccesses<T>(callback: () => T): unknown[] {
    const frame: DependencyAccessFrame = {
        entries: [],
        mode: "dependencies",
        writes: [],
    };
    dependencyAccessStack.push(frame);
    try {
        callback();
    } finally {
        dependencyAccessStack.pop();
    }
    return frame.entries.map((entry) => entry.value);
}

export function collectDependencyComparisonAccesses<T>(callback: () => T): {
    value: T;
    comparisons: unknown[];
} {
    let value: T | undefined;
    const frame: DependencyAccessFrame = {
        entries: [],
        mode: "comparisons",
        writes: [],
    };
    dependencyAccessStack.push(frame);
    try {
        value = callback();
    } finally {
        dependencyAccessStack.pop();
    }
    return {
        value: value as T,
        comparisons: frame.entries.flatMap((entry) => {
            if (isWrittenPropertyEntry(frame, entry)) {
                return [];
            }
            if (entry.kind === "managed-value") {
                return [createComparisonAccessor(() => [entry.value])];
            }
            if (entry.comparisonAccessor !== undefined) {
                return [entry.comparisonAccessor];
            }
            return [entry.value];
        }),
    };
}

export function trackDependencyAccess<T>(value: T): T {
    if (pauseDependencyTrackingDepth > 0) {
        return value;
    }
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
    if (pauseDependencyTrackingDepth > 0) {
        return;
    }
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
    if (pauseDependencyTrackingDepth > 0) {
        return value;
    }
    if (isRetreeInternalProperty(propertyKey)) {
        return value;
    }
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
    if (currentFrame.mode === "comparisons") {
        removePendingPropertyValueAccess(currentFrame, ownerUnproxiedNode);
    }
    const valueUnproxiedNode = isCustomProxy(value)
        ? value["[[Handler]]"][unproxiedBaseNodeKey]
        : undefined;
    currentFrame.entries.push({
        kind: "dependency",
        value: {
            node: owner,
            comparisons: [value],
        } satisfies IReactiveDependency,
        comparisonAccessor: createComparisonAccessor(() => [
            Reflect.get(owner, propertyKey),
        ]),
        ownerUnproxiedNode,
        propertyKey,
        valueUnproxiedNode,
    });
    if (isArrayElementRead(ownerUnproxiedNode, propertyKey)) {
        return value;
    }
    if (currentFrame.mode === "comparisons") {
        return value;
    }
    return trackDependencyAccess(value);
}

export function trackDependencyPropertyWrite(
    owner: unknown,
    propertyKey: string | symbol
): void {
    if (pauseDependencyTrackingDepth > 0) {
        return;
    }
    if (isRetreeInternalProperty(propertyKey)) {
        return;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return;
    }
    if (!isCustomProxy(owner)) {
        return;
    }
    const ownerUnproxiedNode = owner["[[Handler]]"][unproxiedBaseNodeKey];
    currentFrame.writes.push({ ownerUnproxiedNode, propertyKey });
    removePendingPropertyAccess(currentFrame, ownerUnproxiedNode, propertyKey);
}

function isRetreeInternalProperty(propertyKey: string | symbol): boolean {
    if (typeof propertyKey !== "string") {
        return false;
    }
    return propertyKey.startsWith("RETREE_");
}

function createComparisonAccessor(
    getValues: () => unknown[]
): DependencyComparisonAccessor {
    return {
        kind: "retree-dependency-comparison-accessor",
        getValues,
    };
}

function removePendingPropertyAccess(
    frame: DependencyAccessFrame,
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
) {
    for (let index = frame.entries.length - 1; index >= 0; index--) {
        const entry = frame.entries[index];
        if (entry.kind !== "dependency") {
            continue;
        }
        if (entry.ownerUnproxiedNode !== ownerUnproxiedNode) {
            continue;
        }
        if (entry.propertyKey !== propertyKey) {
            continue;
        }
        frame.entries.splice(index, 1);
    }
}

function isWrittenPropertyEntry(
    frame: DependencyAccessFrame,
    entry: DependencyAccessEntry
): boolean {
    if (entry.kind !== "dependency") {
        return false;
    }
    if (entry.ownerUnproxiedNode === undefined) {
        return false;
    }
    if (entry.propertyKey === undefined) {
        return false;
    }
    return frame.writes.some((write) => {
        if (write.ownerUnproxiedNode !== entry.ownerUnproxiedNode) {
            return false;
        }
        return write.propertyKey === entry.propertyKey;
    });
}

function removePendingPropertyValueAccess(
    frame: DependencyAccessFrame,
    valueUnproxiedNode: TreeNode
) {
    for (let index = frame.entries.length - 1; index >= 0; index--) {
        const entry = frame.entries[index];
        if (entry.kind !== "dependency") {
            continue;
        }
        if (entry.valueUnproxiedNode !== valueUnproxiedNode) {
            continue;
        }
        frame.entries.splice(index, 1);
    }
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
