"use client";

/**
 * Full comparative re-render visualizer (spec §5.1).
 *
 * The same small task app runs twice, SIDE BY SIDE, with mirrored state:
 * - "Idiomatic top-level store": one useState store, immutable updates,
 *   React.memo + useCallback — written the way a careful React developer
 *   would, not a strawman (components/compare/demos/ReactTasksDemo.tsx).
 * - "Retree useNode": per-node subscriptions on one plain object
 *   (components/compare/demos/RetreeTasksDemo.tsx).
 *
 * Every interaction in either pane goes through a shared mirror bus
 * (createDemoMirror) that applies the same logical change to BOTH stores,
 * so the render counters compare the identical interaction in real time.
 *
 * Per-component render counters are always visible (the canonical,
 * reduced-motion-safe evidence); the glow pulse is progressive enhancement.
 * A "View source" disclosure shows the actual source modules, read from
 * disk by the server page and rendered with the site's Shiki CodeBlock —
 * so skeptics can audit both implementations.
 */

import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useNode } from "@retreejs/react";
import { useRenderGlow } from "./useRenderGlow";
import {
    AutoplayStatusLine,
    createAutoplaySession,
    createTypingBurst,
    takeOver,
    useScriptedAutoplay,
} from "./scriptedAutoplay";
import {
    createDemoMirror,
    resetProbeSet,
    useProbeSetTotal,
    type DemoMirror,
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

/** One bus for the page: both demos register their store's write paths. */
const mirror = createDemoMirror();

/* ---------------------------- scripted loop ----------------------------
 * Same hero-style autoplay as the home page's CompareVisualizer: a slow
 * loop pushes mirrored mutations through the bus from mount, so the store
 * side is visibly ahead by the time the visualizer is scrolled into view.
 * Hover/focus pauses it; the first real interaction stops it for good.
 */

const autoplaySession = createAutoplaySession();

/** Must match both demos' seed list name (they seed independently). */
const INITIAL_LIST_NAME = "Launch checklist";

/** Rotating names sharing the "Launch " prefix keeps retypes short. */
const AUTOPLAY_NAMES = [INITIAL_LIST_NAME, "Launch runbook", "Launch retro"];

let autoplayStep = 0;
let autoplayToggleIndex = 0;
let autoplayNameIndex = 0;

/**
 * The scripted loop's view of the name field. The demos own their stores
 * privately (useState / useRoot), so the loop tracks what it has typed —
 * accurate because once a user writes anything, the mode flips to "user"
 * and the loop never writes again.
 */
let typedName = INITIAL_LIST_NAME;

/** Simulated keystrokes — every intermediate value is a mirrored write. */
const nameBurst = createTypingBurst({
    read: () => typedName,
    write: (value) => {
        typedName = value;
        mirror.setListName(value);
        autoplaySession.lastLine = `mirror.setListName(${JSON.stringify(
            value
        )})`;
    },
    shouldContinue: () => autoplaySession.mode === "auto",
    charMs: 170,
});

/** One scripted step per tick: toggle → retype the name → toggle → toggle. */
function runAutoplayStep(): void {
    const phase = autoplayStep % 4;
    autoplayStep += 1;

    if (phase === 1) {
        autoplayNameIndex = (autoplayNameIndex + 1) % AUTOPLAY_NAMES.length;
        nameBurst.start(AUTOPLAY_NAMES[autoplayNameIndex]);
        return;
    }
    const id = (autoplayToggleIndex % 3) + 1;
    autoplayToggleIndex += 1;
    mirror.toggleTask(id);
    autoplaySession.lastLine = `mirror.toggleTask(${id})`;
}

/** A real interaction: stop the loop permanently (hero take-over pattern). */
function takeOverVisualizer(line: string): void {
    nameBurst.cancel();
    takeOver(autoplaySession, line);
}

/**
 * The mirror handed to the demo panes: identical fan-out, but marks the
 * interaction as the user's first so the scripted loop stops. The loop
 * itself writes through the raw `mirror` above.
 */
const interactiveMirror: DemoMirror = {
    register: (sideId, actions) => mirror.register(sideId, actions),
    toggleTask: (id) => {
        takeOverVisualizer(`mirror.toggleTask(${id})`);
        mirror.toggleTask(id);
    },
    setListName: (name) => {
        takeOverVisualizer(`mirror.setListName(${JSON.stringify(name)})`);
        mirror.setListName(name);
    },
};

/** Unmount cleanup: back-navigation must start from a clean slate. */
function handleVisualizerUnmount(): void {
    nameBurst.cancel();
    autoplayStep = 0;
    autoplayToggleIndex = 0;
    autoplayNameIndex = 0;
    typedName = INITIAL_LIST_NAME;
    resetProbeSet(reactProbes);
    resetProbeSet(retreeProbes);
}

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

/** Big cumulative counter — the per-pane headline number. */
function PaneTotal({
    probes,
    accent,
}: {
    probes: DemoProbeSet;
    accent: boolean;
}) {
    const total = useProbeSetTotal(probes);
    const reduceMotion = useReducedMotion();
    return (
        <p className="flex items-baseline gap-1.5">
            <motion.span
                key={total}
                initial={reduceMotion ? false : { opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className={`text-3xl font-semibold tabular-nums tracking-tight ${
                    accent ? "text-accent" : "text-foreground"
                }`}
            >
                {total}
            </motion.span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                renders this session
            </span>
        </p>
    );
}

/**
 * Honest running delta on the store pane: how many more renders it has
 * done than the Retree pane, for the exact same interactions.
 */
function WastedDelta() {
    const reactTotal = useProbeSetTotal(reactProbes);
    const retreeTotal = useProbeSetTotal(retreeProbes);
    const delta = reactTotal - retreeTotal;
    if (delta <= 0) return null;
    return (
        <span className="rounded border border-border-token bg-background px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-faint">
            +{delta} vs retree
        </span>
    );
}

/** Live verdict line — the same interactions, two totals. */
function VerdictLine() {
    const reactTotal = useProbeSetTotal(reactProbes);
    const retreeTotal = useProbeSetTotal(retreeProbes);
    const delta = reactTotal - retreeTotal;
    return (
        <p className="border-t border-border-token px-4 py-3 text-center font-mono text-xs text-muted sm:text-sm">
            same interactions —{" "}
            <span className="font-semibold text-foreground">
                {reactTotal} renders
            </span>{" "}
            with the top-level store vs{" "}
            <span className="font-semibold text-accent">{retreeTotal}</span>{" "}
            with Retree
            {delta > 0 ? (
                <span className="text-faint">
                    {" "}
                    — {delta} renders you didn&apos;t need
                </span>
            ) : null}
        </p>
    );
}

interface PaneConfig {
    eyebrow: string;
    accent: boolean;
    caption: string;
}

function ImplementationPane({
    config,
    probes,
    headerExtra,
    children,
}: {
    config: PaneConfig;
    probes: DemoProbeSet;
    headerExtra?: ReactNode;
    children: ReactNode;
}) {
    const frame = config.accent
        ? "rounded-xl border border-[color:var(--accent-glow)] bg-surface-raised shadow-[0_0_28px_-10px_var(--accent-glow-soft)]"
        : "rounded-xl border border-border-token bg-surface";
    return (
        <div className={`${frame} p-3 sm:p-4`}>
            <div className="flex flex-wrap items-end justify-between gap-2">
                <p
                    className={`font-mono text-xs uppercase tracking-widest ${
                        config.accent ? "text-accent" : "text-faint"
                    }`}
                >
                    {config.eyebrow}
                </p>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <PaneTotal probes={probes} accent={config.accent} />
                    {headerExtra}
                </div>
            </div>
            <div className="mt-3">{children}</div>
            <div className="mt-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint">
                    component tree — live render counts
                </p>
                <div className="rounded-lg border border-border-token bg-background p-3">
                    <ProbeTree probes={probes} />
                </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
                {config.caption}
            </p>
        </div>
    );
}

const REACT_PANE: PaneConfig = {
    eyebrow: "idiomatic top-level store",
    accent: false,
    caption:
        "One useState store at the top; React.memo + useCallback below. Memoization keeps untouched rows quiet — but the store owner (TasksApp) re-renders on every keystroke and every toggle, because the store lives in its state.",
};

const RETREE_PANE: PaneConfig = {
    eyebrow: "retree — useNode",
    accent: true,
    caption:
        "One plain object; each component subscribes to the node it reads with useNode / useSelect. TasksApp subscribes to nothing and renders once. Typing re-renders NameInput alone.",
};

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
    const [runId, setRunId] = useState(0);

    const pauseHandlers = useScriptedAutoplay({
        session: autoplaySession,
        intervalMs: 3400,
        initialDelayMs: 1000,
        step: runAutoplayStep,
        maxSteps: 14,
        onUnmount: handleVisualizerUnmount,
    });

    const resetCounters = () => {
        takeOverVisualizer("reset()");
        typedName = INITIAL_LIST_NAME;
        resetProbeSet(reactProbes);
        resetProbeSet(retreeProbes);
        // Remount both demos so their render counters and stores restart
        // from the same clean slate.
        setRunId((current) => current + 1);
    };

    return (
        <section
            aria-label="Comparative re-render visualizer"
            className="rounded-xl border border-border-token bg-background"
            {...pauseHandlers}
        >
            {/* Instruction + reset */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border-token px-4 py-3">
                <p className="min-w-0 flex-1 text-xs leading-5 text-muted sm:text-sm">
                    One interaction, two implementations. A scripted loop has
                    been mirroring writes into both stores since the page loaded
                    — hover pauses it. Type in a name field or toggle a box in{" "}
                    <span className="text-foreground">either</span> pane to take
                    over: the same change is applied to both stores at once, so
                    the counters always compare the identical interaction.
                </p>
                <button
                    type="button"
                    onClick={resetCounters}
                    className="shrink-0 cursor-pointer rounded-md border border-border-token px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                    ↺ Reset counters
                </button>
            </div>

            {/* Both panes, live and mirrored. Stacked below lg (spec §5.1). */}
            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
                <ImplementationPane
                    config={REACT_PANE}
                    probes={reactProbes}
                    headerExtra={<WastedDelta />}
                >
                    <ReactTasksDemo
                        key={`react-${runId}`}
                        mirror={interactiveMirror}
                    />
                </ImplementationPane>
                <ImplementationPane config={RETREE_PANE} probes={retreeProbes}>
                    <RetreeTasksDemo
                        key={`retree-${runId}`}
                        mirror={interactiveMirror}
                    />
                </ImplementationPane>
            </div>

            <div className="border-t border-border-token px-4 py-2.5">
                <AutoplayStatusLine
                    session={autoplaySession}
                    idleLine="// mirrored mutations start in a moment"
                />
            </div>

            <VerdictLine />

            {/* Auditable source of both sides */}
            <details className="border-t border-border-token px-4 py-3">
                <summary className="cursor-pointer font-mono text-xs text-muted transition-colors hover:text-foreground">
                    View source — both implementations, unabridged
                </summary>
                <p className="mt-2 text-xs leading-5 text-faint">
                    These are the actual modules rendered above, read from disk
                    at build time — not simplified excerpts. The useRenderProbe
                    lines are shared instrumentation (render counter, glow,
                    diagram mirroring), and the mirror calls apply each
                    interaction to both stores; both are identical on the two
                    sides.
                </p>
                <div className="mt-2 grid gap-4 text-left xl:grid-cols-2">
                    <div className="min-w-0">{reactSource}</div>
                    <div className="min-w-0">{retreeSource}</div>
                </div>
            </details>
        </section>
    );
}
