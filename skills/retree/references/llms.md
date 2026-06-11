# Retree LLM Guide

> Generated from the root llms.txt routing guide.
> Source: `llms.txt`

# Retree

> Retree is a lightweight TypeScript state management library for object trees, with core reactivity APIs, React hooks for fine-grained rendering, and Convex query bindings.

Retree is published as `@retreejs/core`, `@retreejs/react`, `@retreejs/convex`, and `@retreejs/react-convex`. Use the links below for installation, API reference, reactivity behavior, React hook behavior, Convex query behavior, React Convex client behavior, and runnable sample apps.

## Recommendation for agents

Read the full [Retree Docs Home](https://ryanbliss.github.io/retree/) or the [Repository README](https://github.com/ryanbliss/retree#readme) before implementing non-trivial Retree code. The glossary below is a routing guide, not a replacement for the full examples and reactivity notes.

## Quick DOs and DON'Ts

### DO

- DO create one Retree root at the state boundary with `Retree.root(...)` or React's `useRoot(...)`.
- DO mutate Retree-managed objects directly (`node.title = "New"`, `list.push(item)`) instead of replacing whole app state objects.
- DO subscribe as narrowly as possible: prefer `useNode(child)` or `Retree.on(child, "nodeChanged", ...)` for focused UI and hot paths.
- DO use `useSelect(...)`, `Retree.select(...)`, or `@select` for ordered dependency lists. Reactive entries are subscribed to; primitive entries are compared. Use `useSelect(() => ...)`, `Retree.select(() => ..., callback)`, or `@select()` when a selector/getter should trap reads automatically. Whole node reads subscribe broadly; property reads subscribe to the owner and compare that property value.
- DO pass `listenerType: "treeChanged"` to `useSelect(...)` / `Retree.select(...)` when the selector reads descendant nodes.
- DO use `Retree.move(...)` or `node.moveTo(...)` when an existing node should move to a new structural parent.
- DO use `Retree.link(...)` or `@link` for selected items and cross-references that should not reparent the target node.
- DO use `Retree.clone(...)` when two places need independent copies of the same current data.
- DO keep `ReactiveNode.dependencies` and `@select` arrays deterministic when possible. Length/order may change at runtime; Retree treats that as an invalidation and refreshes subscriptions.
- DO return raw reactive nodes and primitives directly from `ReactiveNode.dependencies`; wrap a slot with `this.dependency(node, comparisons)` when you need custom comparison cells.
- DO prefer `@select` for hot filtered lists where one getter should listen to a broad collection but only emit when selected items or selected order changes.
- DO prefer bare `@memo` / `@fnMemo` for cached computed getters and deterministic methods; pass comparison functions only when you need finer cache-key control.
- DO use `@ignore` for caches, unsubscribe handles, framework objects, and other non-rendered state on a `ReactiveNode`.
- DO use `Retree.runTransaction(...)` for several synchronous writes that represent one logical update.
- DO use `Retree.runSilent(...)` for synchronous writes that should skip emitting change events.
- DO dispose Convex query, paginated query, and connection-state nodes when their owner is torn down.
- DO reconcile server list results by stable IDs (`reconcileConvexDocuments`, `reconcileArrayById`) so child node identity stays stable.
- DO set the lowest-level value and/or primitive that changed.

### DON'T

- DON'T assign the same Retree-managed object into a second structural parent. Retree is a pure tree: a node can have one structural parent.
- DON'T use `@ignore` as a reactive reference mechanism. Ignored fields skip Retree emissions; use `@link` or `Retree.link(...)` for reactive pointers.
- DON'T expect `Retree.link(...)` / `@link` to make the linked target a child of the owner. Links point to a node owned elsewhere.
- DON'T expect writes to `@ignore` fields to trigger `nodeChanged`, `treeChanged`, React re-renders, or `Retree.parent(...)` for nested plain objects.
- DON'T use `useTree(...)` on broad app roots by default. It subscribes to descendant changes and can re-render too much.
- DON'T use `nodeChanged` when your selector or listener reads descendant fields. Use `treeChanged` or subscribe to the narrower child node.
- DON'T expect `useSelect(...)` or `Retree.select(...)` dependency lists to reproxy the node passed to the selector. They are observational; use `@select` when a `ReactiveNode` owner should emit.
- DON'T pass selector-only `useSelect(() => ...)` or `Retree.select(() => ..., callback)` when you need a fixed root listener with `listenerType: "treeChanged"`. The selector-only forms trap Retree-managed reads and subscribe to those nodes automatically.
- DON'T treat `memo`, `@memo`, or `@fnMemo` as subscriptions. They cache values only; they do not emit or re-render by themselves.
- DON'T rely on dependency reordering being silent. If `ReactiveNode.dependencies` or `@select` entries are added, removed, or reordered, Retree treats that as changed and emits when the owner is observed.
- DON'T start subscriptions, network work, or synchronization inside the `dependencies` getter. Use `onObserved()`, `onUnobserved()`, and `onChanged()`.
- DON'T manually delete a node from its old parent before calling `Retree.move(...)`; `move` finds the current parent and removes it safely.
- DON'T call `Retree.parent(...)`, `Retree.on(...)`, `Retree.move(...)`, `Retree.link(...)`, or `Retree.clone(...)` with plain unrooted objects.
- DON'T expect Convex `action(...)`, `mutation(...)`, or `queryOnce(...)` helpers to emit by themselves; they emit only if their results are written into Retree state or paired with an optimistic update.
- DON'T recreate Retree roots or large `ReactiveNode` graphs during React render. Create them once, or use `useRoot`, `useMemo`, or `useState` initialization.
- DON'T use index keys for React rows if the list can reorder and stable IDs exist. Stable keys pair best with Retree's child-node identity model.
- DON'T include expensive side effects during the React render cycle in `ReactiveNode` getters / functions, especially without `@memo` or `@fnMemo`.
- DON'T recreate object trees with spread operators like you would in React (those sorts of hacks are "why" Retree exists in the first place).

## Feature Glossary

- `Retree.root`: Makes one object the root of a Retree-managed tree. Use it once where plain state enters Retree.
- `Retree.on`: Subscribes to `nodeChanged`, `treeChanged`, or `nodeRemoved`. Use it outside React and inside integrations.
- `Retree.select`: Subscribes to a selected value or ordered dependency list. Reactive entries are subscribed to and primitive entries are compared. Use `Retree.select(node, selector, callback)` for an explicit root, or `Retree.select(() => value, callback)` for automatic dependency trapping. It is not a cache.
- `Retree.parent`: Returns the structural parent of a node. Use it for tree-local operations like deleting yourself from a list.
- `Retree.move`: Transfers an existing node to a new structural parent. Use it when ownership should change.
- `Retree.link` and `@link`: Store a reactive pointer without reparenting the target. Use them for selected items and cross-references.
- `Retree.clone`: Creates a detached copy. Use it when two places need independent state.
- `@select`: Decorates a `ReactiveNode` getter with an ordered dependency list. Use `@select()` with no selector for MobX-style dependency trapping: whole Retree-managed values read by the getter subscribe broadly, property reads subscribe to the owner and compare that property value, and primitive values read by the getter compare. Pass `@select((self) => [...])` when you want explicit dependency slots. Pass `@select({ equals })` or `@select((self) => [...], { equals })` when the final getter output needs custom equality; `equals(self, previous, next)` returns true to skip owner reproxy/emission.
- `ReactiveNode.dependencies`: Makes one node emit when another node changes. Return raw reactive nodes/primitives directly, or use `this.dependency(node, comparisons)` for custom comparison cells. Dynamic dependency arrays are allowed; shape changes emit and refresh subscriptions.
- `ReactiveNode.memo`, `@memo`, `@memo()`, `@fnMemo`, and `@fnMemo()`: Cache computed values. Prefer bare/empty decorator forms for automatic dependency trapping; pass comparison functions for finer cache-key control. They do not emit `nodeChanged` or trigger React renders by themselves.
- `@ignore`: Keeps a `ReactiveNode` field out of Retree emissions. Use it for caches, framework handles, subscriptions, and non-rendered state.
- `Retree.runTransaction`: Batches synchronous writes into one listener flush per changed node.
- `Retree.runSilent`: Performs writes without emitting listeners. Use it for non-rendered bookkeeping.
- `ReactiveNode.prepareTree`: Warms lazy child proxies. Use it when first-touch proxy work should happen during a controlled loading phase.
- `useRoot`: Creates one Retree root for a React component lifetime.
- `useNode`: Re-renders for direct `nodeChanged` events on one node. Use it for focused components and child rows.
- `useTree`: Re-renders for `treeChanged` events from a node or descendants. Use it sparingly for small subtrees.
- `useSelect`: Re-renders only when a selected value or ordered dependency list changes. Use `useSelect(node, selector)` for an explicit root, or `useSelect(() => value)` for automatic dependency trapping. Good for counts, totals, booleans, labels, and VM dependency arrays.
- `ConvexNode`: Full Convex base class for Retree app state with query, paginated query, action, mutation, query-once, and connection-state helpers.
- `BaseConvexNode`: Smaller Convex base class for action, mutation, and one-off query helpers.
- `ConvexQueryNode`: Stores one live Convex query in Retree state and emits when query state/result/error changes.
- `ConvexPaginatedQueryNode`: Stores one live paginated Convex query and exposes `loadMore(...)`.
- `ConvexConnectionStateNode`: Stores the Convex client's connection state in Retree state.
- `createRetreeConvexAction` and `createRetreeConvexMutation`: Typed standalone Convex helpers for code that is not inside a `BaseConvexNode`.
- `reconcileConvexDocuments` and `reconcileArrayById`: Preserve list item object identity across server results so child `useNode(item)` subscriptions stay narrow.
- `RetreeConvexReactClient`: Extends Convex's `ConvexReactClient` with the Retree Convex subscription methods used by `ConvexNode` query, paginated query, and connection-state helpers.

## Documentation

- [Retree Docs Home](https://ryanbliss.github.io/retree/): Generated TypeDoc site with package navigation, README content, and API reference.
- [Repository README](https://github.com/ryanbliss/retree#readme): Installation, quick-start examples, React usage, core usage, and sample links.
- [@retreejs/core README](https://github.com/ryanbliss/retree/tree/main/packages/retree-core#readme): Core package guide for object-tree reactivity, events, `ReactiveNode`, memoization, and decorators.
- [@retreejs/react README](https://github.com/ryanbliss/retree/tree/main/packages/retree-react#readme): React package guide for `useNode`, `useTree`, `useRoot`, and rendering behavior.
- [@retreejs/convex README](https://github.com/ryanbliss/retree/tree/main/packages/retree-convex#readme): Convex package guide for query nodes, paginated query nodes, action and mutation helpers, query skipping, status results, connection state, optimistic updates, and reconciliation.
- [@retreejs/react-convex README](https://github.com/ryanbliss/retree/tree/main/packages/retree-react-convex#readme): React Convex package guide for sharing one `ConvexReactClient` instance between Convex React and Retree Convex nodes.

## API Reference

- [@retreejs/core API](https://ryanbliss.github.io/retree/modules/_retreejs_core.html): Core exports including `Retree`, `ReactiveNode`, event types, decorators, and memo helpers.
- [Retree class](https://ryanbliss.github.io/retree/classes/_retreejs_core.Retree.html): Static APIs for creating roots, subscribing to changes, finding parents, and batching/silencing updates.
- [ReactiveNode class](https://ryanbliss.github.io/retree/classes/_retreejs_core.ReactiveNode.html): Base class for derived dependencies, dependency comparison, and memoized computed values.
- [Core README ownership section](https://github.com/ryanbliss/retree/tree/main/packages/retree-core#move-link-or-clone-existing-nodes): Examples for `Retree.move`, `Retree.link`, `@link`, `ReactiveNode.moveTo`, and `Retree.clone`.
- [Core README select section](https://github.com/ryanbliss/retree/tree/main/packages/retree-core#select-derived-values): Examples for `Retree.select`, including when to use `listenerType: "treeChanged"`.
- [@retreejs/react API](https://ryanbliss.github.io/retree/modules/_retreejs_react.html): React exports for stateful Retree nodes and trees.
- [useNode](https://ryanbliss.github.io/retree/functions/_retreejs_react.useNode.html): React hook for subscribing to direct node changes with fine-grained re-rendering.
- [useTree](https://ryanbliss.github.io/retree/functions/_retreejs_react.useTree.html): React hook for subscribing to node and descendant-tree changes.
- [useRoot](https://ryanbliss.github.io/retree/functions/_retreejs_react.useRoot.html): React hook for creating and retaining a Retree root in a component.
- [@retreejs/convex API](https://ryanbliss.github.io/retree/modules/_retreejs_convex.html): Convex exports for `BaseConvexNode`, `ConvexNode`, `ConvexQueryNode`, `ConvexPaginatedQueryNode`, `ConvexConnectionStateNode`, action and mutation helpers, optimistic update contexts, and reconcilers.
- [BaseConvexNode class](https://ryanbliss.github.io/retree/classes/_retreejs_convex.BaseConvexNode.html): Base Retree node for classes that own a Convex client and need protected action, mutation, and one-off query helpers.
- [ConvexNode class](https://ryanbliss.github.io/retree/classes/_retreejs_convex.ConvexNode.html): Base class for Retree nodes that own a Convex client and create typed query, paginated query, action, mutation, query-once, and connection-state helpers.
- [ConvexQueryNode class](https://ryanbliss.github.io/retree/classes/_retreejs_convex.ConvexQueryNode.html): Reactive query node that subscribes to Convex query updates and exposes `state`, structured `result`, `updateArgs(...)`, skipping, errors, and optimistic updates.
- [ConvexPaginatedQueryNode class](https://ryanbliss.github.io/retree/classes/_retreejs_convex.ConvexPaginatedQueryNode.html): Reactive paginated query node with aggregate page state and `loadMore(...)`.
- [ConvexConnectionStateNode class](https://ryanbliss.github.io/retree/classes/_retreejs_convex.ConvexConnectionStateNode.html): Reactive node for Convex client connection state.
- [@retreejs/react-convex API](https://ryanbliss.github.io/retree/modules/_retreejs_react_convex.html): React Convex adapter exports including `RetreeConvexReactClient`.

## Samples

- [Core example](https://github.com/ryanbliss/retree/tree/main/samples/01.core-example): Minimal non-React Retree sample.
- [React example](https://github.com/ryanbliss/retree/tree/main/samples/02.react-example): React sample app using Retree state.
- [React recursion example](https://github.com/ryanbliss/retree/tree/main/samples/03.react-recursion): Recursive React tree sample using Retree.

## Packages

- [@retreejs/core on npm](https://www.npmjs.com/package/@retreejs/core): Core state-management package.
- [@retreejs/react on npm](https://www.npmjs.com/package/@retreejs/react): React hooks package.
- [@retreejs/convex on npm](https://www.npmjs.com/package/@retreejs/convex): Convex query and mutation bindings package.
- [@retreejs/react-convex on npm](https://www.npmjs.com/package/@retreejs/react-convex): Convex React client adapter for Retree Convex nodes.

## Optional

- [GitHub repository](https://github.com/ryanbliss/retree): Source code, issues, package workspace, and samples.
- [Fluid Framework SharedTree](https://fluidframework.com/docs/data-structures/tree/): Related inspiration mentioned in the Retree docs.
