"use client";

import { Retree } from "@retreejs/core";
import { useNode, useRaw, useSelect, useTree } from "@retreejs/react";
import {
    memo,
    useState,
    type ComponentType,
    type ReactNode,
    type RefObject,
} from "react";
import { RenderBadge } from "./RenderBadge";
import { StateNodePill } from "./StateNodePill";
import { useRenderGlow } from "./useRenderGlow";

/**
 * Hook playground for the /docs/react hooks index (spec §5.2).
 *
 * One shared Retree tree, four genuinely different subscription strategies
 * over the same UI. RenderBadge counters on every component are the canonical
 * evidence of which mode re-renders for which write.
 */

interface PlaygroundTask {
    title: string;
    done: boolean;
}

const project = Retree.root({
    title: "Launch checklist",
    tasks: [
        { title: "Write the docs", done: true },
        { title: "Ship the site", done: false },
    ] as PlaygroundTask[],
});

// Precise mutations. They live outside every component so no button click
// re-renders anything by itself — only subscriptions do.
let renameRevision = 0;
let addedTaskCount = 0;

function toggleTask(task: PlaygroundTask): void {
    task.done = !task.done;
}

function toggleFirstTask(): void {
    const task = project.tasks[0];
    if (task === undefined) return;
    toggleTask(task);
}

function renameFirstTask(): void {
    const task = project.tasks[0];
    if (task === undefined) return;
    renameRevision += 1;
    task.title = `Write the docs (rev ${renameRevision})`;
}

function addTask(): void {
    addedTaskCount += 1;
    project.tasks.push({ title: `New task ${addedTaskCount}`, done: false });
}

function resetPlayground(): void {
    renameRevision = 0;
    addedTaskCount = 0;
    project.tasks.splice(0, project.tasks.length);
    project.tasks.push(
        { title: "Write the docs", done: true },
        { title: "Ship the site", done: false }
    );
}

const MODES = ["useNode", "useTree", "useSelect", "useRaw"] as const;
type Mode = (typeof MODES)[number];

const CAPTIONS: Record<Mode, string> = {
    useNode:
        "useNode: the panel subscribes to the tasks array, each row to its own task — toggle and rename re-render one row; add re-renders the panel.",
    useTree:
        "useTree: subscribed to tasks and every descendant — toggle, rename, and add all re-render the panel and every row.",
    useSelect:
        "useSelect: the panel subscribes to one derived value — the remaining count — while each row keeps its own useNode. Toggle re-renders the row and the panel (the selection changed); rename re-renders just that row and never the panel.",
    useRaw: "useRaw: subscribed to the tasks array like useNode, but the panel reads raw (proxy-free) — add re-renders the panel; toggle and rename re-render one row via its useNode.",
};

/* ------------------------------------------------------------------ */
/* Shared presentational pieces                                        */
/* ------------------------------------------------------------------ */

function PanelShell({
    glowRef,
    renders,
    label,
    doneSummary,
    children,
}: {
    glowRef: RefObject<HTMLDivElement | null>;
    renders: number;
    label: string;
    doneSummary: string;
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
            <p className="mb-2 font-mono text-[11px] text-muted">
                {doneSummary}
            </p>
            <ul className="flex flex-col gap-1.5">{children}</ul>
        </div>
    );
}

function RowShell({
    glowRef,
    title,
    done,
    renders,
    onToggle,
}: {
    glowRef: RefObject<HTMLLIElement | null>;
    title: string;
    done: boolean;
    renders: number;
    onToggle: () => void;
}) {
    return (
        <li
            ref={glowRef}
            className="flex items-center justify-between gap-2 rounded-md border border-border-token bg-surface px-2.5 py-1.5"
        >
            <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={done} onChange={onToggle} />
                <span className="truncate">{title}</span>
            </label>
            <RenderBadge renders={renders} />
        </li>
    );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

/** Row with its own subscription — used by the useNode and useRaw modes. */
const SubscribedRow = memo(function SubscribedRow({
    task,
}: {
    task: PlaygroundTask;
}) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLLIElement>();
    return (
        <RowShell
            glowRef={ref}
            title={state.title}
            done={state.done}
            renders={renders}
            onToggle={() => toggleTask(state)}
        />
    );
});

/** Row with no subscription of its own — re-renders only with its parent. */
function PlainRow({ task }: { task: PlaygroundTask }) {
    const { ref, renders } = useRenderGlow<HTMLLIElement>();
    return (
        <RowShell
            glowRef={ref}
            title={task.title}
            done={task.done}
            renders={renders}
            onToggle={() => toggleTask(task)}
        />
    );
}

/* ------------------------------------------------------------------ */
/* One implementation per hook                                         */
/* ------------------------------------------------------------------ */

function NodeMode() {
    const tasks = useNode(project.tasks);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const doneCount = tasks.filter((task) => task.done).length;
    return (
        <PanelShell
            glowRef={ref}
            renders={renders}
            label="useNode(project.tasks)"
            doneSummary={`done: ${doneCount}/${tasks.length} (computed here — goes stale on toggle; that's a job for useSelect)`}
        >
            {tasks.map((task, index) => (
                <SubscribedRow key={index} task={task} />
            ))}
        </PanelShell>
    );
}

function TreeMode() {
    const tasks = useTree(project.tasks);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const doneCount = tasks.filter((task) => task.done).length;
    return (
        <PanelShell
            glowRef={ref}
            renders={renders}
            label="useTree(project.tasks)"
            doneSummary={`done: ${doneCount}/${tasks.length} (always fresh — every descendant change re-renders this panel)`}
        >
            {tasks.map((task, index) => (
                <PlainRow key={index} task={task} />
            ))}
        </PanelShell>
    );
}

function SelectMode() {
    // A live projection over the subtree: the selector reads every task's
    // `done` (listenerType: "treeChanged"), but the panel re-renders only
    // when the selected number itself changes.
    const remaining = useSelect(
        project.tasks,
        (tasks) => tasks.filter((task) => !task.done).length,
        { listenerType: "treeChanged" }
    );
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <PanelShell
            glowRef={ref}
            renders={renders}
            label="useSelect(project.tasks, remaining)"
            doneSummary={`remaining: ${remaining} (the selected value — the only change that re-renders this panel)`}
        >
            {project.tasks.map((task, index) => (
                <SubscribedRow key={index} task={task} />
            ))}
        </PanelShell>
    );
}

function RawMode() {
    const [rawTasks, toManaged] = useRaw(project.tasks);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const doneCount = rawTasks.filter((task) => task.done).length;
    return (
        <PanelShell
            glowRef={ref}
            renders={renders}
            label="useRaw(project.tasks)"
            doneSummary={`done: ${doneCount}/${rawTasks.length} (read from raw — proxy-free)`}
        >
            {rawTasks.map((rawTask, index) => {
                const task = toManaged(rawTask);
                if (task === undefined) return null;
                return <SubscribedRow key={index} task={task} />;
            })}
        </PanelShell>
    );
}

const MODE_COMPONENTS: Record<Mode, ComponentType> = {
    useNode: NodeMode,
    useTree: TreeMode,
    useSelect: SelectMode,
    useRaw: RawMode,
};

/* ------------------------------------------------------------------ */
/* Schematic subscription-boundary tree                                */
/* ------------------------------------------------------------------ */

function Boundary({
    active,
    dashed = false,
    children,
}: {
    active: boolean;
    dashed?: boolean;
    children: ReactNode;
}) {
    let borderClass = "border-transparent";
    if (active && dashed) {
        borderClass = "border-dashed border-accent-glow";
    } else if (active) {
        borderClass = "border-accent-glow";
    }
    return (
        <div className={`w-fit rounded-lg border p-0.5 ${borderClass}`}>
            {children}
        </div>
    );
}

const LEGENDS: Record<Mode, string> = {
    useNode:
        "boundary: nodeChanged subscription on tasks, plus one per row task",
    useTree: "boundary: treeChanged subscription — tasks and every descendant",
    useSelect:
        "dashed boundary: the selector listens across the subtree (treeChanged) but re-renders the panel only when the remaining count changes; solid row boundaries: each row's own useNode",
    useRaw: "boundary: nodeChanged subscription on tasks (read raw), plus one per row task via useNode",
};

function SchematicTree({ mode }: { mode: Mode }) {
    // Subscribes to the list so newly added tasks get pills.
    const tasks = useNode(project.tasks);
    const listBoundary = mode === "useNode" || mode === "useRaw";
    const rowBoundary = mode !== "useTree";
    const subtreeBoundary = mode === "useTree" || mode === "useSelect";
    const subtreeDashed = mode === "useSelect";
    return (
        <div>
            <p className="mb-1.5 font-mono text-xs uppercase tracking-widest text-faint">
                Subscription boundary
            </p>
            <div className="flex flex-col gap-1">
                <StateNodePill node={project} label="project" />
                <div className="pl-4">
                    <Boundary active={subtreeBoundary} dashed={subtreeDashed}>
                        <div className="flex flex-col gap-1">
                            <Boundary active={listBoundary}>
                                <StateNodePill node={tasks} label="tasks" />
                            </Boundary>
                            <div className="flex flex-col gap-1 pl-4">
                                {tasks.map((task, index) => (
                                    <Boundary key={index} active={rowBoundary}>
                                        <StateNodePill
                                            node={task}
                                            label={`tasks[${index}]`}
                                        />
                                    </Boundary>
                                ))}
                            </div>
                        </div>
                    </Boundary>
                </div>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{LEGENDS[mode]}</p>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Playground shell                                                    */
/* ------------------------------------------------------------------ */

const ACTION_BUTTON_CLASS =
    "rounded-md border border-border-token bg-surface px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow";

export function HookPlayground() {
    const [mode, setMode] = useState<Mode>("useNode");
    const ActiveMode = MODE_COMPONENTS[mode];
    return (
        <section
            aria-label="Hook playground"
            className="my-6 rounded-xl border border-border-token bg-surface p-3 sm:p-4"
        >
            <div
                role="group"
                aria-label="Hook mode"
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
                                    ? "rounded-md border border-accent-glow bg-surface-raised px-2.5 py-1.5 font-mono text-xs text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-glow"
                                    : ACTION_BUTTON_CLASS
                            }
                        >
                            {candidate}
                        </button>
                    );
                })}
            </div>
            <p aria-live="polite" className="mt-3 text-sm leading-6 text-muted">
                {CAPTIONS[mode]}
            </p>
            <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div>
                    {/* key remounts the implementation so counters restart per mode */}
                    <ActiveMode key={mode} />
                    <div
                        role="group"
                        aria-label="Mutations"
                        className="mt-3 flex flex-wrap gap-1.5"
                    >
                        <button
                            type="button"
                            onClick={toggleFirstTask}
                            className={ACTION_BUTTON_CLASS}
                        >
                            toggle tasks[0].done
                        </button>
                        <button
                            type="button"
                            onClick={renameFirstTask}
                            className={ACTION_BUTTON_CLASS}
                        >
                            rename tasks[0].title
                        </button>
                        <button
                            type="button"
                            onClick={addTask}
                            className={ACTION_BUTTON_CLASS}
                        >
                            add task
                        </button>
                        <button
                            type="button"
                            onClick={resetPlayground}
                            className={ACTION_BUTTON_CLASS}
                        >
                            reset
                        </button>
                    </div>
                </div>
                <SchematicTree mode={mode} />
            </div>
        </section>
    );
}
