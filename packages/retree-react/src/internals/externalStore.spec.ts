/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import {
    createRetreeCompositeExternalStore,
    getRetreeExternalStoreSource,
    RetreeExternalStoreSource,
    useRetreeCompositeExternalStore,
} from "./externalStore.js";

describe("Retree external-store adapter", () => {
    it("caches immutable snapshots until a listener-independent version changes", () => {
        const root = Retree.root({ count: 0 });
        const source = getRetreeExternalStoreSource(root, "nodeChanged");
        const store = createRetreeCompositeExternalStore([source]);
        // Versions only advance while a subscriber exists (core gates the
        // per-write ancestor version walk); subscribe first, as React does.
        const unsubscribe = store.subscribe(() => {});

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
        unsubscribe();
    });

    it("returns identical snapshot and versions references across calls with no writes", () => {
        const root = Retree.root({ first: { v: 0 }, second: { v: 0 } });
        const store = createRetreeCompositeExternalStore([
            getRetreeExternalStoreSource(root.first, "nodeChanged"),
            getRetreeExternalStoreSource(root.second, "nodeChanged"),
        ]);

        const first = store.getSnapshot();
        const second = store.getSnapshot();
        expect(second).toBe(first);
        expect(second.versions).toBe(first.versions);
        expect(second.sources).toBe(first.sources);
    });

    it("reuses the composite store across re-renders for equal source lists", () => {
        const root = Retree.root({ count: 0 });
        const source = getRetreeExternalStoreSource(root, "nodeChanged");
        const { result, rerender } = renderHook(() =>
            // A fresh array identity every render, with equal entries.
            useRetreeCompositeExternalStore([source])
        );

        const initialStore = result.current;
        rerender();
        expect(result.current).toBe(initialStore);
    });

    it("creates a new composite store when the source list changes", () => {
        const root = Retree.root({ first: { v: 0 }, second: { v: 0 } });
        const firstSource = getRetreeExternalStoreSource(
            root.first,
            "nodeChanged"
        );
        const secondSource = getRetreeExternalStoreSource(
            root.second,
            "nodeChanged"
        );
        const { result, rerender } = renderHook(
            ({ sources }: { sources: RetreeExternalStoreSource[] }) =>
                useRetreeCompositeExternalStore(sources),
            { initialProps: { sources: [firstSource] } }
        );

        const initialStore = result.current;
        rerender({ sources: [firstSource, secondSource] });
        expect(result.current).not.toBe(initialStore);

        // An equal-but-new list after commit reuses the second store.
        const widenedStore = result.current;
        rerender({ sources: [firstSource, secondSource] });
        expect(result.current).toBe(widenedStore);
    });
});
