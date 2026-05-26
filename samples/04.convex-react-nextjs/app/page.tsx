"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export default function Home() {
    const tasks = useQuery(api.tasks.get);
    const toggleCompleted = useMutation(api.tasks.toggleCompleted);

    return (
        <main className="flex min-h-screen flex-col items-center justify-between p-24">
            {tasks?.map(({ _id, isCompleted, text }) => (
                <div key={_id}>
                    <input
                        type="checkbox"
                        checked={isCompleted}
                        onChange={() => void toggleCompleted({ taskId: _id })}
                    />
                    {text}
                </div>
            ))}
        </main>
    );
}
