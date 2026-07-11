"use client";

import { memo, useCallback, useState, type ReactNode } from "react";
import { Retree } from "@retreejs/core";
import { useNode, useSelect } from "@retreejs/react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";

interface CompareTask {
    id: number;
    title: string;
    done: boolean;
}

const INITIAL_TASKS: readonly CompareTask[] = [
    { id: 1, title: "Write the docs", done: true },
    { id: 2, title: "Review the PR", done: false },
    { id: 3, title: "Ship the release", done: false },
];

/** Each pane gets its own copies so the two stores never share objects. */
function initialTasks(): CompareTask[] {
    return INITIAL_TASKS.map((task) => ({ ...task }));
}

/**
 * Side-by-side render-counter comparison (spec §3.1.3/§5.1): the same
 * three-task app on an idiomatic top-level `useState` store and on Retree
 * `useNode`. Both sides are real, unthrottled implementations — the
 * comparison-side source is shown unabridged in the disclosure below the
 * demo so it can be audited.
 */
export function CompareVisualizer() {
    return (
        <div className="grid gap-4 md:grid-cols-2">
            <Pane
                title="idiomatic top-level store"
                caption="One useState object, immutable updates, React.memo rows."
            >
                <StoreApp />
            </Pane>
            <Pane
                title="Retree useNode"
                caption="Same UI. Each row subscribes to its own node."
            >
                <RetreeApp />
            </Pane>
        </div>
    );
}

function Pane({
    title,
    caption,
    children,
}: {
    title: string;
    caption: string;
    children: ReactNode;
}) {
    return (
        <div className="rounded-xl border border-border-token bg-surface p-3 sm:p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                {title}
            </p>
            <p className="mt-1 text-xs text-muted">{caption}</p>
            <div className="mt-3">{children}</div>
        </div>
    );
}

/* ------------------- idiomatic top-level store ------------------- */

const StoreRow = memo(function StoreRow({
    task,
    onToggle,
}: {
    task: CompareTask;
    onToggle: (id: number) => void;
}) {
    const { ref, renders } = useRenderGlow<HTMLLIElement>();
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
            <RenderBadge renders={renders} />
        </li>
    );
});

function StoreApp() {
    const [store, setStore] = useState(() => ({ tasks: initialTasks() }));
    const { ref, renders } = useRenderGlow<HTMLDivElement>();

    const toggle = useCallback((id: number) => {
        setStore((previous) => ({
            ...previous,
            tasks: previous.tasks.map((task) =>
                task.id === id ? { ...task, done: !task.done } : task
            ),
        }));
    }, []);

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
                <RenderBadge renders={renders} />
            </div>
            <ul className="mt-2 space-y-1.5">
                {store.tasks.map((task) => (
                    <StoreRow key={task.id} task={task} onToggle={toggle} />
                ))}
            </ul>
            <p className="mt-2 font-mono text-[11px] text-muted">
                done: {doneCount}/{store.tasks.length}
                <span className="ml-2 text-faint">
                    computed here, in {"<App />"}
                </span>
            </p>
        </div>
    );
}

/* --------------------------- Retree side --------------------------- */

const compareTree = Retree.root({ tasks: initialTasks() });

function RetreeRow({ task }: { task: CompareTask }) {
    const state = useNode(task);
    const { ref, renders } = useRenderGlow<HTMLLIElement>();
    return (
        <li
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-background px-2 py-1.5"
        >
            <input
                type="checkbox"
                checked={state.done}
                onChange={() => (state.done = !state.done)}
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
            <RenderBadge renders={renders} />
        </li>
    );
}

function RetreeDoneCount() {
    const doneCount = useSelect(
        compareTree.tasks,
        (tasks) => tasks.filter((task) => task.done).length,
        { listenerType: "treeChanged" }
    );
    const { ref, renders } = useRenderGlow<HTMLSpanElement>();
    return (
        <span ref={ref} className="inline-flex items-center gap-2">
            done: {doneCount}/{compareTree.tasks.length}
            <span className="text-faint">useSelect</span>
            <RenderBadge renders={renders} />
        </span>
    );
}

function RetreeApp() {
    const tasks = useNode(compareTree.tasks);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="rounded-lg border border-border-token bg-background p-2.5"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    {"<App />"}
                </span>
                <RenderBadge renders={renders} />
            </div>
            <ul className="mt-2 space-y-1.5">
                {tasks.map((task) => (
                    <RetreeRow key={task.id} task={task} />
                ))}
            </ul>
            <p className="mt-2 font-mono text-[11px] text-muted">
                <RetreeDoneCount />
            </p>
        </div>
    );
}
