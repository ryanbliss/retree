# Retree React Convex

`@retreejs/react-convex` adapts Convex's `ConvexReactClient` to the Retree Convex client interface. Use it when a React app wants one Convex client instance for both Convex React hooks and Retree `ConvexNode` state.

The adapter keeps Retree query nodes on Convex React's watch/cache surface while letting Retree own subscription lifetime. `ConvexNode` query children subscribe when observed and clean up when the owning Retree node loses its final active observer, so React components do not need a manual dispose effect for constructor-created queries.

## How to install

The quickest way is the interactive installer — it detects React and Convex and installs the matching Retree packages:

```bash
npm create @retreejs@latest
```

Or install directly with `npm`:

```bash
npm i @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```

Install with `yarn`:

```bash
yarn add @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```

## Feature glossary

-   [`RetreeConvexReactClient`](#how-to-use) extends Convex's `ConvexReactClient` and adds the subscription methods expected by `@retreejs/convex`.
-   [`ConvexNode`](https://github.com/ryanbliss/retree/tree/main/packages/retree-convex#how-to-use) creates typed query, paginated query, connection-state, action, mutation, and query-once helpers.
-   [`useRoot`](https://github.com/ryanbliss/retree/tree/main/packages/retree-react#useroot-hook) creates a Retree root for a React component lifetime.
-   [`useNode`](https://github.com/ryanbliss/retree/tree/main/packages/retree-react#usenode-hook) subscribes a component to Retree state and automatically releases that observer on unmount.
-   [`ConvexProvider`](https://docs.convex.dev/client/react) can receive the same `RetreeConvexReactClient` instance that your Retree nodes use.

## How to use

Create one `RetreeConvexReactClient` for the React app and pass it anywhere a `ConvexReactClient` is expected. Retree Convex nodes can use that same instance because it also exposes Retree's `IConvexClient` subscription surface.

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

Use the same client inside Retree state:

```ts
import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { RetreeConvexReactClient } from "@retreejs/react-convex";
import { api } from "../convex/_generated/api";

const convexClient = new RetreeConvexReactClient(
    process.env.NEXT_PUBLIC_CONVEX_URL!
);

export class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;

    constructor() {
        super(convexClient);
        this.tasks = this.query(api.tasks.get, { initialState: [] });
    }

    get dependencies() {
        return [];
    }
}
```

Render the Retree node from React:

```tsx
import { useNode, useRoot } from "@retreejs/react";
import { TasksState } from "./tasks-state";

export function TaskList() {
    const root = useRoot(() => new TasksState());
    const state = useNode(root);

    if (state.tasks.result.status === "pending") {
        return <div>Loading tasks</div>;
    }

    return (
        <ul>
            {state.tasks.state?.map((task) => {
                return <li key={task._id}>{task.text}</li>;
            })}
        </ul>
    );
}
```

When `TaskList` unmounts, `useNode(root)` releases the Retree observer. `ConvexNode` then disposes query, paginated query, and connection-state children created through its helper methods. You can still call `dispose()` manually for non-React app shutdown.

## Paginated queries

`RetreeConvexReactClient` supports Retree paginated query nodes through Convex React's paginated watch API:

```ts
this.messages = this.paginatedQuery(api.messages.list, {
    args: { channelId },
    initialNumItems: 20,
});
```

If a future Convex version removes the paginated watch method, the adapter throws a targeted error from `onPaginatedUpdate_experimental(...)` so the incompatible surface is obvious.

## Server-side rendering (Next.js RSC preload)

`preloadedQueryOptions(...)` is the Retree equivalent of Convex React's `usePreloadedQuery`. A server component runs `preloadQuery` from `convex/nextjs` and passes the payload to a client component; the client derives `args` and `initialState` for a `ConvexQueryNode`, so the first render shows server data with `result.status === "success"` (no pending flash) and the node switches to live values once the websocket subscription emits.

```tsx
// app/tasks/page.tsx (server component)
import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { TasksClient } from "./TasksClient";

export default async function TasksPage() {
    const preloaded = await preloadQuery(api.tasks.list, { listId: "today" });
    return <TasksClient preloaded={preloaded} />;
}
```

```tsx
// app/tasks/TasksClient.tsx
"use client";

import type { Preloaded } from "convex/react";
import { ConvexQueryNode } from "@retreejs/convex";
import { preloadedQueryOptions } from "@retreejs/react-convex";
import { useNode, useRoot } from "@retreejs/react";
import { api } from "@/convex/_generated/api";
import { convexClient } from "./providers";

export function TasksClient(props: {
    preloaded: Preloaded<typeof api.tasks.list>;
}) {
    const root = useRoot(
        () =>
            new ConvexQueryNode(convexClient, api.tasks.list, {
                ...preloadedQueryOptions(props.preloaded),
            })
    );
    const tasks = useNode(root);

    return (
        <ul>
            {tasks.state?.map((task) => {
                return <li key={task._id}>{task.text}</li>;
            })}
        </ul>
    );
}
```

The payload's args become the node's initial args, so the live subscription runs the exact query the server preloaded. Inside a `ConvexNode`, spread the same options into `this.query(api.tasks.list, { ...preloadedQueryOptions(preloaded) })`.

## Reactive auth state

`RetreeConvexReactClient` makes Convex auth observable by interposing on `setAuth`/`clearAuth`, so a `ConvexAuthStateNode` (the `useConvexAuth` equivalent) can render `isLoading`/`isAuthenticated` reactively:

```ts
import { ConvexAuthStateNode } from "@retreejs/convex";

const auth = Retree.root(new ConvexAuthStateNode(convexClient));

Retree.on(auth, "nodeChanged", () => {
    console.log(auth.isLoading, auth.isAuthenticated);
});

// Wire your auth provider as usual; state flows automatically:
convexClient.setAuth(fetchToken);
```

## When to use this package

Use `@retreejs/react-convex` in React apps that already use Convex React or `ConvexProvider`. Use `@retreejs/convex` with `ConvexClient` from `convex/browser` for non-React apps or for state that does not need to share Convex React's client instance.
