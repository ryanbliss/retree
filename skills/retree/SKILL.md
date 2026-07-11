---
name: retree
description: Build, debug, or review Retree code for object-tree state management, React hooks, and Convex integration. Use when working with @retreejs/core, @retreejs/react, @retreejs/convex, @retreejs/react-convex, Retree.root, ReactiveNode, useNode, useTree, useSelect, useRoot, useRaw, Retree.select, Retree.raw, Retree.peekInto, Retree.source, Retree.untracked, Retree.move, Retree.link, memo decorators, or Retree Convex query nodes.
---

# Retree

Retree is a TypeScript state management library for mutable object trees. Use normal object and array mutations inside one Retree-managed tree, then subscribe narrowly to the nodes or derived values that should update.

Prefer the package README and local package contents when available. If documentation lookup is sandboxed, this skill contains the main working model and generated references under `references/`.

## Package Selection

-   Use `@retreejs/core` for object-tree reactivity, `Retree.root`, listeners, ownership helpers, `ReactiveNode`, decorators, transactions, and memoization.
-   Use `@retreejs/react` with `@retreejs/core` for React hooks: `useRoot`, `useNode`, `useTree`, and `useSelect`.
-   Use `@retreejs/convex` with `@retreejs/core` and `convex` for Retree nodes that own Convex clients, live query nodes, paginated query nodes, actions, mutations, one-off queries, optimistic updates, and reconciliation.
-   Use `@retreejs/react-convex` when a React app already uses Convex React and wants one `ConvexReactClient` instance shared between Convex React hooks and Retree Convex nodes.
-   Use `@retreejs/benchmark-cli` only for Retree performance benchmark runs and comparisons.

Install common combinations:

```bash
npm i @retreejs/core
npm i @retreejs/core @retreejs/react
npm i @retreejs/core @retreejs/convex convex
npm i @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```

## Mental Model

Create one Retree root at the state boundary:

```ts
import { Retree } from "@retreejs/core";

const project = Retree.root({
    title: "Roadmap",
    tasks: [{ title: "Write docs", done: false }],
});

project.tasks[0].done = true;
project.tasks.push({ title: "Ship", done: false });
```

Retree tracks object-tree ownership. A node is any non-primitive value such as an object, array, map, or set. Primitive fields do not need their own node subscription.

Set the lowest-level value that changed. Do not rewrite whole state objects with spread patterns just because React state usually works that way.

## React Hooks

Use `useRoot` when React should create and retain a root for the component lifetime:

```tsx
import { useNode, useRoot } from "@retreejs/react";

function CounterPanel() {
    const counter = useRoot(() => ({ count: 0 }));
    const state = useNode(counter);

    return <button onClick={() => (state.count += 1)}>{state.count}</button>;
}
```

Use `useNode(node)` for focused components that should re-render on direct `nodeChanged` events:

```tsx
function TaskRow({ task }: { task: Task }) {
    const state = useNode(task);
    return (
        <label>
            <input
                checked={state.done}
                onChange={() => (state.done = !state.done)}
                type="checkbox"
            />
            {state.title}
        </label>
    );
}
```

If a component reads child objects, subscribe to those child objects too. `useNode(root)` observes direct changes to `root`, not deep writes to `root.child.value`.

Use `useTree(node)` only for small subtrees that truly should re-render for descendant changes. Avoid using it on broad app roots by default.

Use `useSelect` for counts, booleans, labels, totals, filtered IDs, and other narrow projections:

```tsx
const doneCount = useSelect(
    project.tasks,
    (tasks) => tasks.filter((task) => task.done).length,
    { listenerType: "treeChanged" }
);
```

Pass `listenerType: "treeChanged"` when the selector intentionally reads descendant fields. The default `nodeChanged` listener is best for direct fields owned by the selected node.

`useSelect` can also infer dependencies:

```tsx
const doneCount = useSelect(
    () => project.tasks.filter((task) => task.done).length
);
```

Whole Retree-managed values read by an inferred selector subscribe broadly. Property reads subscribe to the owner and compare that property value.

Use `useRaw` for components that read wide during render (big tables, canvas layers, serialization). It subscribes exactly like `useNode` (`nodeChanged` default) but returns `[raw, toSource]` — the live raw object for native-speed, proxy-free reads, plus a resolver back to managed nodes:

```tsx
function TaskListView({ list }: { list: TaskList }) {
    // Re-renders only when the array itself changes: add / remove / reorder.
    const [tasksRaw, toSource] = useRaw(list.tasks);
    return (
        <ul>
            {tasksRaw.map((rawTask) => (
                <TaskRow key={rawTask.id} task={toSource(rawTask)!} />
            ))}
        </ul>
    );
}
```

Pass **nodes** to children via `toSource`, never raw values. `toSource` always resolves direct children of the subscribed node (object/array children, Map values, Set members). Deep changes re-render only when declared — via the node's `dependencies` / `@select`, via `useSelect` for derived views, or via `listenerType: "treeChanged"`. Never write to raw values or use raw references as `React.memo` props or `useMemo` deps.

## Core APIs

Use `Retree.on(node, listenerType, callback)` outside React or inside integrations. Listener types are `nodeChanged`, `treeChanged`, and `nodeRemoved`.

```ts
const unsubscribe = Retree.on(project.tasks, "treeChanged", (tasks) => {
    console.log("tasks changed", tasks.length);
});

unsubscribe();
```

Use `Retree.select(...)` outside React to subscribe to a selected value or ordered dependency list. It narrows notifications; it is not a memo cache.

```ts
const unsubscribe = Retree.select(
    project.tasks,
    (tasks) => tasks.filter((task) => task.done).length,
    (next, previous) => {
        console.log({ next, previous });
    },
    { listenerType: "treeChanged" }
);
```

Use `Retree.parent(node)` for tree-local operations such as deleting yourself from an array. Only call it with Retree-managed nodes.

Use `Retree.runTransaction(...)` to batch synchronous writes into one listener flush per changed node:

```ts
Retree.runTransaction(() => {
    project.title = "Q2 Roadmap";
    project.tasks.push({ title: "Plan launch", done: false });
});
```

Use `Retree.runSilent(...)` for non-rendered bookkeeping writes that should skip listener emissions.

## Raw Reads

Reads through Retree proxies pay a per-property trap cost. For wide, read-only scans, read raw:

```ts
const rawTasks = Retree.raw(project.tasks); // proxy-free, native-speed reads
const found = Retree.peekInto(project.tasks, (raw) =>
    raw.find((task) => task.id === id)
); // raw query, managed result
const managed = Retree.source(rawTasks[0]); // raw value → managed node
const total = Retree.untracked(() => scan(project)); // no dependency tracking
```

Rules:

-   **Raw purity guarantee:** `Retree.raw(node)` subtrees contain zero proxies under every write path; `structuredClone(Retree.raw(node))` is a valid point-in-time copy.
-   Raw values are **read-only** — writes go through managed nodes, or they silently skip emission.
-   Raw references never change identity; do not use them as memo/equality tokens. Nodes are the identity currency.
-   Change payloads (`changes[].previous` / `changes[].new`) are always raw values; use `Retree.source(value)` to opt back into the managed node.
-   `ReactiveNode` exposes instance forms: `this.raw()`, `this.untracked(fn)`, `this.peekInto(fn)`.

## Ownership

Retree is a pure tree: one structural parent per node.

-   Use `Retree.move(node, destination, key?)` or `node.moveTo(destination, key?)` when an existing node should move to a new structural parent.
-   Use `Retree.link(node)` or `@link` for selected items and cross-references that should point at a node without reparenting it.
-   Use `Retree.clone(node)` when two places need independent copies of the same current data.

Do not manually remove a node from its old parent before `Retree.move(...)`; `move` finds and removes the current parent safely.

```ts
const task = projectA.tasks[0];
Retree.move(task, projectB.tasks);

project.selectedTask = Retree.link(projectB.tasks[0]);
project.selectedTask.current.title = "Selected task";
```

## ReactiveNode

Extend `ReactiveNode` when a view model should own derived reactivity, lifecycle hooks, decorators, or dependencies.

```ts
import { ReactiveNode, select } from "@retreejs/core";

class ProjectState extends ReactiveNode {
    public tasks: Task[] = [];
    public filter = "all" as "all" | "done";

    get dependencies() {
        return [];
    }

    @select((self) => [self.tasks, self.filter])
    get visibleTasks() {
        if (this.filter === "all") {
            return this.tasks;
        }
        return this.tasks.filter((task) => task.done);
    }
}
```

Return raw reactive nodes and primitives directly from `dependencies`. Use `this.dependency(node, comparisons)` only when one dependency slot needs custom comparison cells.

Keep `dependencies` and `@select` arrays deterministic when possible. Retree allows length or order changes at runtime, but treats shape changes as invalidations and refreshes subscriptions.

Use `@select()` with no selector when a getter should trap reads automatically. Use explicit `@select((self) => [...])` when the dependency slots should be intentional and easy to audit.

Use `@ignore` for caches, unsubscribe handles, framework clients, subscriptions, and other non-rendered state. Writes to ignored fields do not emit Retree events.

Use `memo`, `@memo`, and `@fnMemo` to cache computed values. Prefer bare or empty decorator forms for automatic dependency trapping; pass comparison functions only when cache keys need finer control. Memoization does not emit or re-render by itself.

Do not start subscriptions, network work, or synchronization inside the `dependencies` getter. Use lifecycle methods such as `onObserved()`, `onUnobserved()`, and `onChanged()` for side effects.

Methods on `ReactiveNode` can read their own data raw via `this.raw()`, run untracked bulk reads via `this.untracked(fn)`, and query raw data while returning managed nodes via `this.peekInto(fn)` — all delegating to the equivalent `Retree` statics.

## Convex Integration

Use `ConvexNode` when a Retree app-state class should own a Convex client and create query, paginated query, connection-state, action, mutation, and one-off query helpers.

```ts
import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.list>;

    constructor(convexUrl: string) {
        const client = new ConvexClient(convexUrl);
        super(client);
        this.tasks = this.query(api.tasks.list, { initialState: [] });
    }

    get dependencies() {
        return [];
    }

    public dispose(): void {
        this.tasks.dispose();
        void this.client.close();
    }
}
```

Use `BaseConvexNode` when the node only needs `this.action(...)`, `this.mutation(...)`, or `this.queryOnce(...)` and does not need query-node factories.

`ConvexQueryNode` stores one live query in Retree state. It exposes convenient `state` plus structured `result` status for pending, success, skipped, and error states. Pass `"skip"` to constructors, helpers, or `updateArgs(...)` to disable a subscription.

Actions, mutations, and `queryOnce(...)` do not emit by themselves. They only update Retree subscribers if the result is written into Retree state or paired with an optimistic update.

Use `ConvexPaginatedQueryNode` and `this.paginatedQuery(...)` for Convex paginated queries. Call `loadMore(...)` to request another page.

Use `ConvexConnectionStateNode` and `this.connectionState()` when UI should observe Convex client connection state.

Use `reconcileConvexDocuments` or `reconcileArrayById` when server lists refresh by stable IDs. Reconciliation preserves child object identity so row components using `useNode(item)` stay narrow.

Custom reconcilers receive a third `rawCurrent` argument (the proxy-free raw view of `current`). Read from `rawCurrent` at native speed, write diffs to `current` so changed rows emit. The built-in reconcilers already do this internally.

Dispose query, paginated query, and connection-state nodes when their owner is torn down. With `@retreejs/react-convex`, query children created by `ConvexNode` helpers can subscribe when observed and clean up when the owning Retree node loses its final active observer.

## React Convex Adapter

Use `RetreeConvexReactClient` when one client should serve both Convex React and Retree Convex nodes:

```tsx
"use client";

import { ConvexProvider } from "convex/react";
import { RetreeConvexReactClient } from "@retreejs/react-convex";
import type { ReactNode } from "react";

const convexClient = new RetreeConvexReactClient(
    process.env.NEXT_PUBLIC_CONVEX_URL!
);

export function Providers({ children }: { children: ReactNode }) {
    return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
```

Pass the same client into Retree state that extends `ConvexNode`.

## Common Pitfalls

-   Do not assign the same Retree-managed object into a second structural parent. Use `move`, `link`, or `clone`.
-   Do not use `@ignore` as a reactive reference mechanism. Use `@link` or `Retree.link(...)`.
-   Do not expect link targets to become children of the owner.
-   Do not call Retree APIs such as `parent`, `on`, `move`, `link`, or `clone` with plain unrooted objects.
-   Do not use `nodeChanged` when selector logic reads descendant fields. Use `treeChanged` or subscribe to a narrower child node.
-   Do not treat `useSelect` or `Retree.select` as memo caches.
-   Do not recreate Retree roots or large `ReactiveNode` graphs during React render. Use `useRoot`, `useMemo`, or `useState` initialization.
-   Do not use React index keys for rows if a list can reorder and stable IDs exist.
-   Do not put expensive side effects in React render through `ReactiveNode` getters or functions.
-   Do not expect Convex action, mutation, or query-once helpers to emit unless their results mutate Retree state.
-   Do not write to values returned by `Retree.raw` / `useRaw`; raw is a read-only view and raw writes skip emission.
-   Do not use raw references as `React.memo` props, `useMemo` deps, or equality tokens; resolve to nodes with `Retree.source` / `toSource`.
-   Do not expect `changes[].previous` / `changes[].new` payload values to be managed nodes; they are always raw.

## Documentation Lookup

When available, prefer local files in this order:

-   `references/llms.md` for the highest-signal routing guide.
-   `references/repository.md` for cross-package examples and feature glossary.
-   `references/core.md` for core reactivity, ownership, select, decorators, memoization, and transactions.
-   `references/react.md` for React hook behavior.
-   `references/convex.md` for Convex query nodes, mutations, optimistic updates, status, skipping, pagination, and reconciliation.
-   `references/react-convex.md` for sharing one Convex React client with Retree Convex state.
-   `references/benchmark-cli.md` for benchmark commands.

The reference files are generated from the repository docs sources by `npm run sync:skill-references`, and `npm run docs` refreshes them after TypeDoc builds.
