# Retree Query

`@retreejs/query` is the backend-agnostic async-query layer for Retree. It provides `QueryNode`, a `ReactiveNode` that subscribes to any async source and writes emitted values into Retree state with a full status machine (`pending` / `success` / `error` / `skipped`), deep-compared argument lifecycle, observation-driven subscription cleanup, optimistic updates with generation-tracked rollback, and identity-preserving reconciliation.

`@retreejs/convex` builds its `ConvexQueryNode` and `ConvexPaginatedQueryNode` on this package. Use `@retreejs/query` directly when you want the same machinery over your own backend.

## How to install

```bash
npm i @retreejs/core @retreejs/query
```

## How to use

Drive a `QueryNode` from any backend by implementing `IQuerySubscriptionSource`:

```ts
import { Retree } from "@retreejs/core";
import { QueryNode, IQuerySubscriptionSource } from "@retreejs/query";

const source: IQuerySubscriptionSource<{ room: string }, string[]> = {
    subscribe(args, onValue, onError) {
        const socket = openRoomSocket(args.room, onValue, onError);
        return {
            unsubscribe: () => socket.close(),
            getCurrentValue: () => socket.cachedMessages,
        };
    },
};

const messages = Retree.root(
    new QueryNode(source, { args: { room: "general" }, initialState: [] })
);

Retree.on(messages, "nodeChanged", (next) => {
    console.log(next.result.status, next.state);
});
```

The subscription opens when the node gains its first Retree observer and closes when it loses its last one. `updateArgs(nextArgs)` resubscribes only when the args actually changed (deep comparison); pass `"skip"` to disable the query. After `result.status === "error"`, call `retry()`. Construct the node with `keepPreviousData: true` to keep the previous `state` visible (with `result.isStale` set) while a subscription opened by `updateArgs` loads, instead of resetting to `pending`.

### Fetch adapter

For plain async functions (REST endpoints, RPC calls), `fetchQueryNode` runs a one-shot or polled fetch through the same node:

```ts
import { fetchQueryNode } from "@retreejs/query";

const weather = Retree.root(
    fetchQueryNode((args: { city: string }) => fetchWeather(args.city), {
        args: { city: "Seattle" },
        refetchInterval: 60_000,
    })
);
```

### Optimistic updates

`optimisticUpdate` mutates the current state immediately and, when given a mutation promise, rolls back to the latest clean server baseline if the mutation rejects — overlapping mutations are generation-tracked so an older confirmation or failure never clobbers newer local edits:

```ts
node.optimisticUpdate({
    ctx: { promise: saveTask(taskId) },
    apply(tasks) {
        const task = tasks.find((item) => item.id === taskId);
        if (task) task.isCompleted = true;
    },
});
```

### Reconciliation

Pass `reconcile` to keep item identity stable across emissions so `useNode(item)` rows do not re-render when unrelated rows change:

```ts
import { reconcileArrayById } from "@retreejs/query";

const node = fetchQueryNode(listTasks, {
    reconcile: reconcileArrayById("id"),
});
```

See the [Async queries guide](https://www.retree.dev/docs/query) for the full documentation, including custom reconcilers and the protected hooks for non-plain state shapes.

## Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved. Licensed under MIT license.
