/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { Retree } from "../Retree";
import {
    getNodeSnapshotVersion,
    getTreeSnapshotVersion,
} from "./snapshot-version";
import { getReproxyNode } from "./reproxy";

describe("snapshot versions", () => {
    it("advances node and ancestor tree versions without listeners", () => {
        const root = Retree.root({ child: { count: 0 }, sibling: 0 });
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
