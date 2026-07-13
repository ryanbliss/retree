/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import {
    ICustomProxyHandler,
    IProxyParent,
    getCustomProxyHandlerFromMetadata,
    proxiedParentKey,
    unproxiedBaseNodeKey,
} from "./proxy-types";

interface SnapshotVersions {
    node: number;
    tree: number;
}

const snapshotVersions = new WeakMap<TreeNode, SnapshotVersions>();
let nextSnapshotVersion = 1;

function getRawNode(node: TreeNode, apiName: string): TreeNode {
    const handler = getCustomProxyHandlerFromMetadata(node);
    if (handler === undefined) {
        throw new Error(
            `${apiName}: expected a Retree-managed node but received a value without Retree proxy metadata. This is an internal React integration error. Fix: pass the base proxy returned by getBaseProxy(...) and file a Retree issue if the caller already does so.`
        );
    }
    return handler[unproxiedBaseNodeKey];
}

function getVersions(rawNode: TreeNode): SnapshotVersions {
    return snapshotVersions.get(rawNode) ?? { node: 0, tree: 0 };
}

/**
 * Return the listener-independent version for changes owned by `node`.
 *
 * @internal
 */
export function getNodeSnapshotVersion(node: TreeNode): number {
    return getVersions(getRawNode(node, "getNodeSnapshotVersion")).node;
}

/**
 * Return the listener-independent version for changes to `node` or any
 * structural descendant.
 *
 * @internal
 */
export function getTreeSnapshotVersion(node: TreeNode): number {
    return getVersions(getRawNode(node, "getTreeSnapshotVersion")).tree;
}

/**
 * Advance snapshot versions before Retree publishes a change notification.
 * The changed node receives a direct version and every structural ancestor
 * receives the same tree version. No ancestors are materialized or reproxied.
 *
 * @internal
 */
export function advanceSnapshotVersions(node: TreeNode): void {
    if (nextSnapshotVersion >= Number.MAX_SAFE_INTEGER) {
        throw new Error(
            "Retree internal snapshot version counter exhausted Number.MAX_SAFE_INTEGER. This process has observed more Retree mutations than can be represented safely. Fix: restart the JavaScript process; if this occurs in a practical workload, file a Retree issue so snapshot tokens can move to a wider representation."
        );
    }

    const version = nextSnapshotVersion;
    nextSnapshotVersion += 1;

    let currentNode: TreeNode | null = node;
    let isChangedNode = true;
    while (currentNode !== null) {
        const handler: ICustomProxyHandler<TreeNode> | undefined =
            getCustomProxyHandlerFromMetadata<TreeNode>(currentNode);
        if (handler === undefined) {
            throw new Error(
                "Retree internal snapshot version propagation found a structural parent without Retree proxy metadata. This is unexpected and likely a Retree bug. Fix: file an issue with the mutation and any preceding move, link, or collection operation."
            );
        }

        const rawNode = handler[unproxiedBaseNodeKey];
        const previous = getVersions(rawNode);
        snapshotVersions.set(rawNode, {
            node: isChangedNode ? version : previous.node,
            tree: version,
        });

        const parent: IProxyParent | null = handler[proxiedParentKey];
        currentNode = parent?.proxyNode ?? null;
        isChangedNode = false;
    }
}
