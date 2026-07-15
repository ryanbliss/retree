/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types.js";
import {
    ICustomProxyHandler,
    ISnapshotVersionRecord,
    getCustomProxyHandlerFromMetadata,
    proxiedParentKey,
} from "./proxy-types.js";

let nextSnapshotVersion = 1;

/**
 * Gate for the per-write ancestor version walk. Versions only need to move
 * while something can observe them: the React external-store integration
 * subscribes through `Retree.on`, so Retree keeps this flag in sync with
 * "at least one live listener exists anywhere".
 */
let advancementActive = false;

/**
 * Nodes written while the gate was closed, awaiting a version flush.
 *
 * Correctness model: while nothing is subscribed, per-write version walks
 * are skipped and the written node is recorded here instead. The pending
 * set is flushed — every dirty node and its structural ancestors advance to
 * one shared fresh version — at the first moment a consumer could compare
 * versions across the skipped writes:
 *
 * - **Any version read while the gate is closed** (a mounting component's
 *   render read). A read after a skipped write therefore observes the
 *   post-write version, so the subscriber's post-subscribe snapshot check
 *   stays quiet and a "populate state, then mount" bootstrap renders exactly
 *   once. A read *before* the skipped write observes the pre-flush version,
 *   and the flush at reopen (below) makes the later check observe a change.
 * - **The gate reopening** (first new subscriber). This covers version reads
 *   taken while the gate was previously *open* that survived the closed
 *   window (e.g. a component that rendered before every other subscriber
 *   unmounted, and whose own subscription commits after the skipped write):
 *   the flush advances the written nodes past any previously handed-out
 *   version, so the post-subscribe check observes the skipped writes.
 *
 * The set holds raw nodes strongly only until the next flush. As an overflow
 * valve for pathological "write forever with no subscribers or reads"
 * workloads, the set is folded into {@link minimumReportedVersion} beyond
 * {@link PENDING_VERSION_FLUSH_LIMIT} entries, trading precision (readers
 * of unrelated nodes may observe one spurious version jump) for bounded
 * memory.
 */
const pendingSkippedWrites = new Set<TreeNode>();

/**
 * Overflow valve bound for {@link pendingSkippedWrites}. Beyond this many
 * distinct nodes written while gated, the pending set collapses into a
 * global floor bump instead of growing without bound.
 */
const PENDING_VERSION_FLUSH_LIMIT = 10_000;

/**
 * Minimum version reported by every read. Only raised by the
 * {@link pendingSkippedWrites} overflow valve; reads take
 * `max(record, floor)`, which stays monotonic because the floor only grows
 * and post-flush writes allocate versions above it.
 */
let minimumReportedVersion = 0;

/**
 * Enable/disable snapshot version advancement. Called by Retree whenever its
 * live listener count transitions between zero and non-zero.
 *
 * @internal
 */
export function setSnapshotVersionAdvancementActive(active: boolean): void {
    if (active === advancementActive) {
        return;
    }
    if (active) {
        // Flush before opening so the first subscriber's post-subscribe
        // snapshot check observes every write skipped during the closed
        // window (see pendingSkippedWrites).
        flushPendingSkippedWrites();
    }
    advancementActive = active;
}

function assertSnapshotVersionHeadroom(): void {
    if (nextSnapshotVersion >= Number.MAX_SAFE_INTEGER) {
        throw new Error(
            "Retree internal snapshot version counter exhausted Number.MAX_SAFE_INTEGER. This process has observed more Retree mutations than can be represented safely. Fix: restart the JavaScript process; if this occurs in a practical workload, file a Retree issue so snapshot tokens can move to a wider representation."
        );
    }
}

function flushPendingSkippedWrites(): void {
    if (pendingSkippedWrites.size === 0) {
        return;
    }
    assertSnapshotVersionHeadroom();
    const version = nextSnapshotVersion;
    nextSnapshotVersion += 1;
    for (const node of pendingSkippedWrites) {
        advanceVersionRecords(node, version);
    }
    pendingSkippedWrites.clear();
}

function getHandler(node: TreeNode, apiName: string): ICustomProxyHandler {
    const handler = getCustomProxyHandlerFromMetadata(node);
    if (handler === undefined) {
        throw new Error(
            `${apiName}: expected a Retree-managed node but received a value without Retree proxy metadata. This is an internal React integration error. Fix: pass the base proxy returned by getBaseProxy(...) and file a Retree issue if the caller already does so.`
        );
    }
    return handler;
}

function reportedVersion(version: number): number {
    if (version > minimumReportedVersion) {
        return version;
    }
    return minimumReportedVersion;
}

/**
 * Return the listener-independent version for changes owned by `node`.
 *
 * @internal
 */
export function getNodeSnapshotVersion(node: TreeNode): number {
    if (!advancementActive) {
        // A gated read is the comparison point a skipped write could go
        // stale against; settle pending writes first so this read observes
        // them (see pendingSkippedWrites).
        flushPendingSkippedWrites();
    }
    const record = getHandler(
        node,
        "getNodeSnapshotVersion"
    ).snapshotVersionsRecord;
    if (record === null) {
        return reportedVersion(0);
    }
    return reportedVersion(record.node);
}

/**
 * Return the listener-independent version for changes owned by `node` or any
 * structural descendant.
 *
 * @internal
 */
export function getTreeSnapshotVersion(node: TreeNode): number {
    if (!advancementActive) {
        // See getNodeSnapshotVersion: settle pending writes before reading.
        flushPendingSkippedWrites();
    }
    const record = getHandler(
        node,
        "getTreeSnapshotVersion"
    ).snapshotVersionsRecord;
    if (record === null) {
        return reportedVersion(0);
    }
    return reportedVersion(record.tree);
}

/**
 * Advance snapshot versions before Retree publishes a change notification.
 * The changed node receives a direct version and every structural ancestor
 * receives the same tree version. No ancestors are materialized or reproxied,
 * and no per-write records are allocated: each node's record is created once
 * and mutated in place afterwards.
 *
 * When nothing is subscribed anywhere (see
 * {@link setSnapshotVersionAdvancementActive}), the walk is skipped and the
 * node joins {@link pendingSkippedWrites}, which the next gated read or the
 * gate-open transition flushes.
 *
 * @internal
 */
export function advanceSnapshotVersions(node: TreeNode): void {
    if (!advancementActive) {
        if (pendingSkippedWrites.size >= PENDING_VERSION_FLUSH_LIMIT) {
            // Overflow valve: collapse the pending set into one global floor
            // bump instead of growing without bound (see
            // pendingSkippedWrites).
            assertSnapshotVersionHeadroom();
            minimumReportedVersion = nextSnapshotVersion;
            nextSnapshotVersion += 1;
            pendingSkippedWrites.clear();
        }
        pendingSkippedWrites.add(node);
        return;
    }
    assertSnapshotVersionHeadroom();

    const version = nextSnapshotVersion;
    nextSnapshotVersion += 1;
    advanceVersionRecords(node, version);
}

function advanceVersionRecords(node: TreeNode, version: number): void {
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

        const record: ISnapshotVersionRecord | null =
            handler.snapshotVersionsRecord;
        if (record === null) {
            handler.snapshotVersionsRecord = {
                node: isChangedNode ? version : 0,
                tree: version,
            };
        } else {
            record.tree = version;
            if (isChangedNode) {
                record.node = version;
            }
        }

        currentNode = handler[proxiedParentKey]?.proxyNode ?? null;
        isChangedNode = false;
    }
}
