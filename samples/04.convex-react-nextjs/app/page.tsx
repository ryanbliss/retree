"use client";

import { useNode, useRoot } from "@retreejs/react";
import { FormEvent, memo, useEffect } from "react";
import { Doc, Id } from "../convex/_generated/dataModel";
import {
    AddTaskState,
    TaskFilterNode,
    TaskFilterValue,
    TasksState,
} from "./tasks-state";

const filterOptions: { label: string; value: TaskFilterValue }[] = [
    { label: "No filter", value: null },
    { label: "Completed tasks", value: true },
    { label: "Incomplete tasks", value: false },
];

export default function Home() {
    const _root = useRoot(() => new TasksState());
    const root = useNode(_root);

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
                    <FilterControls filter={root.filter} />
                </header>

                <AddTaskForm />

                <section className="flex flex-col gap-3">
                    {root.status === "pending" ? (
                        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
                            Loading tasks
                        </div>
                    ) : null}
                    {root.status === "error" ? (
                        <div className="flex flex-col items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-8 text-center">
                            <p className="text-sm text-red-700">
                                Couldn&apos;t load tasks
                                {root.errorMessage
                                    ? `: ${root.errorMessage}`
                                    : ""}
                            </p>
                            <button
                                type="button"
                                onClick={root.retry}
                                className="min-h-9 rounded-sm bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700"
                            >
                                Retry
                            </button>
                        </div>
                    ) : null}
                    {root.tasks?.map((task) => (
                        <TaskCard
                            key={task._id}
                            task={task}
                            onToggle={root.toggleCompleted}
                            onRename={root.renameTask}
                        />
                    ))}
                    {root.status !== "pending" && root.tasks?.length === 0 ? (
                        <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
                            No tasks yet
                        </div>
                    ) : null}
                </section>
            </section>
        </main>
    );
}

const FilterControls = memo(function FilterControls({
    filter: filterNode,
}: {
    filter: TaskFilterNode;
}) {
    const filter = useNode(filterNode);

    useEffect(() => {
        console.log("FilterControls render");
    });

    return (
        <div className="inline-flex rounded-md border border-zinc-200 bg-white p-1 shadow-sm">
            {filterOptions.map((option) => {
                const isSelected = filter.isCompleted === option.value;
                return (
                    <button
                        key={option.label}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => (filter.isCompleted = option.value)}
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
});

const AddTaskForm = memo(function AddTaskForm() {
    const addTaskNode = useRoot(() => new AddTaskState());
    const addTask = useNode(addTaskNode);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await addTask.submit();
    }

    return (
        <form
            onSubmit={(event) => void handleSubmit(event)}
            className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm"
        >
            <div className="flex flex-col gap-2 sm:flex-row">
                <input
                    value={addTask.text}
                    onChange={(event) => addTask.setText(event.target.value)}
                    placeholder="Add a task"
                    className="min-h-11 flex-1 rounded-sm border border-zinc-200 px-3 text-base outline-none transition placeholder:text-zinc-400 focus:border-zinc-500"
                />
                <button
                    type="submit"
                    disabled={!addTask.canSubmit}
                    className="min-h-11 rounded-sm bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
                >
                    {addTask.isSaving ? "Adding" : "Add task"}
                </button>
            </div>
            {addTask.error ? (
                <p className="mt-2 text-sm text-red-600">{addTask.error}</p>
            ) : null}
        </form>
    );
});

const TaskCard = memo(function TaskCard({
    task,
    onToggle,
    onRename,
}: {
    task: Doc<"tasks">;
    onToggle: (taskId: Id<"tasks">) => void;
    onRename: (taskId: Id<"tasks">, text: string) => Promise<null>;
}) {
    // Convex query results reconcile by `_id`, so each task keeps a stable
    // node identity across server emissions. Subscribing to the task node
    // directly is all a row needs: this component re-renders only when its
    // own task's fields change (including optimistic updates).
    const state = useNode(task);

    return (
        <article className="flex items-start gap-3 rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <input
                type="checkbox"
                checked={state.isCompleted}
                onChange={() => onToggle(state._id)}
                className="mt-1 size-4 accent-zinc-900"
                aria-label={`Toggle ${state.text}`}
            />
            <div className="min-w-0 flex-1">
                <input
                    value={state.text}
                    onChange={(event) =>
                        void onRename(state._id, event.target.value)
                    }
                    className={[
                        "w-full rounded-sm border border-transparent bg-transparent px-0 py-0 text-base font-medium outline-none transition focus:border-zinc-300 focus:bg-white focus:px-2 focus:py-1",
                        state.isCompleted
                            ? "text-zinc-500 line-through"
                            : "text-zinc-950",
                    ].join(" ")}
                    aria-label={`Edit ${state.text}`}
                />
                <p className="mt-1 text-sm text-zinc-500">
                    {state.isCompleted ? "Completed" : "Incomplete"}
                </p>
            </div>
        </article>
    );
});
