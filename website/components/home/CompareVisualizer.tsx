"use client";

import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Retree } from "@retreejs/core";
import { useNode, useSelect } from "@retreejs/react";
import { BurstRenderBadge } from "@/components/visualizer/BurstRenderBadge";
import {
    AutoplayStatusLine,
    createAutoplaySession,
    createTypingBurst,
    takeOver,
    useScriptedAutoplay,
} from "@/components/visualizer/scriptedAutoplay";
import {
    createProbeSet,
    resetProbeSet,
    useProbeSetTotal,
    useRenderProbe,
} from "@/components/compare/renderProbes";

interface CompareTask {
    id: number;
    title: string;
    done: boolean;
}

interface CompareState {
    name: string;
    tasks: CompareTask[];
}

/** Each store gets its own copies so the two stores never share objects. */
function createInitialState(): CompareState {
    return {
        name: "Launch checklist",
        tasks: [
            { id: 1, title: "Write the docs", done: true },
            { id: 2, title: "Review the PR", done: false },
            { id: 3, title: "Ship the release", done: false },
        ],
    };
}

/* --------------------------- mirrored state ---------------------------
 * Both implementations are always mounted, and every interaction goes
 * through the two functions below: the same logical change is applied to
 * the React-side useState store (via the dispatch registered on mount) and
 * to the Retree tree. Each side still renders idiomatically from its own
 * store — the mirroring only guarantees the render counters are comparing
 * the identical interaction, live and side by side.
 */

const retreeStore = Retree.root(createInitialState());

type StoreUpdater = (updater: (current: CompareState) => CompareState) => void;

/** The React pane registers its useState dispatch here while mounted. */
let storeDispatch: StoreUpdater | null = null;

function mirrorToggle(id: number): void {
    if (storeDispatch !== null) {
        storeDispatch((current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
                task.id === id ? { ...task, done: !task.done } : task
            ),
        }));
    }
    const task = retreeStore.tasks.find((entry) => entry.id === id);
    if (task === undefined) {
        throw new Error(
            `CompareVisualizer: no task with id ${id} exists in the Retree store to toggle.`
        );
    }
    task.done = !task.done;
}

function mirrorSetName(name: string): void {
    if (storeDispatch !== null) {
        storeDispatch((current) => ({ ...current, name }));
    }
    retreeStore.name = name;
}

/* ---------------------------- probe totals ---------------------------- */

const storeProbes = createProbeSet();
const retreeProbes = createProbeSet();

/* ---------------------------- scripted loop ----------------------------
 * Hero convention (see components/visualizer/HeroVisualizer.tsx): a slow
 * mirrored-mutation loop starts on mount — deliberately before the user
 * scrolls here, so the totals have accumulated and the store side is
 * visibly ahead by the time the section is seen. Hover/focus pauses it;
 * the first real interaction stops it for good.
 */

const autoplaySession = createAutoplaySession();

/** Rotating list names — each shares the "Launch " prefix so the scripted
 * retype (backspace to the prefix, then type forward) stays short. */
const AUTOPLAY_NAMES = [
    "Launch checklist",
    "Launch runbook",
    "Launch day notes",
];

let autoplayStep = 0;
let autoplayToggleIndex = 0;
let autoplayNameIndex = 0;

/** Simulated keystrokes — every intermediate value is a mirrored write. */
const nameBurst = createTypingBurst({
    read: () => retreeStore.name,
    write: (value) => {
        mirrorSetName(value);
        autoplaySession.lastLine = `name = ${JSON.stringify(value)}`;
    },
    // "done" (the step cap) must still finish an in-flight word — freezing
    // half-typed at "Launch day note" reads as a bug, not a pause. Hovering
    // ("paused") and take-over ("user") still stop the keystrokes.
    shouldContinue: () =>
        autoplaySession.mode === "auto" || autoplaySession.mode === "done",
    // Deliberately slow: each keystroke should read as typing, not as a
    // burst of render flashes. One character roughly every half second.
    charMs: 480,
});

/**
 * One scripted step per tick, rotating toggle → retype-the-name → toggle →
 * toggle, with the toggled task rotating too — varied enough that the
 * counters diverge the way real usage would.
 */
function runAutoplayStep(): boolean | void {
    // While the slow retype is mid-flight, let it be the only activity on
    // screen — a toggle firing between keystrokes would bury the typing in
    // unrelated render flashes. `false` = don't charge the maxSteps budget.
    if (nameBurst.isActive()) return false;

    const phase = autoplayStep % 4;
    autoplayStep += 1;

    if (phase === 1) {
        autoplayNameIndex = (autoplayNameIndex + 1) % AUTOPLAY_NAMES.length;
        nameBurst.start(AUTOPLAY_NAMES[autoplayNameIndex]);
        return;
    }
    const id = (autoplayToggleIndex % 3) + 1;
    autoplayToggleIndex += 1;
    mirrorToggle(id);
    const task = retreeStore.tasks.find((entry) => entry.id === id);
    if (task === undefined) {
        throw new Error(
            `CompareVisualizer autoplay: task ${id} is missing from the Retree store after a scripted toggle.`
        );
    }
    autoplaySession.lastLine = `tasks[${id - 1}].done = ${String(task.done)}`;
}

/** A real interaction: stop the loop permanently (hero take-over pattern). */
function takeOverCompare(line: string): void {
    nameBurst.cancel();
    takeOver(autoplaySession, line);
}

function userToggle(id: number): void {
    mirrorToggle(id);
    const task = retreeStore.tasks.find((entry) => entry.id === id);
    takeOverCompare(
        `tasks[${id - 1}].done = ${String(
            task === undefined ? "?" : task.done
        )}`
    );
}

function userSetName(name: string): void {
    takeOverCompare(`name = ${JSON.stringify(name)}`);
    mirrorSetName(name);
}

/** Zero the counters and restore both mirrored stores to the seed data. */
function resetMirroredStores(): void {
    resetProbeSet(storeProbes);
    resetProbeSet(retreeProbes);
    const fresh = createInitialState();
    retreeStore.name = fresh.name;
    retreeStore.tasks.splice(0, retreeStore.tasks.length, ...fresh.tasks);
}

/** Unmount cleanup: back-navigation must start from a clean slate. */
function handleCompareUnmount(): void {
    nameBurst.cancel();
    autoplayStep = 0;
    autoplayToggleIndex = 0;
    autoplayNameIndex = 0;
    resetMirroredStores();
}

/**
 * Mirrored side-by-side render-counter comparison (spec §3.1.3/§5.1): the
 * same task app on an idiomatic top-level `useState` store and on Retree
 * `useNode`, driven by shared controls so both sides receive the identical
 * interaction. Both sides are real, unthrottled implementations — the
 * comparison-side source is shown unabridged in the disclosure below the
 * demo so it can be audited.
 */
export function CompareVisualizer() {
    const [runId, setRunId] = useState(0);

    const pauseHandlers = useScriptedAutoplay({
        session: autoplaySession,
        intervalMs: 3000,
        initialDelayMs: 900,
        step: runAutoplayStep,
        maxSteps: 16,
        onUnmount: handleCompareUnmount,
    });

    const reset = () => {
        takeOverCompare("reset()");
        resetMirroredStores();
        // Remounting both panes restarts the React store and every
        // render counter from the same clean slate.
        setRunId((current) => current + 1);
    };

    return (
        <div {...pauseHandlers}>
            <SharedControls onReset={reset} />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Pane
                    variant="store"
                    title="idiomatic top-level store"
                    caption="One useState object, immutable updates, React.memo rows."
                    probes={storeProbes}
                    headerExtra={<WastedDelta />}
                >
                    <StoreApp key={`store-${runId}`} />
                </Pane>
                <Pane
                    variant="retree"
                    title="retree — useNode"
                    caption="Same UI, same interactions. Each row subscribes to its own node."
                    probes={retreeProbes}
                >
                    <RetreeApp key={`retree-${runId}`} />
                </Pane>
            </div>
            <Verdict />
        </div>
    );
}

/**
 * The single control surface: each button applies one logical change to
 * BOTH stores at once (so does typing in either pane's name field).
 */
function SharedControls({ onReset }: { onReset: () => void }) {
    return (
        <div className="rounded-xl border border-border-token bg-surface p-3 sm:p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                See for yourself
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
                {[1, 2, 3].map((id) => (
                    <ControlButton
                        key={id}
                        onClick={() => userToggle(id)}
                        ariaLabel={`Toggle task ${id} in both implementations`}
                    >
                        toggle task {id}
                    </ControlButton>
                ))}
                <ControlButton
                    onClick={onReset}
                    ariaLabel="Reset both implementations and all render counters"
                    icon="↺"
                >
                    reset
                </ControlButton>
            </div>
            <div className="mt-2.5">
                <AutoplayStatusLine
                    session={autoplaySession}
                    idleLine="// mirrored mutations start in a moment"
                />
            </div>
        </div>
    );
}

function ControlButton({
    onClick,
    children,
    ariaLabel,
    icon = "▶",
}: {
    onClick: () => void;
    children: ReactNode;
    ariaLabel: string;
    icon?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 font-mono text-[11px] text-foreground shadow-sm transition-[color,border-color,transform] duration-150 hover:border-[color:var(--accent-glow)] hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]"
        >
            <span aria-hidden className="text-[9px] text-accent">
                {icon}
            </span>
            {children}
        </button>
    );
}

function Pane({
    variant,
    title,
    caption,
    probes,
    headerExtra,
    children,
}: {
    variant: "store" | "retree";
    title: string;
    caption: string;
    probes: ReturnType<typeof createProbeSet>;
    headerExtra?: ReactNode;
    children: ReactNode;
}) {
    const accent = variant === "retree";
    const frame = accent
        ? "rounded-xl border border-[color:var(--accent-glow)] bg-surface-raised shadow-[0_0_28px_-10px_var(--accent-glow-soft)]"
        : "rounded-xl border border-border-token bg-surface shadow-[var(--glass-shadow)]";
    return (
        <div className={`${frame} p-3 sm:p-4`}>
            {/* items-start: both panes' titles sit on the same top line even
             * when one caption wraps to more lines than the other. */}
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <p
                        className={`font-mono text-xs uppercase tracking-widest ${
                            accent ? "text-accent" : "text-faint"
                        }`}
                    >
                        {title}
                    </p>
                    <p className="mt-1 text-xs text-muted">{caption}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <PaneTotal probes={probes} accent={accent} />
                    {headerExtra}
                </div>
            </div>
            <div className="mt-3">{children}</div>
        </div>
    );
}

/** Big cumulative counter — the per-pane headline number. */
function PaneTotal({
    probes,
    accent,
}: {
    probes: ReturnType<typeof createProbeSet>;
    accent: boolean;
}) {
    const total = useProbeSetTotal(probes);
    const reduceMotion = useReducedMotion();
    return (
        <p className="flex shrink-0 items-baseline gap-1.5">
            <motion.span
                key={total}
                initial={reduceMotion ? false : { opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 }}
                className={`text-3xl font-semibold tabular-nums tracking-tight ${
                    accent ? "text-accent" : "text-danger"
                }`}
            >
                {total}
            </motion.span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
                renders
            </span>
        </p>
    );
}

/**
 * Honest running delta on the store pane: how many more renders it has
 * done than the Retree pane, for the exact same interactions.
 */
function WastedDelta() {
    const storeTotal = useProbeSetTotal(storeProbes);
    const retreeTotal = useProbeSetTotal(retreeProbes);
    const delta = storeTotal - retreeTotal;
    if (delta <= 0) return null;
    return (
        <span className="rounded border border-border-token bg-background px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-faint">
            +{delta} vs retree
        </span>
    );
}

/** Live one-line verdict under the panes. */
function Verdict() {
    const storeTotal = useProbeSetTotal(storeProbes);
    const retreeTotal = useProbeSetTotal(retreeProbes);
    const delta = storeTotal - retreeTotal;
    return (
        <p className="mt-4 text-center font-mono text-xs text-muted sm:text-sm">
            same interactions —{" "}
            <span className="font-semibold text-danger">
                {storeTotal} renders
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

/* ------------------- idiomatic top-level store ------------------- */

const StoreNameField = memo(function StoreNameField({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const { ref, renders } = useRenderProbe<HTMLDivElement>(storeProbes.name);
    return (
        <div
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-background px-2 py-1.5"
        >
            <label
                htmlFor="compare-store-name"
                className="font-mono text-[10px] uppercase tracking-widest text-faint"
            >
                name
            </label>
            <input
                id="compare-store-name"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
            />
            <BurstRenderBadge renders={renders} tone="danger" />
        </div>
    );
});

const StoreRow = memo(function StoreRow({
    task,
    onToggle,
}: {
    task: CompareTask;
    onToggle: (id: number) => void;
}) {
    const { ref, renders } = useRenderProbe<HTMLLIElement>(
        storeProbes.rows[task.id - 1]
    );
    return (
        <li
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-background px-2 py-1.5"
        >
            <input
                type="checkbox"
                checked={task.done}
                onChange={() => onToggle(task.id)}
                aria-label={`Toggle "${task.title}" (top-level store)`}
                className="size-3.5 shrink-0 accent-accent"
            />
            <span
                className={`min-w-0 flex-1 truncate font-mono text-xs ${
                    task.done ? "text-faint line-through" : "text-foreground"
                }`}
            >
                {task.title}
            </span>
            <BurstRenderBadge renders={renders} tone="danger" />
        </li>
    );
});

function StoreApp() {
    const [store, setStore] = useState(createInitialState);
    const { ref, renders } = useRenderProbe<HTMLDivElement>(storeProbes.app);

    // Register the dispatch so shared controls (and the Retree pane's
    // inputs) update this store too. The store itself stays idiomatic.
    useEffect(() => {
        storeDispatch = setStore;
        return () => {
            if (storeDispatch === setStore) {
                storeDispatch = null;
            }
        };
    }, []);

    // Local inputs are real interactions: they take the loop over, then go
    // through the mirror so both stores receive them.
    const toggle = useCallback((id: number) => userToggle(id), []);
    const setName = useCallback((name: string) => userSetName(name), []);

    const doneCount = store.tasks.filter((task) => task.done).length;

    return (
        <div
            ref={ref}
            className="rounded-lg border border-border-token bg-background p-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    {"<App />"}
                </span>
                <BurstRenderBadge renders={renders} tone="danger" />
            </div>
            <div className="mt-2">
                <StoreNameField value={store.name} onChange={setName} />
            </div>
            <ul className="mt-1.5 space-y-1.5">
                {store.tasks.map((task) => (
                    <StoreRow key={task.id} task={task} onToggle={toggle} />
                ))}
            </ul>
            <StoreDoneCount
                doneCount={doneCount}
                taskCount={store.tasks.length}
            />
        </div>
    );
}

const StoreDoneCount = memo(function StoreDoneCount({
    doneCount,
    taskCount,
}: {
    doneCount: number;
    taskCount: number;
}) {
    const { ref, renders } = useRenderProbe<HTMLParagraphElement>(
        storeProbes.done
    );
    return (
        <p
            ref={ref}
            className="mt-2 flex items-center gap-2 font-mono text-[11px] text-muted"
        >
            <span className="flex-1">
                done: {doneCount}/{taskCount}
                <span className="ml-2 text-faint">computed in {"<App />"}</span>
            </span>
            <BurstRenderBadge renders={renders} tone="danger" />
        </p>
    );
});

/* --------------------------- Retree side --------------------------- */

function RetreeNameField() {
    // Subscribes to the root node: re-renders on name changes only.
    const state = useNode(retreeStore);
    const { ref, renders } = useRenderProbe<HTMLDivElement>(retreeProbes.name);
    return (
        <div
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-background px-2 py-1.5"
        >
            <label
                htmlFor="compare-retree-name"
                className="font-mono text-[10px] uppercase tracking-widest text-faint"
            >
                name
            </label>
            <input
                id="compare-retree-name"
                value={state.name}
                onChange={(event) => userSetName(event.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
            />
            <BurstRenderBadge renders={renders} />
        </div>
    );
}

function RetreeRow({ task }: { task: CompareTask }) {
    const state = useNode(task);
    const { ref, renders } = useRenderProbe<HTMLLIElement>(
        retreeProbes.rows[state.id - 1]
    );
    return (
        <li
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-background px-2 py-1.5"
        >
            <input
                type="checkbox"
                checked={state.done}
                onChange={() => userToggle(state.id)}
                aria-label={`Toggle "${state.title}" (Retree)`}
                className="size-3.5 shrink-0 accent-accent"
            />
            <span
                className={`min-w-0 flex-1 truncate font-mono text-xs ${
                    state.done ? "text-faint line-through" : "text-foreground"
                }`}
            >
                {state.title}
            </span>
            <BurstRenderBadge renders={renders} />
        </li>
    );
}

function RetreeDoneCount() {
    const doneCount = useSelect(
        retreeStore.tasks,
        (tasks) => tasks.filter((task) => task.done).length,
        { listenerType: "treeChanged" }
    );
    const { ref, renders } = useRenderProbe<HTMLParagraphElement>(
        retreeProbes.done
    );
    return (
        <p
            ref={ref}
            className="mt-2 flex items-center gap-2 font-mono text-[11px] text-muted"
        >
            <span className="flex-1">
                done: {doneCount}/{retreeStore.tasks.length}
                <span className="ml-2 text-faint">useSelect</span>
            </span>
            <BurstRenderBadge renders={renders} />
        </p>
    );
}

function RetreeApp() {
    const tasks = useNode(retreeStore.tasks);
    const { ref, renders } = useRenderProbe<HTMLDivElement>(retreeProbes.app);
    return (
        <div
            ref={ref}
            className="rounded-lg border border-border-token bg-background p-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    {"<App />"}
                </span>
                <BurstRenderBadge renders={renders} />
            </div>
            <div className="mt-2">
                <RetreeNameField />
            </div>
            <ul className="mt-1.5 space-y-1.5">
                {tasks.map((task) => (
                    <RetreeRow key={task.id} task={task} />
                ))}
            </ul>
            <RetreeDoneCount />
        </div>
    );
}
