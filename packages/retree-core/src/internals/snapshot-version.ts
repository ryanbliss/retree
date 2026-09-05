/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
import { TreeNode } from "../types.js";
import {
    ICustomProxyHandler,
    getCustomProxyHandlerFromMetadata,
    proxiedParentKey,
    proxyTargetKey,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";

let version = 0;
let structureVersion = 0;
const roots = new WeakMap<
    ICustomProxyHandler,
    { epoch: number; root: ICustomProxyHandler }
>();
const dirtyRoots = new WeakMap<ICustomProxyHandler, Set<ICustomProxyHandler>>();
const PENDING_LIMIT = 10000;

function getHandler(node: TreeNode, api: string): ICustomProxyHandler {
    const initial = getCustomProxyHandlerFromMetadata(node);
    if (initial === undefined)
        throw new Error(`${api}: expected a Retree-managed node.`);
    let handler: ICustomProxyHandler = initial;
    while (
        handler[proxyTargetKey] !== undefined &&
        handler[proxyTargetKey] !== handler[unproxiedBaseNodeKey]
    ) {
        const base: ICustomProxyHandler | undefined =
            getCustomProxyHandlerFromMetadata(handler[proxyTargetKey]);
        if (base === undefined)
            throw new Error(`${api}: proxy target is missing Retree metadata.`);
        handler = base;
    }
    return handler;
}

function parentOf(
    handler: ICustomProxyHandler
): ICustomProxyHandler | undefined {
    const parent = handler[proxiedParentKey]?.proxyNode;
    return parent ? getHandler(parent, "snapshot parent") : undefined;
}

function rootOf(handler: ICustomProxyHandler): ICustomProxyHandler {
    const cached = roots.get(handler);
    if (cached?.epoch === structureVersion) return cached.root;
    const path: ICustomProxyHandler[] = [];
    let current = handler;
    while (true) {
        const entry = roots.get(current);
        if (entry?.epoch === structureVersion) {
            current = entry.root;
            break;
        }
        path.push(current);
        const parent = parentOf(current);
        if (parent === undefined) break;
        current = parent;
    }
    const entry = { epoch: structureVersion, root: current };
    for (const ancestor of path) roots.set(ancestor, entry);
    return current;
}

function nextVersion(): number {
    if (version >= Number.MAX_SAFE_INTEGER)
        throw new Error(
            "Retree snapshot version counter exhausted Number.MAX_SAFE_INTEGER."
        );
    return ++version;
}

function flush(root: ICustomProxyHandler): void {
    const dirty = dirtyRoots.get(root);
    if (dirty === undefined || dirty.size === 0) return;
    // One token for the flush lets shared ancestors stop the walk early.
    const next = nextVersion();
    for (const node of dirty) {
        let current: ICustomProxyHandler | undefined = node;
        while (current !== undefined) {
            const record = (current.snapshotVersionsRecord ??= {
                node: 0,
                tree: 0,
            });
            if (record.tree === next) break;
            record.tree = next;
            current = parentOf(current);
        }
    }
    dirty.clear();
}

/** Settle the old ancestry before changing a managed node's parent. */
export function prepareSnapshotParentChange(node: TreeNode): void {
    flush(rootOf(getHandler(node, "prepareSnapshotParentChange")));
    structureVersion++;
}

export function getStructureVersion(): number {
    return structureVersion;
}

export function getNodeSnapshotVersion(node: TreeNode): number {
    return (
        getHandler(node, "getNodeSnapshotVersion").snapshotVersionsRecord
            ?.node ?? 0
    );
}

export function getTreeSnapshotVersion(node: TreeNode): number {
    const handler = getHandler(node, "getTreeSnapshotVersion");
    flush(rootOf(handler));
    return handler.snapshotVersionsRecord?.tree ?? 0;
}

/** Direct versions advance on writes; only a tree snapshot read settles ancestors. */
export function advanceSnapshotVersions(node: TreeNode): void {
    const handler = getHandler(node, "advanceSnapshotVersions");
    const record = (handler.snapshotVersionsRecord ??= { node: 0, tree: 0 });
    record.node = nextVersion();
    const root = rootOf(handler);
    let dirty = dirtyRoots.get(root);
    if (dirty === undefined) {
        dirty = new Set();
        dirtyRoots.set(root, dirty);
    }
    dirty.add(handler);
    if (dirty.size >= PENDING_LIMIT) flush(root);
}
