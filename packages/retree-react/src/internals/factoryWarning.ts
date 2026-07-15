/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo" is load-bearing when this source is compiled by the React
// Compiler (source-inclusion setups only; consumers' compilers skip the
// published bin/ output in node_modules). See useNodeInternalCore.ts and
// react-compiler.spec.tsx for the failure mode and proof.
"use no memo";
"use client";

import { TreeNode } from "@retreejs/core";
import { useRef } from "react";
import { isDevMode } from "./env.js";

export type NodeFactoryHookName =
    | "useNode"
    | "useTree"
    | "useRaw"
    | "useSelect";

interface NodeFactoryResetWarningState {
    previousBaseProxy: TreeNode | undefined;
    consecutiveResolvedChanges: number;
    warned: boolean;
}

/**
 * How many consecutive renders the resolved base proxy must change before
 * warning. A legitimate factory can resolve a new node once or twice (e.g.
 * remount, StrictMode double-invocation); only a factory minting fresh state
 * every render keeps changing.
 */
const WARN_AFTER_CONSECUTIVE_CHANGES = 3;

/**
 * Dev-only footgun detector for inline node factories.
 *
 * @remarks
 * `useNode`/`useTree`/`useRaw`/`useSelect` accept a node factory, and an
 * inline `() => Retree.root({ ... })` gets a fresh function identity every
 * render, so the factory re-runs and silently resets state each render. When
 * the resolved base proxy for a factory argument differs on more than two
 * consecutive renders of the same hook instance, warn once per hook instance.
 *
 * Plain node arguments are exempt: a parent legitimately passes different
 * nodes over time, and a changing node prop cannot reset state.
 *
 * The ref is written during render, which is normally unsafe under concurrent
 * rendering; this is a dev-only heuristic where a discarded render at worst
 * counts one extra change toward the warning threshold.
 */
export function useNodeFactoryResetWarning(
    hookName: NodeFactoryHookName,
    nodeOrFactory: unknown,
    resolvedBaseProxy: TreeNode
): void {
    const stateRef = useRef<NodeFactoryResetWarningState>({
        previousBaseProxy: undefined,
        consecutiveResolvedChanges: 0,
        warned: false,
    });
    if (!isDevMode()) {
        return;
    }
    const state = stateRef.current;
    if (state.warned) {
        return;
    }
    const previousBaseProxy = state.previousBaseProxy;
    state.previousBaseProxy = resolvedBaseProxy;
    if (typeof nodeOrFactory !== "function") {
        state.consecutiveResolvedChanges = 0;
        return;
    }
    if (previousBaseProxy === undefined) {
        return;
    }
    if (previousBaseProxy === resolvedBaseProxy) {
        state.consecutiveResolvedChanges = 0;
        return;
    }
    state.consecutiveResolvedChanges += 1;
    if (state.consecutiveResolvedChanges < WARN_AFTER_CONSECUTIVE_CHANGES) {
        return;
    }
    state.warned = true;
    console.warn(
        `${hookName}: the node factory passed to ${hookName} resolved a different node on ${state.consecutiveResolvedChanges} consecutive renders. An inline factory like "${hookName}(() => Retree.root({ ... }))" creates fresh state every render, silently resetting it. Fix: hoist the factory (and its Retree.root call) outside the component, or create component-owned roots with useRoot and pass its result to ${hookName}.`
    );
}
