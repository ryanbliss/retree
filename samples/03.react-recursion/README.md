# 03. React recursion — useNode vs useTree, side by side

A recursive tree of counter cards rendered twice with the same state classes:
`NodeExample` gives every card its own `useNode` subscription, while
`TreeExample` uses a single `useTree` at the top. Click "+count" on a deeply
nested card in each and compare: the `useNode` version re-renders only that
card (with `React.memo` keeping siblings quiet), while the `useTree` version
re-renders its whole example for every write. Same data, same layout — the
hook choice alone decides the render blast radius.

## What it also teaches

-   `ReactiveNode` with `dependencies` and `this.dependency(...)` comparisons.
-   `Retree.parent` walks (`grandparent`), reparenting a card upward, and
    swapping child lists between nodes inside `Retree.runTransaction`.
-   `Retree.runSilent` writes, with a toggle for the `skipReproxy` flag.
-   `@ignore` keeping a field out of reactivity.

## Where to look

-   `src/node-state.ts` — the `Card` and `Tree` classes; all the tree
    operations live here.
-   `src/NodeExample.tsx` / `src/TreeExample.tsx` — the two subscription
    strategies.

## How to run

```bash
npm install && npm run build:packages   # from the repo root
cd samples/03.react-recursion
npm run dev
```
