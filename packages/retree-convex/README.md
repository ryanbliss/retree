# Retree Convex

`@retreejs/convex` connects Convex query subscriptions to Retree `ReactiveNode` state. It lets a Retree node own a Convex client, create typed query nodes with `this.query(...)`, and run typed mutations with `this.mutation(...)` while keeping optimistic updates close to the query state they affect.

## How to install

Install with `npm`:

```bash
npm i @retreejs/core @retreejs/convex convex
```

Install with `yarn`:

```bash
yarn add @retreejs/core @retreejs/convex convex
```

## How to use

Create an app state node that extends `ConvexNode`, pass it a Convex client, and build query nodes with the protected `this.query(...)` helper. Query arguments are optional for Convex queries that do not require args.

```ts
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
        const toggleCompleted = this.mutation(api.tasks.toggleCompleted);
        return toggleCompleted(
            { taskId },
            {
                withOptimisticUpdate: (ctx) => {
                    this.tasks.optimisticUpdate(ctx, {
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
```

You can also construct a query node directly:

```ts
const tasks = new ConvexQueryNode(client, api.tasks.get);
const filteredTasks = new ConvexQueryNode(client, api.tasks.byStatus, {
    args: { isCompleted: false },
});
```

## Optimistic updates

`RetreeConvexMutation` accepts `withOptimisticUpdate`, which receives an `OptimisticUpdateContext`. Pass that context to `ConvexQueryNode.optimisticUpdate(...)` with a narrow transform:

```ts
const toggleCompleted = this.mutation(api.tasks.toggleCompleted);

return toggleCompleted(
    { taskId },
    {
        withOptimisticUpdate: (ctx) => {
            this.tasks.optimisticUpdate(ctx, {
                apply(tasks) {
                    const task = tasks.find((candidate) => {
                        return candidate._id === taskId;
                    });
                    if (!task) return;

                    task.isCompleted = !task.isCompleted;
                },
            });
        },
    }
);
```

If the mutation promise rejects, `ConvexQueryNode` restores the snapshot captured before `apply(...)` ran. You can provide `revert(...)` when you need custom rollback behavior.

## Reconciliation

Convex document arrays are reconciled by `_id` by default, so unchanged documents keep stable object identity when new query results arrive. This keeps Retree child-node rendering patterns useful for lists:

```tsx
function TaskRow({ task }: { task: Doc<"tasks"> }) {
    const taskNode = useNode(task);
    return <span>{taskNode.text}</span>;
}
```

For non-Convex arrays, use `reconcileArrayById(...)`:

```ts
this.tasks = this.query(api.tasks.listByProject, {
    args: { projectId },
    reconcile: reconcileArrayById("id"),
});
```

## Docs

Docs are hosted at https://ryanbliss.github.io/retree/.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.
