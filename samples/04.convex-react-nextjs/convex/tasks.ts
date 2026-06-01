import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("tasks").order("desc").collect();
    },
});

export const create = mutation({
    args: {
        text: v.string(),
    },
    handler: async (ctx, { text }) => {
        const trimmedText = text.trim();
        if (trimmedText.length === 0) {
            throw new Error("Task text is required.");
        }

        return await ctx.db.insert("tasks", {
            text: trimmedText,
            isCompleted: false,
        });
    },
});

export const toggleCompleted = mutation({
    args: {
        taskId: v.id("tasks"),
    },
    handler: async (ctx, { taskId }) => {
        const task = await ctx.db.get(taskId);
        if (task === null) {
            throw new Error(`Task not found for id ${taskId}`);
        }

        await ctx.db.patch(taskId, {
            isCompleted: !task.isCompleted,
        });
    },
});
