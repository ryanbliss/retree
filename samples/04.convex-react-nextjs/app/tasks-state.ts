"use client";

import {
    ConvexQueryNode,
    createRetreeConvexMutation,
    reconcileConvexDocuments,
    RetreeConvexMutation,
} from "@retreejs/convex";
import { ReactiveNode } from "@retreejs/core";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

export class TasksState extends ReactiveNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;
    private readonly toggleCompletedMutation: RetreeConvexMutation<
        typeof api.tasks.toggleCompleted
    >;
    private readonly closeClient: () => Promise<unknown>;

    constructor(convexUrl: string | undefined) {
        super();
        if (convexUrl === undefined) {
            throw new Error(
                "TasksState: NEXT_PUBLIC_CONVEX_URL must be defined."
            );
        }
        if (convexUrl.length === 0) {
            throw new Error(
                "TasksState: NEXT_PUBLIC_CONVEX_URL cannot be an empty string."
            );
        }

        const client = new ConvexClient(convexUrl);
        this.tasks = new ConvexQueryNode(client, api.tasks.get, {
            args: {},
            reconcile: reconcileConvexDocuments(),
        });
        this.toggleCompletedMutation = createRetreeConvexMutation(
            client,
            api.tasks.toggleCompleted
        );
        this.closeClient = () => client.close();
    }

    get dependencies() {
        return [];
    }

    public dispose(): void {
        this.tasks.dispose();
        void this.closeClient();
    }

    public toggleCompleted(taskId: Id<"tasks">): Promise<null> {
        return this.toggleCompletedMutation(
            { taskId },
            {
                onOptimistic: (mutation) => {
                    void this.tasks.applyOptimisticMutation(mutation, {
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
