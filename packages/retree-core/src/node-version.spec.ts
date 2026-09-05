/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it } from "vitest";
import { Retree } from "./Retree.js";
import { getReproxyNode } from "./internals/reproxy.js";

interface IShape {
    child: { value: number };
    other: number;
}

function makeRoot() {
    return Retree.root<IShape>({ child: { value: 0 }, other: 0 });
}

describe("Retree.version", () => {
    it("advances on the node's own writes and treeVersion on descendant writes", () => {
        const root = makeRoot();
        const childVersion = Retree.version(root.child);
        const rootVersion = Retree.version(root);
        const rootTreeVersion = Retree.treeVersion(root);

        root.child.value = 1;
        expect(Retree.version(root.child)).toBeGreaterThan(childVersion);
        expect(Retree.version(root)).toBe(rootVersion);
        expect(Retree.treeVersion(root)).toBeGreaterThan(rootTreeVersion);

        const afterChild = Retree.version(root.child);
        root.other = 1;
        expect(Retree.version(root.child)).toBe(afterChild);
        expect(Retree.version(root)).toBeGreaterThan(rootVersion);
    });

    it("agrees with the view identity and accepts the raw object", () => {
        const root = makeRoot();
        const version = Retree.version(root.child);
        expect(Retree.version(Retree.raw(root.child))).toBe(version);
        const view = getReproxyNode(root.child);

        root.other = 1;
        expect(getReproxyNode(root.child)).toBe(view);
        expect(Retree.version(root.child)).toBe(version);

        root.child.value = 1;
        expect(getReproxyNode(root.child)).not.toBe(view);
        expect(Retree.version(root.child)).not.toBe(version);
        expect(Retree.version(view)).toBe(Retree.version(root.child));
    });

    it("follows runSilent's reproxy mode", () => {
        const root = makeRoot();
        const version = Retree.version(root.child);
        const treeVersion = Retree.treeVersion(root);
        Retree.runSilent(() => {
            root.child.value = 1;
        });
        expect(Retree.version(root.child)).toBe(version);
        expect(Retree.treeVersion(root)).toBe(treeVersion);
        Retree.runSilent(() => {
            root.child.value = 2;
        }, false);
        expect(Retree.version(root.child)).toBeGreaterThan(version);
        expect(Retree.treeVersion(root)).toBeGreaterThan(treeVersion);
    });

    it("throws for values that are not Retree nodes", () => {
        expect(() => Retree.version({})).toThrow(
            "Retree.version: expected a Retree-managed node or the raw object behind one, but the value has never been materialized as a Retree node."
        );
        expect(() => Retree.treeVersion(null as unknown as object)).toThrow(
            "Retree.treeVersion: expected a Retree-managed node or the raw object behind one but received a object."
        );
    });
});
