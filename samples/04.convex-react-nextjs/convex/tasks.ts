import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("tasks").collect();
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
