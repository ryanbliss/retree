"use client";

/**
 * Always-visible render counter — the canonical, reduced-motion-safe evidence
 * of which components re-rendered (spec §5.1).
 */
export function RenderBadge({ renders }: { renders: number }) {
    return (
        <span className="rounded border border-border-token bg-surface px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-faint">
            renders:{" "}
            {/* Render counters intentionally differ between the server pass
                and client hydration (dev double-renders); the drift is the
                feature, so hydration warnings are suppressed. */}
            <span
                suppressHydrationWarning
                className="font-semibold text-accent"
            >
                {renders}
            </span>
        </span>
    );
}
