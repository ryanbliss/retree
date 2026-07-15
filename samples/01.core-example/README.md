# 01. Core example — Retree without React

A tiny browser app using only `@retreejs/core`: no components, no hooks, just
a tree and its events logged to the console.

## What it teaches

-   `Retree.root` over a class-based schema (nested class instances, arrays).
-   `Retree.on` with all three events: `nodeChanged`, `treeChanged`, and
    `nodeRemoved`.
-   Reading fresh state through the reproxy passed to listener callbacks —
    including writing back to it from inside a listener.
-   Re-subscribing after a node is removed and replaced.

## Where to look

-   `src/app.ts` — the whole sample: schema, subscriptions, and a scripted
    sequence of writes with commented expectations.

## How to run

```bash
npm install && npm run build:packages   # from the repo root
cd samples/01.core-example
npm start
```

Open the printed URL and watch the console.
