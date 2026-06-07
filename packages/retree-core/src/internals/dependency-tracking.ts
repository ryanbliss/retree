import { IReactiveDependency, ReactiveNode } from "../ReactiveNode";
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
    readonly dependencyNode?: TreeNode;
    readonly sourceUnproxiedNode?: TreeNode;
    getValues(): unknown[];
}

type DependencyAccessEntry =
    | {
          kind: "dependency";
          value: unknown;
          comparisonAccessor?: DependencyComparisonAccessor;
          ownerUnproxiedNode?: TreeNode;
          propertyKey?: string | symbol;
          isArrayElementRead?: boolean;
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

export function isDependencyTrackingActive(): boolean {
    if (pauseDependencyTrackingDepth > 0) {
        return false;
    }
    return dependencyAccessStack.length > 0;
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
    const dependencies: unknown[] = [];
    for (const entry of frame.entries) {
        dependencies.push(entry.value);
    }
    return dependencies;
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
    const comparisons: unknown[] = [];
    for (const entry of frame.entries) {
        if (isWrittenPropertyEntry(frame, entry)) {
            continue;
        }
        if (entry.kind === "managed-value") {
            comparisons.push(
                createComparisonAccessor(
                    () => [entry.value],
                    entry.value,
                    entry.unproxiedNode
                )
            );
            continue;
        }
        if (entry.comparisonAccessor !== undefined) {
            comparisons.push(entry.comparisonAccessor);
            continue;
        }
        comparisons.push(entry.value);
    }
    return {
        value: value as T,
        comparisons,
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
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return value;
    }
    if (isRetreeInternalProperty(propertyKey)) {
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
    const arrayElementRead = isArrayElementRead(
        ownerUnproxiedNode,
        propertyKey
    );
    const comparisonValue = arrayElementRead
        ? getArrayElementComparisonValue(value)
        : value;
    currentFrame.entries.push({
        kind: "dependency",
        value: {
            node: owner,
            comparisons: [comparisonValue],
        } satisfies IReactiveDependency,
        comparisonAccessor: createComparisonAccessor(
            () => [
                arrayElementRead
                    ? getArrayElementComparisonValue(
                          Reflect.get(owner, propertyKey)
                      )
                    : Reflect.get(owner, propertyKey),
            ],
            owner,
            getComparisonAccessorSource(ownerUnproxiedNode, propertyKey)
        ),
        ownerUnproxiedNode,
        propertyKey,
        isArrayElementRead: arrayElementRead,
        valueUnproxiedNode,
    });
    if (arrayElementRead) {
        return value;
    }
    if (currentFrame.mode === "comparisons") {
        return value;
    }
    return trackDependencyAccess(value);
}

export function replayDependencyComparisonAccesses(
    comparisons: unknown[],
    comparisonValues?: readonly (readonly unknown[])[]
): void {
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined || currentFrame.mode !== "dependencies") {
        return;
    }
    for (let index = 0; index < comparisons.length; index++) {
        const comparison = comparisons[index];
        if (!isDependencyComparisonAccessor(comparison)) {
            continue;
        }
        const dependencyNode = comparison.dependencyNode;
        if (dependencyNode === undefined) {
            continue;
        }
        // Cached trapped memos can already know the current comparison cells
        // from their validation pass. Reusing those cells keeps nested @select
        // collection from re-running expensive property accessors a second time.
        currentFrame.entries.push({
            kind: "dependency",
            value: {
                node: dependencyNode,
                comparisons: [
                    ...(comparisonValues?.[index] ?? comparison.getValues()),
                ],
            } satisfies IReactiveDependency,
        });
    }
}

export function trackDependencyPropertyWrite(
    owner: unknown,
    propertyKey: string | symbol
): void {
    if (pauseDependencyTrackingDepth > 0) {
        return;
    }
    const currentFrame =
        dependencyAccessStack[dependencyAccessStack.length - 1];
    if (currentFrame === undefined) {
        return;
    }
    if (isRetreeInternalProperty(propertyKey)) {
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
    getValues: () => unknown[],
    dependencyNode?: TreeNode,
    sourceUnproxiedNode?: TreeNode
): DependencyComparisonAccessor {
    return {
        kind: "retree-dependency-comparison-accessor",
        dependencyNode,
        sourceUnproxiedNode,
        getValues,
    };
}

function isDependencyComparisonAccessor(
    value: unknown
): value is DependencyComparisonAccessor {
    if (value === null || typeof value !== "object") {
        return false;
    }
    if (!("kind" in value)) {
        return false;
    }
    return value.kind === "retree-dependency-comparison-accessor";
}

function getComparisonAccessorSource(
    ownerUnproxiedNode: TreeNode,
    propertyKey: string | symbol
): TreeNode | undefined {
    if (ownerUnproxiedNode instanceof ReactiveNode) {
        return undefined;
    }
    return ownerUnproxiedNode;
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
        if (entry.isArrayElementRead) {
            continue;
        }
        if (entry.valueUnproxiedNode !== valueUnproxiedNode) {
            continue;
        }
        frame.entries.splice(index, 1);
    }
}

function getArrayElementComparisonValue(value: unknown): unknown {
    if (!isCustomProxy(value)) {
        return value;
    }
    return value["[[Handler]]"][unproxiedBaseNodeKey];
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
