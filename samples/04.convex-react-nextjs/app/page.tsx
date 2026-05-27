"use client";

import { useNode, useRoot } from "@retreejs/react";
import { useEffect } from "react";
import { Doc, Id } from "../convex/_generated/dataModel";
import { TasksState } from "./tasks-state";

export default function Home() {
    const root = useRoot(
        () => new TasksState(process.env.NEXT_PUBLIC_CONVEX_URL!)
    );
    const tasks = useNode(root.tasks);

    useEffect(() => {
        return () => root.dispose();
    }, [root]);

    return (
        <main className="flex min-h-screen flex-col items-center justify-between p-24">
            {tasks.state?.map((task) => (
                <TaskRow
                    key={task._id}
                    task={task}
                    onToggle={(taskId) => void root.toggleCompleted(taskId)}
                />
            ))}
        </main>
    );
}

function TaskRow({
    task: taskNode,
    onToggle,
}: {
    task: Doc<"tasks">;
    onToggle: (taskId: Id<"tasks">) => void;
}) {
    const task = useNode(taskNode);

    return (
        <div>
            <input
                type="checkbox"
                checked={task.isCompleted}
                onChange={() => onToggle(task._id)}
            />
            {task.text}
        </div>
    );
}
