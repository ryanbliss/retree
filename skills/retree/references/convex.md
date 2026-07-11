# @retreejs/convex README

> Generated from the Convex package README used by TypeDoc package docs.
> Source: `packages/retree-convex/README.md`

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

## Feature glossary

-   [`ConvexNode`](#how-to-use) is the full base class for app state that owns a Convex client. Use it when you want `this.query(...)`, `this.paginatedQuery(...)`, `this.connectionState(...)`, `this.mutation(...)`, `this.action(...)`, and `this.queryOnce(...)`.
-   [`BaseConvexNode`](#how-to-use) is the smaller base class for nodes that only need `this.mutation(...)`, `this.action(...)`, or `this.queryOnce(...)`.
-   [`ConvexQueryNode`](#query-status-and-skipping) stores one live Convex query in Retree state. Use it for subscribed query results that should trigger Retree/React updates.
-   [`ConvexPaginatedQueryNode`](#paginated-queries) stores one live paginated Convex query and exposes `loadMore(...)`.
-   [`ConvexConnectionStateNode`](#connection-state) stores the Convex client's connection state in Retree state.
-   [`createRetreeConvexMutation`](#standalone-action-and-mutation-helpers) and [`createRetreeConvexAction`](#standalone-action-and-mutation-helpers) create typed imperative helpers when you are not inside a `BaseConvexNode`.
-   [`optimisticUpdate`](#optimistic-updates) mutates a query node optimistically and emits through Retree immediately.
-   [`reconcileConvexDocuments` and `reconcileArrayById`](#reconciliation) preserve item identity across server results so child `useNode(item)` components stay narrow.

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

Query nodes are `ReactiveNode`s. When Convex sends a new value, the query node writes `state`, `result`, and `error`, which emits Retree listeners and re-renders React components subscribed with `useNode`, `useTree`, or `useSelect`.

```tsx
import { useSelect } from "@retreejs/react";

function TaskCount({
    tasks,
}: {
    tasks: ConvexQueryNode<typeof api.tasks.get>;
}) {
    const count = useSelect(tasks, (node) => node.state.length);
    return <span>{count}</span>;
}
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

```ts
tasks.updateArgs({ projectId: "p1" }); // ✅ changes args and resubscribes
tasks.updateArgs("skip"); // ✅ emits skipped state and unsubscribes
tasks.dispose(); // ✅ stops the subscription; call during app cleanup
```

## Actions and one-off queries

Use `this.action(...)` for Convex actions and `this.queryOnce(...)` when you need an imperative query result without subscribing:

```ts
const generateSummary = this.action(api.ai.generateSummary);
const summary = await generateSummary({ taskId });

const task = await this.queryOnce(api.tasks.getById, { taskId });
```

These helpers do not emit by themselves. They only trigger Retree updates if your code writes their result into a Retree node or uses a mutation optimistic update.

## Standalone action and mutation helpers

Use `createRetreeConvexAction(...)` and `createRetreeConvexMutation(...)` when you want typed helpers without subclassing `BaseConvexNode`.

```ts
import {
    createRetreeConvexAction,
    createRetreeConvexMutation,
} from "@retreejs/convex";

const generateSummary = createRetreeConvexAction(
    client,
    api.ai.generateSummary
);
const toggleCompleted = createRetreeConvexMutation(
    client,
    api.tasks.toggleCompleted
);

await generateSummary({ taskId }); // ❌ no Retree emit by itself
await toggleCompleted({ taskId }); // ❌ no Retree emit unless paired with optimisticUpdate
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

`loadMore(...)` requests another page and returns `false` when there is no active subscription to extend. New pages update the paginated query node and emit through Retree.

```ts
const didRequestMore = this.messages.loadMore(20);
this.messages.dispose();
```

## Connection state

Use `this.connectionState()` to create a node that tracks the Convex client's connection state:

```ts
this.connection = this.connectionState();
```

```tsx
import { useSelect } from "@retreejs/react";

function ConnectionBadge({ state }: { state: ConvexConnectionStateNode }) {
    const status = useSelect(state, (node) => node.state);
    return <span>{status.hasInflightRequests ? "Syncing" : "Idle"}</span>;
}
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

Custom reconcilers receive a third `rawCurrent` argument — the proxy-free raw
view of `current` (`Retree.raw`). Reconciliation is read-dominated, so **read
from `rawCurrent`, write to `current`**: comparisons run at native speed and
writes through `current` emit `nodeChanged` for changed rows while keeping
item identity stable. Writing to `rawCurrent` skips emission — never do it.

```ts
const reconcileTasks: IStateReconciler<Task[]> = {
    reconcile(current, next, rawCurrent) {
        if (current === undefined) return next;
        for (let index = 0; index < next.length; index++) {
            if (rawCurrent?.[index]?.text !== next[index]!.text) {
                current[index]!.text = next[index]!.text; // ✅ emits
            }
        }
        current.length = next.length;
        return current;
    },
};
```

The built-in reconcilers (`reconcileConvexDocuments`, `reconcileArrayById`)
already read raw and write through `current` internally.

## Docs

Docs are hosted at https://ryanbliss.github.io/retree/.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.
