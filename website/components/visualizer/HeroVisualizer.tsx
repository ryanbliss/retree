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
}

/**
 * The hero demo's state — a real Retree tree (`@retreejs/core` from this
 * repo), mutated with plain assignments. Nothing here is simulated.
 */
const demo = Retree.root({
    tasks: [
        { id: 1, title: "Ship the quickstart", done: false },
        { id: 2, title: "Write tests", done: true },
        { id: 3, title: "Cut a release", done: false },
    ] as HeroTask[],
    stats: { count: 0 },
});

type HeroMode = "auto" | "paused" | "user";

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

/** One scripted mutation per tick, rotating: toggle → retitle → count. */
function runScriptStep(): void {
    const phase = scriptStep % 3;
    const round = Math.floor(scriptStep / 3);
    scriptStep += 1;

    if (phase === 0) {
        const index = round % demo.tasks.length;
        const task = demo.tasks[index];
        task.done = !task.done;
        session.lastLine = `tasks[${index}].done = ${String(task.done)}`;
        return;
    }
    if (phase === 1) {
        const title = SCRIPT_TITLES[round % SCRIPT_TITLES.length];
        demo.tasks[1].title = title;
        session.lastLine = `tasks[1].title = ${JSON.stringify(title)}`;
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
            if (session.mode === "user") {
                if (interval !== undefined) {
                    window.clearInterval(interval);
                    interval = undefined;
                }
                return;
            }
            if (session.mode === "paused") return;
            runScriptStep();
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
            className="rounded-xl border border-border-token bg-surface p-3 shadow-sm sm:p-4"
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
            className="rounded-lg border border-border-token bg-background p-3"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-faint">
                    app
                </span>
                <RenderBadge renders={renders} />
            </div>
            <ul className="mt-2.5 space-y-1.5">
                {tasks.map((task, index) => (
                    <TaskRow key={task.id} task={task} index={index} />
                ))}
            </ul>
            <div className="mt-2.5">
                <CountChip />
            </div>
        </div>
    );
}

function TaskRow({ task, index }: { task: HeroTask; index: number }) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLLIElement>();
    return (
        <li
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-2 py-1.5"
        >
            <input
                type="checkbox"
                checked={state.done}
                onChange={() => {
                    state.done = !state.done;
                    takeOver(`tasks[${index}].done = ${String(state.done)}`);
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
                        `tasks[${index}].title = ${JSON.stringify(
                            event.target.value
                        )}`
                    );
                }}
                aria-label={`Title of task ${index + 1}`}
                className={`min-w-0 flex-1 bg-transparent font-mono text-xs outline-none focus-visible:underline focus-visible:decoration-[var(--accent-glow)] ${
                    state.done ? "text-faint line-through" : "text-foreground"
                }`}
            />
            <RenderBadge renders={renders} />
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
        <div className="rounded-lg border border-border-token bg-background p-3">
            <span className="font-mono text-xs uppercase tracking-widest text-faint">
                state tree
            </span>
            <div className="mt-2.5 flex flex-col items-start gap-1.5">
                <StateNodePill node={demo} label="root" showRenders />
                <div className="ml-2.5 flex flex-col items-start gap-1.5 border-l border-border-token pl-3">
                    <StateNodePill
                        node={demo.tasks}
                        label="tasks"
                        showRenders
                    />
                    <div className="ml-2.5 flex flex-col items-start gap-1.5 border-l border-border-token pl-3">
                        {demo.tasks.map((task, index) => (
                            <StateNodePill
                                key={task.id}
                                node={task}
                                label={`tasks[${index}]`}
                                showRenders
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

const MODE_LABELS: Record<HeroMode, string> = {
    auto: "auto-playing",
    paused: "paused",
    user: "live — yours",
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
