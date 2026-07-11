"use client";

/**
 * Full comparative re-render visualizer (spec §5.1).
 *
 * The same small task app is implemented two ways and toggled between:
 * - "Idiomatic top-level store": one useState store, immutable updates,
 *   React.memo + useCallback — written the way a careful React developer
 *   would, not a strawman (components/compare/demos/ReactTasksDemo.tsx).
 * - "Retree useNode": per-node subscriptions on one plain object
 *   (components/compare/demos/RetreeTasksDemo.tsx).
 *
 * Per-component render counters are always visible (the canonical,
 * reduced-motion-safe evidence); the glow pulse is progressive enhancement.
 * A "View source" disclosure shows the actual source module of whichever
 * side is active, read from disk by the server page and rendered with the
 * site's Shiki CodeBlock — so skeptics can audit both implementations.
 */

import { useState, type ReactNode } from "react";
import { useNode } from "@retreejs/react";
import { useRenderGlow } from "./useRenderGlow";
import {
    resetProbeSet,
    type DemoProbeSet,
    type RenderProbe,
} from "@/components/compare/renderProbes";
import {
    ReactTasksDemo,
    reactProbes,
} from "@/components/compare/demos/ReactTasksDemo";
import {
    RetreeTasksDemo,
    retreeProbes,
} from "@/components/compare/demos/RetreeTasksDemo";

type Mode = "react" | "retree";

interface ModeConfig {
    id: Mode;
    toggleLabel: string;
    probes: DemoProbeSet;
    caption: string;
    sourceTitle: string;
}

const MODES: ModeConfig[] = [
    {
        id: "react",
        toggleLabel: "Idiomatic top-level store",
        probes: reactProbes,
        caption:
            "One useState store at the top; React.memo + useCallback below. Memoization keeps untouched rows quiet — but the store owner (TasksApp) re-renders on every keystroke and every toggle, because the store lives in its state.",
        sourceTitle: "components/compare/demos/ReactTasksDemo.tsx",
    },
    {
        id: "retree",
        toggleLabel: "Retree useNode",
        probes: retreeProbes,
        caption:
            "One plain object; each component subscribes to the node it reads with useNode / useSelect. TasksApp subscribes to nothing and renders once. Typing re-renders NameInput alone.",
        sourceTitle: "components/compare/demos/RetreeTasksDemo.tsx",
    },
];

/**
 * One node in the schematic component-tree diagram. Subscribes to its probe
 * (dogfooding useNode), so it updates — and glows — exactly when the demo
 * component it mirrors commits a render.
 */
function ProbePill({ probe }: { probe: RenderProbe }) {
    const state = useNode(probe);
    const { ref } = useRenderGlow<HTMLSpanElement>();
    return (
        <span
            ref={ref}
            className="inline-flex items-center gap-2 rounded-md border border-border-token bg-surface px-2 py-1 font-mono text-[11px] text-muted"
        >
            {state.label}
            <span className="text-faint">·</span>
            <span className="tabular-nums font-semibold text-accent">
                {/* Counts mirror in after hydration; show a dash until then
                    so the diagram never disagrees with the render badges. */}
                {state.renders === 0 ? "–" : state.renders}
            </span>
        </span>
    );
}

function ProbeTree({ probes }: { probes: DemoProbeSet }) {
    return (
        <div className="font-mono text-[11px]">
            <ProbePill probe={probes.app} />
            <ul className="ml-3 mt-2 space-y-2 border-l border-border-strong pl-4">
                <li>
                    <ProbePill probe={probes.name} />
                </li>
                {probes.rows.map((row, index) => (
                    <li key={index}>
                        <ProbePill probe={row} />
                    </li>
                ))}
                <li>
                    <ProbePill probe={probes.done} />
                </li>
            </ul>
        </div>
    );
}

export interface ComparativeVisualizerProps {
    /**
     * Server-rendered code blocks of the two demo modules (the actual files
     * rendered by this component, read from disk by the server page).
     */
    reactSource: ReactNode;
    retreeSource: ReactNode;
}

export function ComparativeVisualizer({
    reactSource,
    retreeSource,
}: ComparativeVisualizerProps) {
    const [mode, setMode] = useState<Mode>("react");
    const [runId, setRunId] = useState(0);
    const active = MODES.find((config) => config.id === mode) ?? MODES[0];

    const resetCounters = () => {
        resetProbeSet(reactProbes);
        resetProbeSet(retreeProbes);
        setRunId((current) => current + 1);
    };

    const selectMode = (next: Mode) => {
        if (next === mode) return;
        resetProbeSet(reactProbes);
        resetProbeSet(retreeProbes);
        setMode(next);
        setRunId((current) => current + 1);
    };

    return (
        <section
            aria-label="Comparative re-render visualizer"
            className="rounded-xl border border-border-token bg-background"
        >
            {/* Toggle + reset */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border-token px-4 py-3">
                <div
                    role="group"
                    aria-label="Implementation"
                    className="flex flex-wrap gap-1 rounded-lg border border-border-token bg-surface p-1"
                >
                    {MODES.map((config) => (
                        <button
                            key={config.id}
                            type="button"
                            aria-pressed={config.id === mode}
                            onClick={() => selectMode(config.id)}
                            className={
                                config.id === mode
                                    ? "rounded-md bg-surface-raised px-3 py-1.5 font-mono text-xs text-foreground shadow-sm"
                                    : "rounded-md px-3 py-1.5 font-mono text-xs text-faint transition-colors hover:text-foreground"
                            }
                        >
                            {config.toggleLabel}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={resetCounters}
                    className="rounded-md border border-border-token px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                    Reset counters
                </button>
            </div>

            {/* Panes: live app + schematic tree. Stacked below md (spec §5.1). */}
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                <div>
                    <p className="mb-2 font-mono text-xs uppercase tracking-widest text-faint">
                        Live app — type in the field, toggle the boxes
                    </p>
                    <div key={`${mode}-${runId}`}>
                        {mode === "react" ? (
                            <ReactTasksDemo />
                        ) : (
                            <RetreeTasksDemo />
                        )}
                    </div>
                </div>
                <div>
                    <p className="mb-2 font-mono text-xs uppercase tracking-widest text-faint">
                        Component tree — live render counts
                    </p>
                    <div className="rounded-lg border border-border-token bg-background p-3">
                        <ProbeTree key={mode} probes={active.probes} />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted">
                        {active.caption}
                    </p>
                </div>
            </div>

            {/* Auditable source of the active side */}
            <details className="border-t border-border-token px-4 py-3">
                <summary className="cursor-pointer font-mono text-xs text-muted transition-colors hover:text-foreground">
                    View source — {active.sourceTitle}
                </summary>
                <p className="mt-2 text-xs leading-5 text-faint">
                    This is the actual module rendered above, read from disk at
                    build time — not a simplified excerpt. The useRenderProbe
                    lines are shared instrumentation (render counter, glow,
                    diagram mirroring), identical on both sides.
                </p>
                <div className="mt-2 text-left">
                    {mode === "react" ? reactSource : retreeSource}
                </div>
            </details>
        </section>
    );
}
