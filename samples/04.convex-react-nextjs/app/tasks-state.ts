"use client";

import { ReactiveNode, link, select } from "@retreejs/core";
import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Doc, Id } from "../convex/_generated/dataModel";

export type TaskFilterValue = boolean | null;

export class TaskFilterNode extends ReactiveNode {
    public isComplete: TaskFilterValue = null;

    get dependencies() {
        return [];
    }
}

export class TaskRowState extends ReactiveNode {
    @link
    public task: Doc<"tasks">;

    @link
    public filter: TaskFilterNode;

    constructor(task: Doc<"tasks">, filter: TaskFilterNode) {
        super();
        this.task = task;
        this.filter = filter;
    }

    @select((self: TaskRowState) => {
        const isVisible =
            self.filter.isComplete === null ||
            self.task.isCompleted === self.filter.isComplete;
        if (isVisible) {
            return [
                self.task,
                self.filter,
                self.filter.isComplete,
                self.task.isCompleted,
            ];
        }

        return [
            self.dependency(self.task, [self.task.isCompleted]),
            self.filter,
            self.filter.isComplete,
        ];
    })
    get isVisible() {
        return (
            this.filter.isComplete === null ||
            this.task.isCompleted === this.filter.isComplete
        );
    }

    get dependencies() {
        return [];
    }
}

export class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;
    public readonly filter = new TaskFilterNode();

    constructor(convexUrl: string) {
        const client = new ConvexClient(convexUrl);
        super(client);
        this.tasks = this.query(api.tasks.get, { initialState: [] });
    }

    get dependencies() {
        return [];
    }

    public dispose(): void {
        this.tasks.dispose();
        void this.client.close();
    }

    public setFilter(isComplete: TaskFilterValue): void {
        this.filter.isComplete = isComplete;
    }

    public addTask(text: string): Promise<Id<"tasks">> {
        const createTask = this.mutation(api.tasks.create);
        return createTask({ text });
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
