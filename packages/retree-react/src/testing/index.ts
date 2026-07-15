/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

"use client";

/**
 * Test-only utilities for `@retreejs/react`, published as the
 * `@retreejs/react/testing` subpath so the main entry stays free of
 * test-only code. Import from `@retreejs/react/testing` in specs only.
 */

import { Retree, TreeNode } from "@retreejs/core";
import * as React from "react";

/**
 * A Retree root created for one test, paired with a `cleanup` that removes
 * every listener the test (or the components it rendered) left behind.
 */
export interface RetreeTestRoot<T extends TreeNode> {
    /** The Retree-managed root node under test. */
    readonly root: T;
    /**
     * Clears all listeners on the root and every descendant node
     * (`Retree.clearListeners(root, false)`). Safe to call more than once;
     * calls after the first are no-ops.
     */
    cleanup(): void;
}

/**
 * Create a Retree root for a test together with a listener-clearing
 * `cleanup`.
 *
 * @remarks
 * Retree's listener registries outlive a test unless every subscription is
 * unsubscribed, so a test that renders components (or calls `Retree.on` /
 * `Retree.select`) without tearing them down leaks listeners into the next
 * test. `cleanup` runs `Retree.clearListeners(root, false)`, clearing the
 * root and its entire subtree in one call.
 *
 * Register `cleanup` with your runner's `afterEach` for automatic teardown —
 * the vitest and jest APIs are identical here:
 *
 * ```ts
 * import { afterEach } from "vitest"; // or from "@jest/globals"
 * import { createTestRoot } from "@retreejs/react/testing";
 *
 * const cleanups: Array<() => void> = [];
 * afterEach(() => {
 *     for (const cleanup of cleanups.splice(0)) cleanup();
 * });
 *
 * function makeRoot() {
 *     const testRoot = createTestRoot(() => ({ count: 0 }));
 *     cleanups.push(testRoot.cleanup);
 *     return testRoot.root;
 * }
 * ```
 *
 * @param factory Function returning the plain object (or class instance) to
 * wrap; the result is passed through `Retree.root`. A factory that already
 * returns a `Retree.root(...)` result also works — rooting is idempotent for
 * an already-managed node.
 * @returns A {@link RetreeTestRoot} with the managed `root` and its
 * `cleanup`.
 *
 * @example
 * ```ts
 * import { render, screen } from "@testing-library/react";
 * import { actOnRetree, createTestRoot } from "@retreejs/react/testing";
 *
 * it("re-renders on a write", () => {
 *     const { root, cleanup } = createTestRoot(() => ({ count: 0 }));
 *     try {
 *         render(<Counter counter={root} />);
 *         actOnRetree(() => {
 *             root.count += 1;
 *         });
 *         expect(screen.getByRole("button").textContent).toBe("1");
 *     } finally {
 *         cleanup();
 *     }
 * });
 * ```
 */
export function createTestRoot<T extends TreeNode>(
    factory: () => T
): RetreeTestRoot<T> {
    const root = Retree.root(factory());
    let cleaned = false;
    return {
        root,
        cleanup() {
            if (cleaned) {
                return;
            }
            cleaned = true;
            Retree.clearListeners(root, false);
        },
    };
}

type ReactActCallback = () => void | Promise<void>;

function resolveReactAct(): (
    callback: ReactActCallback
) => void | Promise<void> {
    // Accessed through the namespace (not a named import) so loading this
    // module never throws on React versions that predate the `act` export.
    const act = React.act;
    if (typeof act !== "function") {
        throw new Error(
            "actOnRetree: the installed react package does not export act (added in react 18.3.0). Fix: upgrade react in your test environment to >=18.3.0, or wrap the write in the act export of your test renderer (for example `act` from @testing-library/react)."
        );
    }
    return act;
}

const ACT_ENVIRONMENT_FLAG = "IS_REACT_ACT_ENVIRONMENT";

/**
 * React's `act` warns unless `globalThis.IS_REACT_ACT_ENVIRONMENT` is `true`
 * at flush time. Test renderers set it around their own `act` wrappers (for
 * example `@testing-library/react`), so `actOnRetree` does the same: set it
 * for the duration of the call and restore the previous value after.
 * `Reflect` keeps the untyped global access out of the type system instead
 * of asserting a global type augmentation onto consumers.
 */
function setActEnvironmentFlag(value: unknown): unknown {
    const previous: unknown = Reflect.get(globalThis, ACT_ENVIRONMENT_FLAG);
    Reflect.set(globalThis, ACT_ENVIRONMENT_FLAG, value);
    return previous;
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
    if (typeof value !== "object") {
        return false;
    }
    if (value === null) {
        return false;
    }
    return "then" in value && typeof value.then === "function";
}

/**
 * Run Retree writes wrapped in React's `act`, so every re-render the writes
 * trigger is flushed before the next assertion.
 *
 * @overload
 * @param write Synchronous function performing Retree writes.
 * @returns Nothing; all resulting renders are flushed on return.
 */
export function actOnRetree(write: () => void): void;
/**
 * Async form: awaits the callback and flushes renders from writes on both
 * sides of its `await`s. Await the returned promise.
 *
 * @overload
 * @param write Async function performing Retree writes.
 * @returns A promise that resolves once all resulting renders are flushed.
 */
// TypeScript overload signatures intentionally share the exported name.
// eslint-disable-next-line no-redeclare
export function actOnRetree(write: () => Promise<void>): Promise<void>;
/**
 * Run Retree writes wrapped in React's `act`.
 *
 * @remarks
 * Writing to a Retree node outside `act` triggers React's "not wrapped in
 * act(...)" warning and can leave renders unflushed when asserting. This is
 * a typed convenience over `React.act` (available in react >=18.3.0) — it
 * adds nothing Retree-specific beyond the pinpointed error on older React
 * versions, so `act` from `@testing-library/react` works interchangeably.
 *
 * `globalThis.IS_REACT_ACT_ENVIRONMENT` is set to `true` for the duration of
 * the call and restored after, so no test-runner setup is required.
 *
 * @param write Function performing Retree writes; may be async.
 * @returns Nothing for a synchronous `write`; a promise to await for an
 * async `write`.
 *
 * @example
 * ```ts
 * import { actOnRetree, createTestRoot } from "@retreejs/react/testing";
 *
 * const { root, cleanup } = createTestRoot(() => ({ count: 0 }));
 * render(<Counter counter={root} />);
 *
 * actOnRetree(() => {
 *     root.count += 1;
 * });
 * expect(screen.getByText("1")).toBeTruthy();
 * ```
 */
// eslint-disable-next-line no-redeclare
export function actOnRetree(write: ReactActCallback): void | Promise<void> {
    const act = resolveReactAct();
    const previousFlag = setActEnvironmentFlag(true);
    let callbackResult: void | Promise<void> = undefined;
    let actResult: void | Promise<void>;
    try {
        actResult = act(() => {
            callbackResult = write();
            return callbackResult;
        });
    } catch (error) {
        setActEnvironmentFlag(previousFlag);
        throw error;
    }
    if (isPromiseLike(callbackResult)) {
        // Async write: act's thenable must be awaited by the caller; restore
        // the flag once everything has settled.
        return Promise.resolve(actResult).finally(() => {
            setActEnvironmentFlag(previousFlag);
        });
    }
    // Sync write: act flushed everything synchronously.
    setActEnvironmentFlag(previousFlag);
    return undefined;
}
