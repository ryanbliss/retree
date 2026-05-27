"use client";

import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

export class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;

    constructor(convexUrl: string) {
        const client = new ConvexClient(convexUrl);
        super(client);
        this.tasks = this.query(api.tasks.get);
    }

    get dependencies() {
        return [];
    }

    public dispose(): void {
        this.tasks.dispose();
        void this.client.close();
    }

    public toggleCompleted(taskId: Id<"tasks">): Promise<null> {
        const toggleCompletedMutation = this.mutation(
            api.tasks.toggleCompleted
        );
        return toggleCompletedMutation(
            { taskId },
            {
                withOptimisticUpdate: (ctx) => {
                    this.tasks.optimisticUpdate({
                        ctx,
                        apply(tasks) {
                            const task = tasks.find(
                                (candidateTask) => candidateTask._id === taskId
                            );
                            if (!task) return;
                            task.isCompleted = !task.isCompleted;
                        },
                    });
                },
            }
        );
    }
}
