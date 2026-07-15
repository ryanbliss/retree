# 04. Convex + React + Next.js — live synced tasks

A task list backed by [Convex](https://convex.dev): live query results,
optimistic mutations, and client-side filtering, all modeled as Retree nodes.

## What it teaches

-   `ConvexNode` view models owning a `ConvexQueryNode` (`this.query(...)`)
    whose results stream into Retree state.
-   `@select` getters (`status`, filtered `tasks`) so components re-render
    only when the selection changes.
-   Optimistic updates via `mutation(..., { withOptimisticUpdate })` and
    `optimisticUpdate` on the query node.
-   `useRoot` for a component-lifetime root, plus `useNode` per child node
    and `@link` for pointing at server-owned docs.

## Where to look

-   `app/tasks-state.ts` — all the state: query node, filter node, optimistic
    mutations.
-   `app/page.tsx` — the components consuming it.
-   `convex/schema.ts` / `convex/tasks.ts` — the Convex backend.

## How to run

```bash
npm install && npm run build:packages   # from the repo root
cd samples/04.convex-react-nextjs
npx convex dev   # provisions a dev deployment and writes .env.local
npm run dev      # in a second terminal
```
