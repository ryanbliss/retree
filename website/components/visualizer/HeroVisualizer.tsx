"use client";

import { useEffect, type FocusEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import { RenderBadge } from "./RenderBadge";
import { StateNodePill } from "./StateNodePill";
import { useRenderGlow } from "./useRenderGlow";

interface HeroTask {
    id: number;
    title: string;
    done: boolean;
    subtasks: HeroTask[];
}

/**
 * The hero demo's state — a real Retree tree (`@retreejs/core` from this
 * repo), mutated with plain assignments. Nothing here is simulated.
 *
 * tasks[1] carries recursive subtasks (three levels deep — just enough to
 * make the point): when the scripted loop writes to the deepest leaf, that
 * one row flashes while every ancestor's counter stays put.
 */
const demo = Retree.root({
    tasks: [
        { id: 1, title: "Ship the quickstart", done: false, subtasks: [] },
        {
            id: 2,
            title: "Write tests",
            done: true,
            subtasks: [
                {
                    id: 21,
                    title: "Unit tests",
                    done: false,
                    subtasks: [
                        {
                            id: 211,
                            title: "Cover the edge cases",
                            done: false,
                            subtasks: [],
                        },
                    ],
                },
                {
                    id: 22,
                    title: "Integration tests",
                    done: false,
                    subtasks: [],
                },
            ],
        },
        { id: 3, title: "Cut a release", done: false, subtasks: [] },
    ] as HeroTask[],
    stats: { count: 0 },
});

/** The deepest node in the seeded tree — the scripted loop's money shot. */
const DEEP_LEAF_PATH = "tasks[1].subtasks[0].subtasks[0]";
function deepLeaf(): HeroTask {
    return demo.tasks[1].subtasks[0].subtasks[0];
}

type HeroMode = "auto" | "paused" | "user" | "done";

/**
 * Meta-state for the scripted loop, kept in its own Retree root — outside
 * `demo` — so the schematic tree pane shows only the state the demo app
 * actually uses. Only <StatusLine /> subscribes to it.
 */
const session = Retree.root({
    mode: "auto" as HeroMode,
    lastLine: "",
});

const SCRIPT_TITLES = [
    "Write tests",
    "Write better tests",
    "Rewrite the tests",
];

let scriptStep = 0;

/**
 * One scripted mutation per tick, rotating: deep-leaf toggle → top-level
 * toggle → retitle → subtask toggle → count. The deep-leaf write comes first
 * so the narrow-re-render money shot — one leaf flashing three levels down
 * while every ancestor stays quiet — appears within seconds of load.
 */
function runScriptStep(): void {
    const phase = scriptStep % 5;
    const round = Math.floor(scriptStep / 5);
    scriptStep += 1;

    if (phase === 0) {
        const leaf = deepLeaf();
        leaf.done = !leaf.done;
        session.lastLine = `${DEEP_LEAF_PATH}.done = ${String(leaf.done)}`;
        return;
    }
    if (phase === 1) {
        const index = round % demo.tasks.length;
        const task = demo.tasks[index];
        task.done = !task.done;
        session.lastLine = `tasks[${index}].done = ${String(task.done)}`;
        return;
    }
    if (phase === 2) {
        const title = SCRIPT_TITLES[round % SCRIPT_TITLES.length];
        demo.tasks[1].title = title;
        session.lastLine = `tasks[1].title = ${JSON.stringify(title)}`;
        return;
    }
    if (phase === 3) {
        const subtask = demo.tasks[1].subtasks[1];
        subtask.done = !subtask.done;
        session.lastLine = `tasks[1].subtasks[1].done = ${String(
            subtask.done
        )}`;
        return;
    }
    demo.stats.count += 1;
    session.lastLine = `stats.count = ${demo.stats.count}`;
}

/** First real user interaction stops the scripted loop for good. */
function takeOver(line: string): void {
    session.mode = "user";
    session.lastLine = line;
}

/**
 * The compact hero visualizer (spec §3.1/§5.1): a small task-list app built
 * with real Retree next to a schematic state tree. A scripted mutation loop
 * auto-plays so render flashes and counters are visible without interaction;
 * hover/focus pauses it, and the first real interaction stops it entirely.
 *
 * The top-level component holds no React state, so it renders once — every
 * re-render you see below is a per-node Retree subscription firing.
 */
export function HeroVisualizer() {
    useEffect(() => {
        let interval: number | undefined;

        const tick = (): void => {
            if (session.mode === "user" || session.mode === "done") {
                if (interval !== undefined) {
                    window.clearInterval(interval);
                    interval = undefined;
                }
                return;
            }
            if (session.mode === "paused") return;
            runScriptStep();
            // Cap the loop so counters stay small and meaningful; the demo
            // becomes the visitor's after that.
            if (scriptStep >= 25 && session.mode === "auto") {
                session.mode = "done";
            }
        };

        // Fire the first mutation quickly so flashes appear within ~2s of
        // load, then settle into the 1.6s loop.
        const initial = window.setTimeout(() => {
            tick();
            if (session.mode !== "user") {
                interval = window.setInterval(tick, 1600);
            }
        }, 600);

        return () => {
            window.clearTimeout(initial);
            if (interval !== undefined) window.clearInterval(interval);
            // The session root is module state; reset it so autoplay starts
            // fresh if the user navigates away and back to this page.
            session.mode = "auto";
            session.lastLine = "";
            scriptStep = 0;
        };
    }, []);

    const pause = (): void => {
        if (session.mode === "auto") session.mode = "paused";
    };
    const resume = (): void => {
        if (session.mode === "paused") session.mode = "auto";
    };
    const onBlurCapture = (event: FocusEvent<HTMLDivElement>): void => {
        const next =
            event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (next === null || !event.currentTarget.contains(next)) {
            resume();
        }
    };

    return (
        <div
            onPointerEnter={pause}
            onPointerLeave={resume}
            onFocusCapture={pause}
            onBlurCapture={onBlurCapture}
            // Translucent + blurred on purpose: the illustrated HeroBackground
            // tree should stay softly visible behind the card, not vanish
            // behind an opaque slab.
            className="rounded-xl border border-border-token bg-surface/70 p-3 shadow-sm backdrop-blur-[3px] sm:p-4"
        >
            <div className="grid gap-3 sm:grid-cols-[5fr_4fr]">
                <TaskApp />
                <TreePane />
            </div>
            <StatusLine />
        </div>
    );
}

function TaskApp() {
    const tasks = useNode(demo.tasks);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="min-w-0 rounded-lg border border-border-token bg-background/80 p-3"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-faint">
                    app
                </span>
                <RenderBadge renders={renders} />
            </div>
            <ul className="mt-2.5 space-y-1.5">
                {tasks.map((task, index) => (
                    <TaskRow
                        key={task.id}
                        task={task}
                        path={`tasks[${index}]`}
                    />
                ))}
            </ul>
            <div className="mt-2.5">
                <CountChip />
            </div>
        </div>
    );
}

/**
 * One task row, rendered recursively for subtasks. Each row subscribes to
 * its own node only, so a write to a deep leaf re-renders exactly that leaf
 * — the parent rows' counters don't move.
 */
function TaskRow({ task, path }: { task: HeroTask; path: string }) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <li>
            <div
                ref={ref}
                className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-2 py-1.5"
            >
                <input
                    type="checkbox"
                    checked={state.done}
                    onChange={() => {
                        state.done = !state.done;
                        takeOver(`${path}.done = ${String(state.done)}`);
                    }}
                    aria-label={`Toggle "${state.title}"`}
                    className="size-3.5 shrink-0 accent-accent"
                />
                <input
                    type="text"
                    value={state.title}
                    onChange={(event) => {
                        state.title = event.target.value;
                        takeOver(
                            `${path}.title = ${JSON.stringify(
                                event.target.value
                            )}`
                        );
                    }}
                    aria-label={`Title of ${path}`}
                    className={`min-w-0 flex-1 bg-transparent font-mono text-xs outline-none focus-visible:underline focus-visible:decoration-[var(--accent-glow)] ${
                        state.done
                            ? "text-faint line-through"
                            : "text-foreground"
                    }`}
                />
                <RenderBadge renders={renders} />
            </div>
            {state.subtasks.length > 0 ? (
                <ul className="ml-3 mt-1.5 space-y-1.5 border-l border-border-token pl-2.5">
                    {state.subtasks.map((subtask, index) => (
                        <TaskRow
                            key={subtask.id}
                            task={subtask}
                            path={`${path}.subtasks[${index}]`}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    );
}

function CountChip() {
    const stats = useNode(demo.stats);
    const { ref, renders } = useRenderGlow<HTMLButtonElement>();
    return (
        <button
            ref={ref}
            type="button"
            onClick={() => {
                stats.count += 1;
                takeOver(`stats.count = ${stats.count}`);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border-token bg-surface px-2 py-1.5 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
            count: <span className="text-foreground">{stats.count}</span>
            <span aria-hidden className="text-faint">
                +1
            </span>
            <RenderBadge renders={renders} />
        </button>
    );
}

function TreePane() {
    return (
        // min-w-0 lets the pane shrink to its grid track instead of letting
        // deep pills push it over the card's right padding; if a pill still
        // can't fit, it scrolls inside the pane rather than overflowing.
        <div className="min-w-0 rounded-lg border border-border-token bg-background/80 p-3">
            <span className="font-mono text-xs uppercase tracking-widest text-faint">
                state tree
            </span>
            <div className="mt-2.5 flex flex-col items-start gap-1.5 overflow-x-auto">
                <StateNodePill node={demo} label="root" showRenders />
                <div className="ml-1.5 flex flex-col items-start gap-1.5 border-l border-border-token pl-2.5">
                    <StateNodePill
                        node={demo.tasks}
                        label="tasks"
                        showRenders
                    />
                    <div className="ml-1.5 flex flex-col items-start gap-1.5 border-l border-border-token pl-2.5">
                        {demo.tasks.map((task, index) => (
                            <TaskPills
                                key={task.id}
                                task={task}
                                label={`tasks[${index}]`}
                            />
                        ))}
                    </div>
                    <StateNodePill
                        node={demo.stats}
                        label="stats"
                        showRenders
                    />
                </div>
            </div>
        </div>
    );
}

/**
 * A task's pill plus, recursively, its subtasks' pills — mirroring the
 * nesting of the state tree. Labels are path segments (`.subtasks[0]`);
 * the indentation shows where they hang.
 */
function TaskPills({ task, label }: { task: HeroTask; label: string }) {
    return (
        <>
            <StateNodePill node={task} label={label} showRenders />
            {task.subtasks.length > 0 ? (
                <div className="ml-1.5 flex flex-col items-start gap-1.5 border-l border-border-token pl-2.5">
                    {task.subtasks.map((subtask, index) => (
                        <TaskPills
                            key={subtask.id}
                            task={subtask}
                            label={`.subtasks[${index}]`}
                        />
                    ))}
                </div>
            ) : null}
        </>
    );
}

const MODE_LABELS: Record<HeroMode, string> = {
    auto: "auto-playing",
    paused: "paused",
    user: "live — yours",
    done: "auto-paused — try it",
};

function StatusLine() {
    const state = useNode(session);
    const reduceMotion = useReducedMotion();
    const line =
        state.lastLine === ""
            ? "// scripted mutations start in a moment"
            : state.lastLine;
    return (
        <p className="mt-3 flex min-w-0 items-center gap-2 font-mono text-[11px] text-faint">
            <span aria-hidden className="shrink-0 text-accent">
                »
            </span>
            <motion.span
                key={line}
                initial={reduceMotion ? false : { opacity: 0.35 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="truncate text-muted"
            >
                {line}
            </motion.span>
            <span className="ml-auto shrink-0 rounded border border-border-token px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                {MODE_LABELS[state.mode]}
            </span>
        </p>
    );
}
