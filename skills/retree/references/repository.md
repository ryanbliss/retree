# Retree Repository README

> Generated from the repository README used by TypeDoc as the docs home page.
> Source: `README.md`

# Retree

Retree is a lightweight and simple state management library, designed primarily for React. If you know how to work with objects in JavaScript or TypeScript, you pretty much already know how to use Retree.

```tsx
import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

const project = Retree.root({
    tasks: [{ title: "Write docs", done: false }],
});

function TaskRow({ task }: { task: { title: string; done: boolean } }) {
    const state = useNode(task); // re-renders only when this task changes
    return (
        <label>
            <input
                type="checkbox"
                checked={state.done}
                onChange={() => (state.done = !state.done)}
            />
            {state.title}
        </label>
    );
}
```

Full documentation, live playgrounds, and guides live at **[retree.dev](https://www.retree.dev)**.

## Quick start

Add Retree to an existing project with the interactive installer:

```bash
npm create @retreejs@latest
```

It detects React and Convex in your project, preselects the matching integrations, and can install the Retree AI skill for coding agents. `pnpm create @retreejs` and `yarn create @retreejs` work too. Then start with the [Quickstart guide](https://www.retree.dev/docs/quick-start).

## Decorators are optional

Retree needs zero build configuration — `Retree.root`, the React hooks, `ReactiveNode` with its `dependencies` getter, and `this.memo(...)` all work out of the box. Only authoring the `@`-prefixed decorators (`@memo`, `@fnMemo`, `@select`, `@ignore`, `@link`) in your own code requires standard (TC39 2023-11) decorator support:

-   **TypeScript 5+**: works with no config, as long as `experimentalDecorators` is **not** set. Legacy decorator semantics are incompatible — Retree's decorators detect them and throw an error explaining the fix.
-   **Babel toolchains**: add `@babel/plugin-proposal-decorators` with `{ "version": "2023-11" }`.

Each decorator has a non-decorator equivalent (`this.memo(...)`, the `dependencies` getter with `this.dependency(...)`, `Retree.link(...)`). Full guide: [Setup & decorators](https://www.retree.dev/docs/setup-and-decorators).

## Packages

-   [`@retreejs/core`](packages/retree-core#readme) provides Retree's proxy, event, memo, `ReactiveNode`, effect, and undo-history primitives.
-   [`@retreejs/react`](packages/retree-react#readme) provides React hooks for rendering Retree nodes, a provider for per-request SSR roots, and testing utilities.
-   [`@retreejs/query`](packages/retree-query#readme) is the backend-agnostic async-query layer: `QueryNode`, fetch adapters, optimistic updates, and reconciliation over any subscription source.
-   [`@retreejs/convex`](packages/retree-convex#readme) connects Convex queries, paginated queries, actions, mutations, auth, and connection state to Retree nodes.
-   [`@retreejs/react-convex`](packages/retree-react-convex#readme) adapts Convex's `ConvexReactClient` for React apps that want one client instance for both Convex React and Retree, plus a Next.js RSC preload helper.
-   [`@retreejs/devtools`](packages/retree-devtools#readme) bridges Retree to the Redux DevTools Extension and exposes a structured change-log tap.

## Feature glossary

Core:

-   [`Retree.root`](https://www.retree.dev/docs/quick-start) makes one object the root of a Retree-managed tree. Use it once where plain state enters Retree.
-   [`Retree.on`](https://www.retree.dev/docs/events-and-subscriptions) subscribes to `nodeChanged`, `treeChanged`, or `nodeRemoved`. Use it outside React and inside integrations.
-   [`Retree.select`](https://www.retree.dev/docs/events-and-subscriptions) is the non-React version of `useSelect`. Use it to narrow notifications; it is not a cache.
-   [`Retree.effect`](https://www.retree.dev/docs/effects-and-reactions) runs a function immediately and re-runs it whenever a tracked dependency changes — the third subscription primitive next to `on` and `select`.
-   [`createUndoHistory`](https://www.retree.dev/docs/undo-redo) records every change under a root into undo/redo steps; `Retree.applyInverse` / `Retree.applyChanges` are the underlying primitives.
-   [`Retree.parent`](https://www.retree.dev/docs/tree-operations) returns the structural parent of a node. Use it for tree-local operations like deleting yourself from a list.
-   [`Retree.move`, `Retree.link` / `@link`, and `Retree.clone`](https://www.retree.dev/docs/tree-operations) make ownership explicit: transfer, point without reparenting, or copy.
-   [`Retree.isNode`](https://www.retree.dev/docs/events-and-subscriptions) checks whether a value is a Retree-managed node. Use it to guard `Retree.raw` when a value may be managed or plain.
-   [`Retree.raw`, `Retree.managed`, `Retree.peekInto`, and `Retree.untracked`](https://www.retree.dev/docs/performance) enable native-speed, proxy-free reads. Raw subtrees are guaranteed proxy-free.
-   [`Retree.runTransaction`](https://www.retree.dev/docs/transactions) batches synchronous writes into one listener flush per changed node.
-   [`Retree.runSilent`](https://www.retree.dev/docs/transactions) performs writes without emitting listeners.
-   [`Retree.registerRootName`](https://www.retree.dev/docs/devtools) names a root for tooling — debug taps and devtools label trees with it.
-   [`ReactiveNode`](https://www.retree.dev/docs/view-models) lets nodes emit from declared `dependencies`, with `@select` getters, `memo` / `@memo` / `@fnMemo` caching, `@ignore` opt-outs, lifecycle hooks, and `prepareTree`.

React:

-   [`useRoot`](https://www.retree.dev/docs/react/use-root) creates one Retree root for a React component lifetime.
-   [`useNode`](https://www.retree.dev/docs/react/use-node) re-renders a component for direct `nodeChanged` events on one node. Use it for rows, panels, forms, and focused child components.
-   [`useTree`](https://www.retree.dev/docs/react/use-tree) re-renders for `treeChanged` events from a node or any descendant. Use it sparingly for small subtrees.
-   [`useSelect`](https://www.retree.dev/docs/react/use-select) re-renders only when a selected value or ordered dependency list changes.
-   [`useRaw`](https://www.retree.dev/docs/react/use-raw) subscribes like `useNode` but returns `[raw, toManaged]` for native-speed, proxy-free render reads.
-   [`RetreeProvider` / `createRetreeContext`](https://www.retree.dev/docs/react) provide per-request roots for SSR apps and per-render roots for tests, instead of module singletons.
-   [`@retreejs/react/testing`](https://www.retree.dev/docs/testing) ships `createTestRoot` (auto listener cleanup) and `actOnRetree` (act-wrapped writes) for component tests.

Data:

-   [`QueryNode` and `fetchQueryNode`](https://www.retree.dev/docs/query) subscribe any async backend into Retree state with a status machine, `keepPreviousData`, `retry()`, optimistic updates, and reconciliation.
-   [`ConvexNode` and friends](https://www.retree.dev/docs/convex) bind Convex live queries, paginated queries, mutations with optimistic updates, auth state, and SSR preload to Retree.
-   [`connectReduxDevTools` and `createChangeLogTap`](https://www.retree.dev/docs/devtools) inspect every write in the Redux DevTools Extension or your own tooling.

## Agent docs and skill

Published Retree npm packages include their package `README.md` and the root `llms.txt` file so sandboxed agents can read the high-signal Retree guide directly from an installed package. The website serves every guide as raw markdown too (see [retree.dev/llms.txt](https://www.retree.dev/llms.txt)).

This repository also exposes a Retree agent skill at `skills/retree/SKILL.md`, with full markdown references generated from the docs sources into `skills/retree/references/`. `npm run docs` refreshes those references after the TypeDoc site builds. Agents that support the open skills CLI can install or use it with:

```bash
npx skills add ryanbliss/retree --skill retree
npx skills use ryanbliss/retree@retree
```

## API docs

The primary API reference is generated from source on every deploy at [retree.dev/api](https://www.retree.dev/api/core). To generate the TypeDoc site locally instead:

```bash
npm run docs
```

The generated static site is written to `docs/` and ignored by Git.

## Docs

Docs are hosted at https://www.retree.dev.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
