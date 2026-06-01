"use client";

import { useNode, useRoot, useSelect } from "@retreejs/react";
import { FormEvent, useEffect, useState } from "react";
import { Doc, Id } from "../convex/_generated/dataModel";
import {
    TaskFilterNode,
    TaskFilterValue,
    TaskRowState,
    TasksState,
} from "./tasks-state";

const filterOptions: { label: string; value: TaskFilterValue }[] = [
    { label: "No filter", value: null },
    { label: "Completed tasks", value: true },
    { label: "Incomplete tasks", value: false },
];

export default function Home() {
    const root = useRoot(
        () => new TasksState(process.env.NEXT_PUBLIC_CONVEX_URL!)
    );
    const [tasks, queryStatus] = useSelect(root.tasks, (query) => {
        const tasks = query.state ?? [];
        return [
            tasks,
            query.result.status,
            tasks.map((task) => task._id).join("|"),
        ];
    });

    useEffect(() => {
        return () => root.dispose();
    }, [root]);

    return (
        <main className="min-h-screen bg-zinc-50 px-5 py-8 text-zinc-950 sm:px-8">
            <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
                <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-sm font-medium text-zinc-500">
                            Retree + Convex
                        </p>
                        <h1 className="text-3xl font-semibold tracking-normal">
                            Tasks
                        </h1>
                    </div>
                    <FilterControls root={root} />
                </header>

                <AddTaskForm root={root} />

                <section className="flex flex-col gap-3">
                    {queryStatus === "pending" ? (
                        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
                            Loading tasks
                        </div>
                    ) : null}
                    {tasks.map((task) => (
                        <TaskCard
                            key={task._id}
                            task={task}
                            filter={root.filter}
                            onToggle={(taskId) =>
                                void root.toggleCompleted(taskId)
                            }
                        />
                    ))}
                    {queryStatus !== "pending" && tasks.length === 0 ? (
                        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
                            No tasks yet
                        </div>
                    ) : null}
                </section>
            </section>
        </main>
    );
}

function FilterControls({ root }: { root: TasksState }) {
    const filter = useNode(root.filter);

    return (
        <div className="inline-flex rounded-md border border-zinc-200 bg-white p-1 shadow-sm">
            {filterOptions.map((option) => {
                const isSelected = filter.isComplete === option.value;
                return (
                    <button
                        key={option.label}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => root.setFilter(option.value)}
                        className={[
                            "rounded-sm px-3 py-2 text-sm font-medium transition",
                            isSelected
                                ? "bg-zinc-900 text-white"
                                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
                        ].join(" ")}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function AddTaskForm({ root }: { root: TasksState }) {
    const [text, setText] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedText = text.trim();
        if (trimmedText.length === 0) {
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            await root.addTask(trimmedText);
            setText("");
        } catch (unknownError) {
            const message =
                unknownError instanceof Error
                    ? unknownError.message
                    : String(unknownError);
            setError(message);
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <form
            onSubmit={(event) => void handleSubmit(event)}
            className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm"
        >
            <div className="flex flex-col gap-2 sm:flex-row">
                <input
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Add a task"
                    className="min-h-11 flex-1 rounded-sm border border-zinc-200 px-3 text-base outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
                />
                <button
                    type="submit"
                    disabled={isSaving || text.trim().length === 0}
                    className="min-h-11 rounded-sm bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                    {isSaving ? "Adding" : "Add task"}
                </button>
            </div>
            {error ? (
                <p className="mt-2 text-sm text-red-600">{error}</p>
            ) : null}
        </form>
    );
}

function TaskCard({
    task,
    filter,
    onToggle,
}: {
    task: Doc<"tasks">;
    filter: TaskFilterNode;
    onToggle: (taskId: Id<"tasks">) => void;
}) {
    const taskRowNode = useRoot(() => new TaskRowState(task, filter));
    const taskRow = useNode(taskRowNode);

    if (!taskRow.isVisible) {
        return null;
    }

    return (
        <article className="flex items-start gap-3 rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <input
                type="checkbox"
                checked={taskRow.task.isCompleted}
                onChange={() => onToggle(taskRow.task._id)}
                className="mt-1 size-4 accent-zinc-900"
                aria-label={`Toggle ${taskRow.task.text}`}
            />
            <div className="min-w-0 flex-1">
                <p
                    className={[
                        "break-words text-base font-medium",
                        taskRow.task.isCompleted
                            ? "text-zinc-500 line-through"
                            : "text-zinc-950",
                    ].join(" ")}
                >
                    {taskRow.task.text}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                    {taskRow.task.isCompleted ? "Completed" : "Incomplete"}
                </p>
            </div>
        </article>
    );
}
