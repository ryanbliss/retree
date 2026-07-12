"use client";

/**
 * The "idiomatic top-level store" side of the comparative visualizer.
 *
 * This is written the way a careful React developer would write it — one
 * useState store at the top, immutable updates, stable callbacks via
 * useCallback, and React.memo on every child — NOT a strawman. Memoization
 * keeps untouched rows quiet; the store owner still re-renders on every
 * update because the store lives in its state.
 *
 * Both implementations render side by side, and every interaction is
 * mirrored: local inputs call `mirror.*`, which applies the same logical
 * change to BOTH stores (this one via the setStore updaters registered
 * below). The store itself stays a plain useState store.
 *
 * The useRenderProbe(...) lines are shared instrumentation (render counter,
 * glow, diagram mirroring) and are identical on the Retree side.
 */

import { memo, useCallback, useEffect, useState } from "react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import {
    createProbeSet,
    useRenderProbe,
    type DemoMirror,
} from "@/components/compare/renderProbes";

export const reactProbes = createProbeSet();

interface Task {
    id: number;
    title: string;
    done: boolean;
}

interface Store {
    listName: string;
    tasks: Task[];
}

const initialStore: Store = {
    listName: "Launch checklist",
    tasks: [
        { id: 1, title: "Write the docs", done: true },
        { id: 2, title: "Add more tests", done: false },
        { id: 3, title: "Ship the release", done: false },
    ],
};

const NameInput = memo(function NameInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const { ref, renders } = useRenderProbe<HTMLDivElement>(reactProbes.name);
    return (
        <div
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-3 py-2"
        >
            <label
                htmlFor="react-demo-list-name"
                className="font-mono text-[11px] uppercase tracking-widest text-faint"
            >
                Name
            </label>
            <input
                id="react-demo-list-name"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            />
            <RenderBadge renders={renders} />
        </div>
    );
});

const TaskRow = memo(function TaskRow({
    task,
    onToggle,
}: {
    task: Task;
    onToggle: (id: number) => void;
}) {
    const { ref, renders } = useRenderProbe<HTMLLIElement>(
        reactProbes.rows[task.id - 1]
    );
    return (
        <li
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-3 py-2"
        >
            <input
                id={`react-demo-task-${task.id}`}
                type="checkbox"
                checked={task.done}
                onChange={() => onToggle(task.id)}
                className="accent-[var(--accent-glow)]"
            />
            <label
                htmlFor={`react-demo-task-${task.id}`}
                className="flex-1 cursor-pointer text-sm text-foreground"
            >
                {task.title}
            </label>
            <RenderBadge renders={renders} />
        </li>
    );
});

const DoneCount = memo(function DoneCount({ tasks }: { tasks: Task[] }) {
    const { ref, renders } = useRenderProbe<HTMLParagraphElement>(
        reactProbes.done
    );
    const doneCount = tasks.filter((task) => task.done).length;
    return (
        <p
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-3 py-2 text-sm text-muted"
        >
            <span className="flex-1">
                {doneCount} of {tasks.length} done
            </span>
            <RenderBadge renders={renders} />
        </p>
    );
});

export function ReactTasksDemo({ mirror }: { mirror: DemoMirror }) {
    const [store, setStore] = useState(initialStore);
    const { ref, renders } = useRenderProbe<HTMLDivElement>(reactProbes.app);

    // The two write paths of this store — ordinary useState updaters.
    const applyListName = useCallback((listName: string) => {
        setStore((current) => ({ ...current, listName }));
    }, []);

    const applyToggle = useCallback((id: number) => {
        setStore((current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
                task.id === id ? { ...task, done: !task.done } : task
            ),
        }));
    }, []);

    // Register the write paths so interactions started in EITHER pane land
    // in this store too — that keeps the two implementations comparable.
    useEffect(() => {
        return mirror.register("react", {
            setListName: applyListName,
            toggleTask: applyToggle,
        });
    }, [mirror, applyListName, applyToggle]);

    // Local inputs go through the mirror so the other pane sees them too.
    const setListName = useCallback(
        (listName: string) => mirror.setListName(listName),
        [mirror]
    );
    const toggleTask = useCallback(
        (id: number) => mirror.toggleTask(id),
        [mirror]
    );

    return (
        <div ref={ref} className="space-y-2 rounded-lg p-1">
            <header className="flex items-center gap-2 px-1">
                <span className="flex-1 truncate text-sm font-semibold text-foreground">
                    TasksApp
                </span>
                <RenderBadge renders={renders} />
            </header>
            <NameInput value={store.listName} onChange={setListName} />
            <ul className="space-y-2">
                {store.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={toggleTask} />
                ))}
            </ul>
            <DoneCount tasks={store.tasks} />
        </div>
    );
}
