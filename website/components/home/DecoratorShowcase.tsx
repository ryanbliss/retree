"use client";

import { ReactiveNode, Retree, ignore, memo, select } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import {
    memo as reactMemo,
    useEffect,
    useState,
    type ComponentType,
    type ReactNode,
    type RefObject,
} from "react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";
import {
    DemoLog,
    clearDemoLog,
    createDemoLog,
    pushDemoLog,
} from "@/components/visualizer/DemoLog";
import {
    AutoplayStatusChip,
    createAutoplaySession,
    takeOver,
    useScriptedAutoplay,
} from "@/components/visualizer/scriptedAutoplay";
import { DemoButton } from "./DemoButton";

/**
 * Interactive ReactiveNode + decorator showcase for the home page.
 *
 * Same pattern as the /docs/react HookPlayground: mode buttons, a one-line
 * caption of the rule, a live demo with render counters, and the exact code
 * that is running (server-rendered CodeBlocks passed in from page.tsx).
 * Every example is grounded in the repo README's ReactiveNode section.
 */

const MODES = ["dependencies", "@select", "@memo", "@ignore"] as const;
export type DecoratorShowcaseMode = (typeof MODES)[number];

export interface DecoratorShowcaseProps {
    /**
     * Server-rendered <CodeBlock> per mode. Each block must show exactly the
     * code its live demo runs — keep them in sync with the classes below.
     */
    codeBlocks: Record<DecoratorShowcaseMode, ReactNode>;
}

const CAPTIONS: Record<DecoratorShowcaseMode, string> = {
    dependencies:
        "Dependencies allow a node to observe changes from other Retree-managed nodes while filtering out irrelevant changes. In the below example, the counter subscribes to its numbers array but only emits changes when an even number is added.",
    "@select":
        "@select automatically traps reads within the function to figure out what state to observe. If the function response changes compared to the prior run, the node emits a change. These are additive to other dependencies in your ReactiveNode.",
    "@memo":
        "@memo caches the getter and traps reads within the function. When any of the getter's dependencies change, the cache invalidates and the getter will recompute on next access.",
    "@ignore":
        "@ignore opts a field out of emission. Writing to @ignore variables never triggers a re-render or change event.",
};

/* ------------------------------------------------------------------ */
/* dependencies — the README EvenCounter example, live                  */
/* ------------------------------------------------------------------ */

class EvenCounter extends ReactiveNode {
    public numbers: number[] = [];

    get evenCount(): number {
        return this.numbers.filter((value) => value % 2 === 0).length;
    }

    get dependencies() {
        // Subscribe to the numbers array, but emit only when the compared
        // value — evenCount — actually changes.
        return [this.dependency(this.numbers, [this.evenCount])];
    }
}

const counter = Retree.root(new EvenCounter());

/** One shared log for the showcase — cleared whenever the mode changes. */
const showcaseLog = createDemoLog();

function pushEven(): void {
    counter.numbers.push(2);
    pushDemoLog(
        showcaseLog,
        "numbers.push(2)",
        true,
        `evenCount → ${counter.evenCount}, badge re-rendered`
    );
}

function pushOdd(): void {
    counter.numbers.push(3);
    pushDemoLog(
        showcaseLog,
        "numbers.push(3)",
        false,
        "evenCount unchanged — badge quiet"
    );
}

function resetCounter(): void {
    const evensBefore = counter.evenCount;
    counter.numbers.splice(0, counter.numbers.length);
    const changed = evensBefore > 0;
    pushDemoLog(
        showcaseLog,
        "numbers.splice(0)",
        changed,
        changed ? "evenCount → 0" : "no evens dropped — badge quiet"
    );
}

/* ------------------------------------------------------------------ */
/* @select — a getter that emits only when its selection changes        */
/* ------------------------------------------------------------------ */

interface ShowcaseTask {
    title: string;
    done: boolean;
}

function initialBoardTasks(): ShowcaseTask[] {
    return [
        { title: "Write the docs", done: true },
        { title: "Ship the site", done: false },
    ];
}

class TaskBoard extends ReactiveNode {
    public tasks: ShowcaseTask[] = initialBoardTasks();

    // Traps the reads inside the getter — the board emits nodeChanged only
    // when the selected dependencies (each task's `done`) change.
    @select
    get doneCount(): number {
        return this.tasks.filter((task) => task.done).length;
    }

    get dependencies() {
        return [];
    }
}

const board = Retree.root(new TaskBoard());

let renameRevision = 0;

function toggleFirstTask(): void {
    const task = board.tasks[0];
    if (task === undefined) return;
    task.done = !task.done;
    pushDemoLog(
        showcaseLog,
        `tasks[0].done = ${String(task.done)}`,
        true,
        `doneCount → ${board.doneCount}, board emitted`
    );
}

function renameFirstTask(): void {
    const task = board.tasks[0];
    if (task === undefined) return;
    renameRevision += 1;
    task.title = `Write the docs (rev ${renameRevision})`;
    pushDemoLog(
        showcaseLog,
        `tasks[0].title = "… rev ${renameRevision}"`,
        false,
        "board silent — only the row re-rendered"
    );
}

function resetBoard(): void {
    renameRevision = 0;
    board.tasks.splice(0, board.tasks.length, ...initialBoardTasks());
    pushDemoLog(
        showcaseLog,
        "tasks reset",
        true,
        `doneCount → ${board.doneCount}`
    );
}

/* ------------------------------------------------------------------ */
/* @memo — cached computed getter with a compute counter                */
/* ------------------------------------------------------------------ */

let filterComputations = 0;

class CardFilter extends ReactiveNode {
    public cards: { text: string }[] = [
        { text: "alpha" },
        { text: "beta" },
        { text: "alphabet" },
    ];
    public searchText = "alpha";
    public label = "cards"; // unrelated to the memoized getter

    @memo
    get filtered(): { text: string }[] {
        filterComputations += 1; // instrumentation shown in the demo
        return this.cards.filter((card) => card.text.includes(this.searchText));
    }

    get dependencies() {
        return [];
    }
}

const filter = Retree.root(new CardFilter());

function touchUnrelatedLabel(): void {
    filter.label = filter.label === "cards" ? "cards (touched)" : "cards";
    pushDemoLog(
        showcaseLog,
        `label = ${JSON.stringify(filter.label)}`,
        false,
        "re-rendered on a cache hit — getter didn't run"
    );
}

function toggleSearchText(): void {
    filter.searchText = filter.searchText === "alpha" ? "beta" : "alpha";
    pushDemoLog(
        showcaseLog,
        `searchText = ${JSON.stringify(filter.searchText)}`,
        true,
        "cache invalidated — getter recomputes once"
    );
}

/* ------------------------------------------------------------------ */
/* @ignore — writes to an ignored field don't emit                      */
/* ------------------------------------------------------------------ */

class Draft extends ReactiveNode {
    public count = 0;

    // Reads and writes still work — listener emission is skipped.
    @ignore public scratch: { writes: number } = { writes: 0 };

    get dependencies() {
        return [];
    }
}

const draft = Retree.root(new Draft());

function writeScratch(): void {
    draft.scratch.writes += 1;
    pushDemoLog(
        showcaseLog,
        `scratch.writes = ${draft.scratch.writes}`,
        false,
        "@ignore — no emission, nothing re-rendered"
    );
}

function incrementCount(): void {
    draft.count += 1;
    pushDemoLog(
        showcaseLog,
        `count = ${draft.count}`,
        true,
        "panel re-rendered — and caught up on scratch"
    );
}

function resetDraft(): void {
    draft.scratch.writes = 0;
    draft.count = 0;
    pushDemoLog(showcaseLog, "reset()", true, "count and scratch back to 0");
}

/* ------------------------------------------------------------------ */
/* Ambient tick — hero convention                                      */
/* ------------------------------------------------------------------ */

/*
 * A slow scripted mutation keeps the active mode's counters gently
 * accumulating (offset from StickyBoardDemo's cadence so the page never
 * pulses in lockstep). Hover/focus pauses it; the first real click on a
 * mutation stops it for good.
 */

const autoplaySession = createAutoplaySession();

let autoplayStep = 0;

/** The mode whose demo is on screen — mirrored from component state. */
let activeAutoplayMode: DecoratorShowcaseMode = "dependencies";

function runAutoplayStep(): void {
    const step = autoplayStep;
    autoplayStep += 1;
    switch (activeAutoplayMode) {
        case "dependencies": {
            // Keep the demo array tidy: after a handful of scripted pushes,
            // the next tick resets it (a real, visible splice).
            if (counter.numbers.length >= 8) {
                resetCounter();
                return;
            }
            if (step % 2 === 0) {
                pushEven();
            } else {
                pushOdd();
            }
            return;
        }
        case "@select": {
            if (step % 2 === 0) {
                toggleFirstTask();
            } else {
                renameFirstTask();
            }
            return;
        }
        case "@memo": {
            if (step % 2 === 0) {
                touchUnrelatedLabel();
            } else {
                toggleSearchText();
            }
            return;
        }
        case "@ignore": {
            // Two silent scratch writes, then a count bump so the panel
            // visibly catches up on them.
            if (step % 3 === 2) {
                incrementCount();
            } else {
                writeScratch();
            }
            return;
        }
    }
}

/** A real interaction: stop the ambient tick permanently. */
function userMutation(mutate: () => void): () => void {
    return () => {
        takeOver(autoplaySession, "");
        mutate();
    };
}

/** Unmount cleanup: back-navigation must start from a clean slate. */
function handleShowcaseUnmount(): void {
    autoplayStep = 0;
    activeAutoplayMode = "dependencies";
    resetCounter();
    resetBoard();
    resetDraft();
    filter.label = "cards";
    filter.searchText = "alpha";
    clearDemoLog(showcaseLog);
}

/* ------------------------------------------------------------------ */
/* Shared presentational pieces                                        */
/* ------------------------------------------------------------------ */

function DemoPanel({
    glowRef,
    renders,
    label,
    children,
}: {
    glowRef: RefObject<HTMLDivElement | null>;
    renders: number;
    label: string;
    children: ReactNode;
}) {
    return (
        <div
            ref={glowRef}
            className="rounded-lg border border-border-token bg-surface-raised p-3"
        >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    {label}
                </span>
                <RenderBadge renders={renders} />
            </div>
            {children}
        </div>
    );
}

function MutationRow({ children }: { children: ReactNode }) {
    return (
        <div
            role="group"
            aria-label="Mutations"
            className="flex flex-wrap gap-1.5"
        >
            {children}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* One live demo per mode                                              */
/* ------------------------------------------------------------------ */

/** Directly subscribed to the numbers array — re-renders on every push. */
function NumbersStrip() {
    const numbers = useNode(counter.numbers);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <DemoPanel
            glowRef={ref}
            renders={renders}
            label="useNode(counter.numbers) — direct subscription"
        >
            <p className="font-mono text-xs text-muted">
                [{numbers.join(", ")}]
            </p>
        </DemoPanel>
    );
}

function DependenciesMode() {
    const state = useNode(counter);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div className="flex h-full flex-col gap-2">
            <DemoPanel
                glowRef={ref}
                renders={renders}
                label="useNode(counter) — gated by dependencies"
            >
                <p className="font-mono text-xs text-muted">
                    evenCount:{" "}
                    <span className="font-semibold text-accent">
                        {state.evenCount}
                    </span>
                </p>
                <p className="mt-1 text-xs text-faint">
                    numbers as of this panel&apos;s last render: [
                    {state.numbers.join(", ")}]
                </p>
            </DemoPanel>
            <NumbersStrip />
            <MutationRow>
                <DemoButton onClick={userMutation(pushEven)}>
                    numbers.push(2) — even
                </DemoButton>
                <DemoButton onClick={userMutation(pushOdd)}>
                    numbers.push(3) — odd
                </DemoButton>
                <DemoButton onClick={userMutation(resetCounter)}>
                    reset
                </DemoButton>
            </MutationRow>
            <DemoLog log={showcaseLog} className="flex-1" />
        </div>
    );
}

/** Row with its own subscription — rename re-renders this, not the board. */
const BoardRow = reactMemo(function BoardRow({
    task,
    index,
}: {
    task: ShowcaseTask;
    index: number;
}) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLLIElement>();
    return (
        <li
            ref={ref}
            className="flex items-center justify-between gap-2 rounded-md border border-border-token bg-surface px-2.5 py-1.5"
        >
            <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
                <input
                    type="checkbox"
                    checked={state.done}
                    onChange={() => {
                        takeOver(autoplaySession, "");
                        state.done = !state.done;
                        // Checkbox toggles are the natural interaction here —
                        // they must feed the write log just like the buttons.
                        pushDemoLog(
                            showcaseLog,
                            `tasks[${index}].done = ${String(state.done)}`,
                            true,
                            `doneCount → ${board.doneCount}, board emitted`
                        );
                    }}
                />
                <span className="truncate">{state.title}</span>
            </label>
            <RenderBadge renders={renders} />
        </li>
    );
});

function SelectMode() {
    const state = useNode(board);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div className="flex h-full flex-col gap-2">
            <DemoPanel
                glowRef={ref}
                renders={renders}
                label="useNode(board) — emits when doneCount changes"
            >
                <p className="mb-2 font-mono text-xs text-muted">
                    doneCount:{" "}
                    <span className="font-semibold text-accent">
                        {state.doneCount}
                    </span>
                    /{state.tasks.length}
                </p>
                <ul className="flex flex-col gap-1.5">
                    {state.tasks.map((task, index) => (
                        <BoardRow key={index} task={task} index={index} />
                    ))}
                </ul>
            </DemoPanel>
            <MutationRow>
                <DemoButton onClick={userMutation(toggleFirstTask)}>
                    toggle tasks[0].done
                </DemoButton>
                <DemoButton onClick={userMutation(renameFirstTask)}>
                    rename tasks[0].title
                </DemoButton>
                <DemoButton onClick={userMutation(resetBoard)}>
                    reset
                </DemoButton>
            </MutationRow>
            <DemoLog log={showcaseLog} className="flex-1" />
        </div>
    );
}

function MemoMode() {
    const state = useNode(filter);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const filtered = state.filtered;
    return (
        <div className="flex h-full flex-col gap-2">
            <DemoPanel
                glowRef={ref}
                renders={renders}
                label="useNode(filter) — @memo get filtered"
            >
                <p className="font-mono text-xs text-muted">
                    searchText: &quot;{state.searchText}&quot; · label: &quot;
                    {state.label}&quot;
                </p>
                <p className="mt-1 font-mono text-xs text-muted">
                    filtered: [{filtered.map((card) => card.text).join(", ")}]
                </p>
                <p className="mt-1 font-mono text-xs text-faint">
                    getter ran{" "}
                    <span className="font-semibold text-accent">
                        {filterComputations}×
                    </span>{" "}
                    since page load
                </p>
            </DemoPanel>
            <MutationRow>
                <DemoButton onClick={userMutation(touchUnrelatedLabel)}>
                    set label — unrelated field
                </DemoButton>
                <DemoButton onClick={userMutation(toggleSearchText)}>
                    toggle searchText
                </DemoButton>
            </MutationRow>
            <DemoLog log={showcaseLog} className="flex-1" />
        </div>
    );
}

function IgnoreMode() {
    const state = useNode(draft);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div className="flex h-full flex-col gap-2">
            <DemoPanel
                glowRef={ref}
                renders={renders}
                label="useNode(draft) — scratch is @ignore"
            >
                <p className="font-mono text-xs text-muted">
                    count:{" "}
                    <span className="font-semibold text-accent">
                        {state.count}
                    </span>
                </p>
                <p className="mt-1 text-xs text-faint">
                    scratch.writes as of this panel&apos;s last render:{" "}
                    {state.scratch.writes}
                </p>
            </DemoPanel>
            <MutationRow>
                <DemoButton onClick={userMutation(writeScratch)}>
                    scratch.writes += 1 (@ignore)
                </DemoButton>
                <DemoButton onClick={userMutation(incrementCount)}>
                    count += 1
                </DemoButton>
                <DemoButton onClick={userMutation(resetDraft)}>
                    reset
                </DemoButton>
            </MutationRow>
            <DemoLog log={showcaseLog} className="flex-1" />
        </div>
    );
}

const MODE_COMPONENTS: Record<DecoratorShowcaseMode, ComponentType> = {
    dependencies: DependenciesMode,
    "@select": SelectMode,
    "@memo": MemoMode,
    "@ignore": IgnoreMode,
};

/* ------------------------------------------------------------------ */
/* Showcase shell                                                      */
/* ------------------------------------------------------------------ */

const MODE_BUTTON_CLASS =
    "rounded-md border border-border-token bg-surface px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow";

const MODE_BUTTON_ACTIVE_CLASS =
    "rounded-md border border-accent-glow bg-surface-raised px-2.5 py-1.5 font-mono text-xs text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow";

export function DecoratorShowcase({ codeBlocks }: DecoratorShowcaseProps) {
    const [mode, setMode] = useState<DecoratorShowcaseMode>("dependencies");
    const ActiveMode = MODE_COMPONENTS[mode];

    // The ambient tick mutates whichever demo is on screen; switching modes
    // retargets it without counting as a take-over. The write log restarts
    // per mode — stale entries from another decorator would only mislead.
    useEffect(() => {
        activeAutoplayMode = mode;
        clearDemoLog(showcaseLog);
    }, [mode]);

    const pauseHandlers = useScriptedAutoplay({
        session: autoplaySession,
        intervalMs: 7500,
        initialDelayMs: 3800,
        step: runAutoplayStep,
        maxSteps: 8,
        onUnmount: handleShowcaseUnmount,
    });

    return (
        <section
            aria-label="ReactiveNode and decorators showcase"
            {...pauseHandlers}
            className="rounded-xl border border-border-token bg-surface p-3 sm:p-4"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                    role="group"
                    aria-label="Decorator mode"
                    className="flex flex-wrap gap-1.5"
                >
                    {MODES.map((candidate) => {
                        const isActive = candidate === mode;
                        return (
                            <button
                                key={candidate}
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => setMode(candidate)}
                                className={
                                    isActive
                                        ? MODE_BUTTON_ACTIVE_CLASS
                                        : MODE_BUTTON_CLASS
                                }
                            >
                                {candidate}
                            </button>
                        );
                    })}
                </div>
                <AutoplayStatusChip session={autoplaySession} />
            </div>
            <p aria-live="polite" className="mt-3 text-sm leading-6 text-muted">
                {CAPTIONS[mode]}
            </p>
            {/* items-stretch (the default): the demo column matches the code
             * block's height, with each mode's DemoLog soaking up the rest. */}
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div className="min-w-0 [&>figure]:my-0">
                    {codeBlocks[mode]}
                </div>
                <div className="min-w-0">
                    {/* key remounts the demo so render counters restart per mode */}
                    <ActiveMode key={mode} />
                </div>
            </div>
        </section>
    );
}
