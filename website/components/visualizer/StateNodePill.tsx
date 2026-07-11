"use client";

import { useNode } from "@retreejs/react";
import { useRenderGlow } from "./useRenderGlow";

/**
 * A schematic state-tree node for visualizer diagrams. Subscribes to the
 * Retree node it represents (dogfooding `useNode`), so it re-renders — and
 * glows — exactly when that node changes.
 */
export function StateNodePill({
    node,
    label,
    showRenders = false,
}: {
    node: object;
    label: string;
    showRenders?: boolean;
}) {
    useNode(node);
    const { ref, renders } = useRenderGlow<HTMLSpanElement>();
    return (
        <span
            ref={ref}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-token bg-surface px-2 py-1 font-mono text-[11px] text-muted"
        >
            {label}
            {showRenders ? (
                <span className="tabular-nums text-faint">·{renders}</span>
            ) : null}
        </span>
    );
}
