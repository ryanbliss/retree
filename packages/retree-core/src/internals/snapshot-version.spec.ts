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
        // Any live listener opens the advancement gate; React's external
        // store always subscribes through Retree.on before observing writes.
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

        // Gate closed: writes skip the per-write ancestor walk and pend.
        // The next gated read settles them — two writes, one version.
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

        // Writes while subscribed advance per write.
        root.child.count = 3;
        expect(getNodeSnapshotVersion(root.child)).toBeGreaterThan(
            settledChildNode
        );
        unsubscribe();
    });

    it("bumps versions at reopen for reads that survived a closed window (open read → close → write → subscribe)", () => {
        const root = Retree.root({ count: 0 });

        // A component renders while the gate is open (another subscriber
        // exists) and reads a version...
        const outer = Retree.on(root, "nodeChanged", () => {});
        const renderRead = getNodeSnapshotVersion(root);

        // ...then every other subscriber unmounts (gate closes) and a write
        // lands before the component's own subscription commits.
        outer();
        root.count = 1;

        // The commit-time subscribe reopens the gate; its post-subscribe
        // snapshot check must observe the skipped write or the component is
        // permanently stale.
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root)).toBeGreaterThan(renderRead);
        unsubscribe();
    });

    it("bumps reported versions when a gated read precedes a skipped write (read → write → subscribe)", () => {
        const root = Retree.root({ count: 0 });
        // Open and close the gate once so flags from earlier tests are
        // consumed and this test starts from a clean closed gate.
        Retree.on(root, "nodeChanged", () => {})();

        // Pre-subscribe read while the gate is closed (uSES render read).
        const preWriteNode = getNodeSnapshotVersion(root);
        const preWriteTree = getTreeSnapshotVersion(root);

        // Skipped write after the gated read: the reader's version is stale.
        root.count = 1;

        // Subscribing opens the gate; the post-subscribe snapshot check must
        // observe a change for the write that happened after the read.
        const unsubscribe = Retree.on(root, "nodeChanged", () => {});
        expect(getNodeSnapshotVersion(root)).toBeGreaterThan(preWriteNode);
        expect(getTreeSnapshotVersion(root)).toBeGreaterThan(preWriteTree);
        unsubscribe();
    });

    it("keeps versions stable for a write-then-first-read-at-mount bootstrap (write → read → subscribe)", () => {
        const root = Retree.root({ count: 0 });
        // Open and close the gate once so flags from earlier tests are
        // consumed and this test starts from a clean closed gate.
        Retree.on(root, "nodeChanged", () => {})();

        // Populate before anything mounts: skipped write with no gated read
        // before it.
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

    it("does not jump versions when the gate reopens without skipped writes", () => {
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
