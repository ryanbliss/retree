/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Retree } from "./Retree.js";
import {
    addRetreeDebugTap,
    getNamedRetreeRoots,
    getRetreeRootName,
} from "./internals/index.js";
import { TRetreeDebugTapEmission } from "./internals/debug-tap.js";
import { getCustomProxyHandler } from "./internals/proxy.js";

const rootsToCleanup: object[] = [];
const tapsToCleanup: (() => void)[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

function trackTap(removeTap: () => void): () => void {
    tapsToCleanup.push(removeTap);
    return removeTap;
}

afterEach(() => {
    for (const removeTap of tapsToCleanup.splice(0)) {
        removeTap();
    }
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    if (getCustomProxyHandler(node)) {
        Retree.clearListeners(node as never);
    }
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

function captureTap(): TRetreeDebugTapEmission[] {
    const emissions: TRetreeDebugTapEmission[] = [];
    trackTap(addRetreeDebugTap((emission) => emissions.push(emission)));
    return emissions;
}

describe("debug tap", () => {
    it("receives nodeChanged emissions with raw node and change records", () => {
        const root = trackRoot(Retree.root({ count: 0, child: { v: 0 } }));
        const emissions = captureTap();

        root.count = 1;
        root.child.v = 2;

        expect(emissions).toHaveLength(2);
        const first = emissions[0];
        const second = emissions[1];
        if (first?.kind !== "nodeChanged" || second?.kind !== "nodeChanged") {
            throw new Error("expected two nodeChanged emissions");
        }
        expect(first.node).toBe(Retree.raw(root));
        expect(first.changes).toEqual([
            { node: Retree.raw(root), key: "count", previous: 0, new: 1 },
        ]);
        expect(first.silent).toBe(false);
        expect(second.node).toBe(Retree.raw(root.child));
        expect(second.changes[0]?.key).toBe("v");
    });

    it("receives emissions without any Retree.on listeners registered", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const emissions = captureTap();

        root.count = 1;

        expect(emissions).toHaveLength(1);
    });

    it("reports the registered root name for changes anywhere in the tree", () => {
        const root = trackRoot(Retree.root({ child: { inner: { v: 0 } } }));
        Retree.registerRootName(root, "workspace");
        const emissions = captureTap();

        root.child.inner.v = 1;

        const emission = emissions[0];
        if (emission?.kind !== "nodeChanged") {
            throw new Error("expected a nodeChanged emission");
        }
        expect(emission.rootName).toBe("workspace");
        expect(emission.node).toBe(Retree.raw(root.child.inner));
    });

    it("reports rootName undefined for unnamed trees", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const emissions = captureTap();

        root.count = 1;

        const emission = emissions[0];
        if (emission?.kind !== "nodeChanged") {
            throw new Error("expected a nodeChanged emission");
        }
        expect(emission.rootName).toBeUndefined();
    });

    it("brackets an outermost transaction with boundary markers", () => {
        const root = trackRoot(Retree.root({ a: 0, b: 0 }));
        const emissions = captureTap();

        Retree.runTransaction(() => {
            root.a = 1;
            Retree.runTransaction(() => {
                root.b = 1;
            });
        });

        expect(emissions.map((emission) => emission.kind)).toEqual([
            "transactionStart",
            "nodeChanged",
            "nodeChanged",
            "transactionEnd",
        ]);
    });

    it("marks emissions inside runSilent windows as silent", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const emissions = captureTap();

        // skipReproxy=false: the emission happens with listeners suppressed.
        Retree.runSilent(() => {
            root.count = 1;
        }, false);
        root.count = 2;

        expect(emissions).toHaveLength(2);
        const silent = emissions[0];
        const loud = emissions[1];
        if (silent?.kind !== "nodeChanged" || loud?.kind !== "nodeChanged") {
            throw new Error("expected two nodeChanged emissions");
        }
        expect(silent.silent).toBe(true);
        expect(loud.silent).toBe(false);
    });

    it("receives nodeRemoved emissions", () => {
        const root = trackRoot(
            Retree.root({ child: { v: 0 } } as {
                child?: { v: number };
            })
        );
        const removedRaw = Retree.raw(root.child as { v: number });
        const emissions = captureTap();

        delete root.child;

        const kinds = emissions.map((emission) => emission.kind);
        expect(kinds).toContain("nodeRemoved");
        const removed = emissions.find(
            (emission) => emission.kind === "nodeRemoved"
        );
        if (removed?.kind !== "nodeRemoved") {
            throw new Error("expected a nodeRemoved emission");
        }
        expect(removed.node).toBe(removedRaw);
    });

    it("stops delivering after the tap is removed", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const emissions: TRetreeDebugTapEmission[] = [];
        const removeTap = addRetreeDebugTap((emission) =>
            emissions.push(emission)
        );

        root.count = 1;
        removeTap();
        root.count = 2;

        expect(emissions).toHaveLength(1);
        // Idempotent.
        removeTap();
    });
});

describe("named root registry", () => {
    it("resolves names by raw node and enumerates live named roots", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        Retree.registerRootName(root, "counter");

        expect(getRetreeRootName(Retree.raw(root))).toBe("counter");
        expect(getNamedRetreeRoots().get("counter")).toBe(Retree.raw(root));
    });

    it("re-registering a node replaces its previous name", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        Retree.registerRootName(root, "first");
        Retree.registerRootName(root, "second");

        expect(getRetreeRootName(Retree.raw(root))).toBe("second");
        expect(getNamedRetreeRoots().has("first")).toBe(false);
        expect(getNamedRetreeRoots().get("second")).toBe(Retree.raw(root));
    });

    it("throws pinpointed errors for invalid arguments", () => {
        expect(() => Retree.registerRootName({ plain: true }, "name")).toThrow(
            /Retree\.registerRootName: expected a Retree-managed node/
        );
        const root = trackRoot(Retree.root({ count: 0 }));
        expect(() => Retree.registerRootName(root, "")).toThrow(
            /Retree\.registerRootName: expected a non-empty string name/
        );
    });
});
