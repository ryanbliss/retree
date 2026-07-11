"use client";

/**
 * The "Retree useNode" side of the comparative visualizer.
 *
 * Same UI as the React side, same instrumentation. State is one plain
 * object; each component subscribes to exactly the node it reads, so no
 * React.memo or useCallback is needed — the app component never re-renders
 * because it subscribes to nothing.
 *
 * Both implementations render side by side, and every interaction is
 * mirrored: local inputs call `mirror.*`, which applies the same logical
 * change to BOTH stores (this one via the plain assignments registered
 * below).
 *
 * The task set is fixed in this demo. A list that adds or removes rows
 * would subscribe with useNode(list.tasks) in the component that maps them.
 *
 * The useRenderProbe(...) lines are shared instrumentation (render counter,
 * glow, diagram mirroring) and are identical on the React side.
 */

import { useEffect } from "react";
import { useNode, useRoot, useSelect } from "@retreejs/react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import {
    createProbeSet,
    useRenderProbe,
    type DemoMirror,
} from "@/components/compare/renderProbes";

export const retreeProbes = createProbeSet();

interface Task {
    id: number;
    title: string;
    done: boolean;
}

interface TaskList {
    name: string;
    tasks: Task[];
}

function createInitialList(): TaskList {
    return {
        name: "Launch checklist",
        tasks: [
            { id: 1, title: "Write the docs", done: true },
            { id: 2, title: "Add more tests", done: false },
            { id: 3, title: "Ship the release", done: false },
        ],
    };
}

function NameInput({ list, mirror }: { list: TaskList; mirror: DemoMirror }) {
    // Subscribes to the list node: re-renders on name changes only.
    const state = useNode(list);
    const { ref, renders } = useRenderProbe<HTMLDivElement>(retreeProbes.name);
    return (
        <div
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-3 py-2"
        >
            <label
                htmlFor="retree-demo-list-name"
                className="font-mono text-[11px] uppercase tracking-widest text-faint"
            >
                Name
            </label>
            <input
                id="retree-demo-list-name"
                value={state.name}
                onChange={(event) => mirror.setListName(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            />
            <RenderBadge renders={renders} />
        </div>
    );
}

function TaskRow({ task, mirror }: { task: Task; mirror: DemoMirror }) {
    // Subscribes to this task node: re-renders only when this row changes.
    const state = useNode(task);
    const { ref, renders } = useRenderProbe<HTMLLIElement>(
        retreeProbes.rows[state.id - 1]
    );
    return (
        <li
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-3 py-2"
        >
            <input
                id={`retree-demo-task-${state.id}`}
                type="checkbox"
                checked={state.done}
                onChange={() => mirror.toggleTask(state.id)}
                className="accent-[var(--accent-glow)]"
            />
            <label
                htmlFor={`retree-demo-task-${state.id}`}
                className="flex-1 text-sm text-foreground"
            >
                {state.title}
            </label>
            <RenderBadge renders={renders} />
        </li>
    );
}

function DoneCount({ list }: { list: TaskList }) {
    // Subscribes to a projection: re-renders only when the count changes.
    const doneCount = useSelect(
        list.tasks,
        (tasks) => tasks.filter((task) => task.done).length,
        { listenerType: "treeChanged" }
    );
    const { ref, renders } = useRenderProbe<HTMLParagraphElement>(
        retreeProbes.done
    );
    return (
        <p
            ref={ref}
            className="flex items-center gap-2 rounded-md border border-border-token bg-surface px-3 py-2 text-sm text-muted"
        >
            <span className="flex-1">
                {doneCount} of {list.tasks.length} done
            </span>
            <RenderBadge renders={renders} />
        </p>
    );
}

export function RetreeTasksDemo({ mirror }: { mirror: DemoMirror }) {
    // Creates the root once for this component's lifetime. The app
    // subscribes to nothing, so it renders exactly once.
    const list = useRoot(createInitialList);
    const { ref, renders } = useRenderProbe<HTMLDivElement>(retreeProbes.app);

    // Register this tree's write paths — plain assignments — so
    // interactions started in EITHER pane land in this tree too.
    useEffect(() => {
        return mirror.register("retree", {
            setListName: (name) => {
                list.name = name;
            },
            toggleTask: (id) => {
                const task = list.tasks.find((entry) => entry.id === id);
                if (task === undefined) {
                    throw new Error(
                        `RetreeTasksDemo: no task with id ${id} exists in the demo tree to toggle.`
                    );
                }
                task.done = !task.done;
            },
        });
    }, [mirror, list]);

    return (
        <div ref={ref} className="space-y-2 rounded-lg p-1">
            <header className="flex items-center gap-2 px-1">
                <span className="flex-1 truncate text-sm font-semibold text-foreground">
                    TasksApp
                </span>
                <RenderBadge renders={renders} />
            </header>
            <NameInput list={list} mirror={mirror} />
            <ul className="space-y-2">
                {list.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} mirror={mirror} />
                ))}
            </ul>
            <DoneCount list={list} />
        </div>
    );
}
