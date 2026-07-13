/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import {
    createRetreeCompositeExternalStore,
    getRetreeExternalStoreSource,
} from "./externalStore";

describe("Retree external-store adapter", () => {
    it("caches immutable snapshots until a listener-independent version changes", () => {
        const root = Retree.root({ count: 0 });
        const source = getRetreeExternalStoreSource(root, "nodeChanged");
        const store = createRetreeCompositeExternalStore([source]);

        const initial = store.getSnapshot();
        expect(store.getSnapshot()).toBe(initial);
        expect(Object.isFrozen(initial)).toBe(true);
        expect(Object.isFrozen(initial.sources)).toBe(true);
        expect(Object.isFrozen(initial.versions)).toBe(true);

        root.count = 1;

        const changed = store.getSnapshot();
        expect(changed).not.toBe(initial);
        expect(store.getSnapshot()).toBe(changed);
        expect(changed.versions[0]).toBeGreaterThan(initial.versions[0]);
    });
});
