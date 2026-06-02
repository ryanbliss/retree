"use client";

import { ReactiveNode, link, select } from "@retreejs/core";
import { BaseConvexNode, ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";

const convexClient = new ConvexClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export type TaskFilterValue = boolean | null;

export class TaskFilterNode extends ReactiveNode {
    public isCompleted: boolean | null = null;

    get dependencies() {
        return [];
    }
}

export class TaskRowState extends ReactiveNode {
    @link
    public task: Doc<"tasks">;

    constructor(task: Doc<"tasks">) {
        super();
        this.task = task;
    }

    public updateTask(task: Doc<"tasks">) {
        if (this.task === task) return;
        this.task = task;
    }

    get dependencies() {
        return [];
    }
}

export class AddTaskState extends BaseConvexNode {
    public text = "";
    public isSaving = false;
    public error: string | null = null;

    constructor() {
        super(convexClient);
    }

    get dependencies() {
        return [];
    }

    get canSubmit() {
        return this.text.length > 0 && !this.isSaving;
    }

    public setText(text: string): void {
        this.text = text;
    }

    public async submit(): Promise<void> {
        if (this.text.length === 0) return;

        this.isSaving = true;
        this.error = null;
        try {
            const createTask = this.mutation(api.tasks.create);
            await createTask({ text: this.text });
            this.text = "";
        } catch (unknownError) {
            this.error =
                unknownError instanceof Error
                    ? unknownError.message
                    : String(unknownError);
        } finally {
            this.isSaving = false;
        }
    }
}

export class TasksState extends ConvexNode {
    private _tasks: ConvexQueryNode<typeof api.tasks.get>;
    public readonly filter = new TaskFilterNode();

    @select() public get status() {
        return this._tasks.result?.status;
    }

    @select() public get tasks(): Doc<"tasks">[] | undefined {
        return this._tasks.state?.filter(
            (task) =>
                this.filter.isCompleted === null ||
                task.isCompleted === this.filter.isCompleted
        );
    }

    constructor() {
        super(convexClient);
        this._tasks = this.query(api.tasks.get, { initialState: [] });
    }

    get dependencies() {
        return [];
    }

    public dispose(): void {
        this._tasks.dispose();
    }

    public toggleCompleted(taskId: Id<"tasks">): Promise<null> {
        const toggleCompletedMutation = this.mutation(
            api.tasks.toggleCompleted
        );
        return toggleCompletedMutation(
            { taskId },
            {
                withOptimisticUpdate: (ctx) => {
                    this._tasks.optimisticUpdate({
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

    public renameTask(taskId: Id<"tasks">, text: string): Promise<null> {
        const updateTextMutation = this.mutation(api.tasks.updateText);
        return updateTextMutation(
            { taskId, text },
            {
                withOptimisticUpdate: (ctx) => {
                    this._tasks.optimisticUpdate({
                        ctx,
                        apply(tasks) {
                            const task = tasks.find(
                                (candidateTask) => candidateTask._id === taskId
                            );
                            if (!task) return;
                            task.text = text;
                        },
                    });
                },
            }
        );
    }
}
