/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { Retree } from "../Retree.js";
import {
    getNodeSnapshotVersion,
    getTreeSnapshotVersion,
} from "./snapshot-version.js";
import { getCustomProxyHandler } from "./proxy.js";
import { proxiedParentKey } from "./proxy-types.js";
import { getReproxyNode } from "./reproxy.js";

describe("snapshot versions", () => {
    it("does no warm ancestor work for writes under unrelated node and tree listeners", () => {
        const root = Retree.root({ child: { count: 0 } });
        const unrelated = Retree.root({ count: 0 });
        const offNode = Retree.on(unrelated, "nodeChanged", () => {});
        const offTree = Retree.on(unrelated, "treeChanged", () => {});
        const child = root.child;
        child.count++;
        getTreeSnapshotVersion(root);
        const handler = getCustomProxyHandler(root)!;
        const parent = handler[proxiedParentKey];
        const readParent = vi.fn(() => parent);
        Object.defineProperty(handler, proxiedParentKey, {
            configurable: true,
            get: readParent,
        });
        for (let index = 0; index < 1000; index++) child.count++;
        getNodeSnapshotVersion(child);
        getTreeSnapshotVersion(unrelated);
        expect(readParent).not.toHaveBeenCalled();
        getTreeSnapshotVersion(root);
        expect(readParent).toHaveBeenCalledTimes(1);
        Object.defineProperty(handler, proxiedParentKey, {
            configurable: true,
            writable: true,
            value: parent,
        });
        offNode();
        offTree();
    });

    it("settles pending old ancestry before moving and detaching a subtree", () => {
        const left = Retree.root({ list: [{ child: { count: 0 } }] });
        const right = Retree.root({
            list: [] as { child: { count: number } }[],
        });
        const moved = left.list[0];
        const child = moved.child;
        const before = getTreeSnapshotVersion(left);
        child.count++;
        Retree.move(moved, right.list);
        expect(getTreeSnapshotVersion(left)).toBeGreaterThan(before);
        const leftAfterMove = getTreeSnapshotVersion(left);
        const rightAfterMove = getTreeSnapshotVersion(right);
        child.count++;
        expect(getTreeSnapshotVersion(right)).toBeGreaterThan(rightAfterMove);
        expect(getTreeSnapshotVersion(left)).toBe(leftAfterMove);
        right.list.pop();
        const rightAfterDetach = getTreeSnapshotVersion(right);
        child.count++;
        expect(getTreeSnapshotVersion(right)).toBe(rightAfterDetach);
        expect(getTreeSnapshotVersion(moved)).toBeGreaterThan(rightAfterDetach);
    });

    it("refreshes cached ancestor observation after listener changes", () => {
        const root = Retree.root({ child: { count: 0 } });
        const other = Retree.root({ count: 0 });
        const stopOther = Retree.on(other, "treeChanged", () => {});
        root.child.count++;
        const callback = vi.fn();
        const stop = Retree.on(root, "treeChanged", callback);
        root.child.count++;
        expect(callback).toHaveBeenCalledTimes(1);
        stop();
        root.child.count++;
        expect(callback).toHaveBeenCalledTimes(1);
        stopOther();
    });

    it("advances node and ancestor tree versions while a listener exists", () => {
        const root = Retree.root({ child: { count: 0 }, sibling: 0 });
        // Snapshot reads work independently of the subscription lifecycle.
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        const initialRootNode = getNodeSnapshotVersion(root);
        const initialRootTree = getTreeSnapshotVersion(root);
        const initialChildNode = getNodeSnapshotVersion(root.child);
        const initialChildTree = getTreeSnapshotVersion(root.child);

        root.child.count = 1;

        expect(getNodeSnapshotVersion(root.child)).toBeGreaterThan(
            initialChildNode
        );
        expect(getTreeSnapshotVersion(root.child)).toBeGreaterThan(
            initialChildTree
        );
        expect(getTreeSnapshotVersion(root)).toBeGreaterThan(initialRootTree);
        expect(getNodeSnapshotVersion(root)).toBe(initialRootNode);
        unsubscribe();
    });

    it("settles ancestor versions on tree reads without changing direct node snapshots", () => {
        const root = Retree.root({ child: { count: 0 } });
        const initialChildNode = getNodeSnapshotVersion(root.child);
        const initialRootTree = getTreeSnapshotVersion(root);

        // Direct versions advance now; the tree read settles their ancestry.
        root.child.count = 1;
        root.child.count = 2;
        const settledChildNode = getNodeSnapshotVersion(root.child);
        const settledRootTree = getTreeSnapshotVersion(root);
        expect(settledChildNode).toBeGreaterThan(initialChildNode);
        expect(settledRootTree).toBeGreaterThan(initialRootTree);

        // Bootstrap guarantee: subscribing after the settling read must not
        // jump versions again (no wasted second render).
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root.child)).toBe(settledChildNode);
        expect(getTreeSnapshotVersion(root)).toBe(settledRootTree);

        // A subsequent write advances the direct version again.
        root.child.count = 3;
        expect(getNodeSnapshotVersion(root.child)).toBeGreaterThan(
            settledChildNode
        );
        unsubscribe();
    });

    it("preserves reads across unsubscribe, write, and subscribe", () => {
        const root = Retree.root({ count: 0 });

        // A component reads while another subscription exists.
        const outer = Retree.on(root, "nodeChanged", () => {});
        const renderRead = getNodeSnapshotVersion(root);

        // The other subscription closes before a write and this commit.
        outer();
        root.count = 1;

        // The post-subscribe check must observe the intervening write.
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root)).toBeGreaterThan(renderRead);
        unsubscribe();
    });

    it("detects writes between snapshot read and subscription", () => {
        const root = Retree.root({ count: 0 });
        // The external store reads before subscribing.
        const preWriteNode = getNodeSnapshotVersion(root);
        const preWriteTree = getTreeSnapshotVersion(root);

        // A write after that read makes its snapshot stale.
        root.count = 1;

        // Subscribing must preserve the detectable change.
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root)).toBeGreaterThan(preWriteNode);
        expect(getTreeSnapshotVersion(root)).toBeGreaterThan(preWriteTree);
        unsubscribe();
    });

    it("keeps versions stable for a write-then-first-read-at-mount bootstrap (write → read → subscribe)", () => {
        const root = Retree.root({ count: 0 });
        // Populate before the first render read.
        root.count = 1;

        // Mount: the render read happens before the subscription (uSES), and
        // it already observes post-write data.
        const mountNode = getNodeSnapshotVersion(root);
        const mountTree = getTreeSnapshotVersion(root);

        // Subscribing must not jump the reported versions, or the
        // post-subscribe snapshot check would force a wasted second render.
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root)).toBe(mountNode);
        expect(getTreeSnapshotVersion(root)).toBe(mountTree);
        unsubscribe();
    });

    it("does not change snapshots on resubscription without writes", () => {
        const root = Retree.root({ count: 0 });
        const first = Retree.on(root, "nodeChanged", () => {});
        root.count = 1;
        const versionWhileSubscribed = getNodeSnapshotVersion(root);
        first();

        // No writes while unsubscribed: resubscribing must not report a
        // spurious change.
        const second = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root)).toBe(versionWhileSubscribed);
        second();
    });

    it("does not emit or reproxy ancestors while advancing tree versions", () => {
        const root = Retree.root({ child: { count: 0 } });
        const rootNodeChanged = vi.fn();
        const unsubscribe = Retree.on(root, "nodeChanged", rootNodeChanged);
        const rootBefore = getReproxyNode(root);

        root.child.count = 1;

        expect(rootNodeChanged).not.toHaveBeenCalled();
        expect(getReproxyNode(root)).toBe(rootBefore);
        unsubscribe();
    });

    it("respects both runSilent reproxy modes", () => {
        const root = Retree.root({ count: 0 });
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        const initialNode = getNodeSnapshotVersion(root);
        const initialTree = getTreeSnapshotVersion(root);

        Retree.runSilent(() => {
            root.count = 1;
        });

        expect(getNodeSnapshotVersion(root)).toBe(initialNode);
        expect(getTreeSnapshotVersion(root)).toBe(initialTree);

        Retree.runSilent(() => {
            root.count = 2;
        }, false);

        expect(getNodeSnapshotVersion(root)).toBeGreaterThan(initialNode);
        expect(getTreeSnapshotVersion(root)).toBeGreaterThan(initialTree);
        unsubscribe();
    });

    it("rejects values without Retree proxy metadata", () => {
        expect(() => getNodeSnapshotVersion({})).toThrow(
            "getNodeSnapshotVersion: expected a Retree-managed node"
        );
        expect(() => getTreeSnapshotVersion({})).toThrow(
            "getTreeSnapshotVersion: expected a Retree-managed node"
        );
    });
});
