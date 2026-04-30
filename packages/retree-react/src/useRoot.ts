/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

"use client";

import { Retree, TreeNode } from "@retreejs/core";
import { useRef } from "react";

/**
 * Create a Retree-managed root that survives React Strict Mode's
 * double-invocation of `useState`/`useMemo` initializers.
 * Use this in place of `useState(() => Retree.root(new Foo()))`.
 * Then pass into `useNode` or `useTree`.
 *
 * @remarks
 * Why: under Strict Mode, React invokes a `useState` lazy initializer twice
 * to detect impurity. `Retree.root(...)` mutates module-global state
 * (`reproxyMap`) keyed by raw object identity. When the constructor wraps
 * the same shared raw inputs (e.g., props passed from a parent) twice, the
 * second call overwrites entries the first instance depends on — and any
 * children parented to the first instance start reading stale state.
 *
 * `useRef` is the only React init primitive that is *not* double-invoked
 * across the function body's StrictMode re-renders within a single mount,
 * so a `useRef + null check` guard ensures the factory runs exactly once.
 *
 * @param factory function that returns a node wrapped in `Retree.root`.
 * @returns a root proxied node.
 */
export function useRoot<T extends TreeNode>(factory: () => T): T {
    const ref = useRef<T | null>(null);
    if (ref.current === null) {
        ref.current = Retree.root(factory());
    }
    return ref.current;
}
