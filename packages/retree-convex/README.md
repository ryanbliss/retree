# Retree Convex

`@retreejs/convex` connects Convex query subscriptions to Retree `ReactiveNode` state. It lets a Retree node own a Convex client, create typed query nodes with `this.query(...)`, run one-off queries with `this.queryOnce(...)`, call actions and mutations, and keep optimistic updates close to the query state they affect.

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

`ConvexNode` extends `BaseConvexNode`. Use `BaseConvexNode` directly when a node only needs the protected `this.action(...)`, `this.mutation(...)`, and `this.queryOnce(...)` helpers and does not need query-node factories.

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
```

You can also construct a query node directly:

```ts
const tasks = new ConvexQueryNode(client, api.tasks.get);
const filteredTasks = new ConvexQueryNode(client, api.tasks.byStatus, {
    args: { isCompleted: false },
});
```

## Query status and skipping

`ConvexQueryNode.state` keeps the convenient query value, while `ConvexQueryNode.result` exposes a status union for loading, success, skipped, and error states:

```ts
const tasks = this.query(api.tasks.byProject, {
    args: { projectId },
});

if (tasks.result.status === "error") {
    console.error(tasks.result.error);
}
```

Pass `"skip"` to the constructor, `this.query(...)`, or `updateArgs(...)` to disable a subscription:

```ts
this.tasks.updateArgs(projectId ? { projectId } : "skip");
```

## Actions and one-off queries

Use `this.action(...)` for Convex actions and `this.queryOnce(...)` when you need an imperative query result without subscribing:

```ts
const generateSummary = this.action(api.ai.generateSummary);
const summary = await generateSummary({ taskId });

const task = await this.queryOnce(api.tasks.getById, { taskId });
```

## Paginated queries

Use `this.paginatedQuery(...)` for Convex paginated queries. The node exposes the aggregate paginated state and a `loadMore(...)` helper:

```ts
this.messages = this.paginatedQuery(api.messages.list, {
    args: { channelId },
    initialNumItems: 20,
});

this.messages.loadMore(20);
```

## Connection state

Use `this.connectionState()` to create a node that tracks the Convex client's connection state:

```ts
this.connection = this.connectionState();
```

## Optimistic updates

`ConvexQueryNode.optimisticUpdate(...)` accepts a narrow transform and an optional mutation context. Call it without `ctx` for local optimistic state that should stay dirty until Convex sends a changed server value. Pass `ctx` when you also want mutation failure to roll back the dirty state:

```ts
const toggleCompleted = this.mutation(api.tasks.toggleCompleted);

return toggleCompleted(
    { taskId },
    {
        withOptimisticUpdate: (ctx) => {
            this.tasks.optimisticUpdate({
                ctx,
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

If the mutation promise rejects before a changed server value arrives, `ConvexQueryNode` restores the last clean server value. If Convex sends a changed value first, the dirty optimistic state is cleared and later mutation rejection is ignored. Server echoes that match the last clean value keep the optimistic state in place. You can provide `revert(...)` when you need custom rollback behavior.

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
