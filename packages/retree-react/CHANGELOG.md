# @retreejs/react

## 0.11.2

### Patch Changes

-   2113570: `useSelect` no longer re-runs `onUnobserved` and `onObserved` on a `ReactiveNode` it keeps reading when a prop moves the selector's other dependencies. Query nodes such as `ConvexQueryNode` no longer close and reopen their backend subscription on those re-renders.

    React hooks now release a `ReactiveNode` one microtask after its last listener unsubscribes, so `onUnobserved` runs just after unmount rather than during it. Tests that fake `queueMicrotask`, as Jest's fake timers do by default, need to flush microtasks (`jest.runAllTicks()`) before asserting on it.

-   347c69e: Selector-only `Retree.select(selector, callback)`, `Retree.effect`, and `useSelect` now observe every `ReactiveNode` they read, so `onObserved` and `onUnobserved` run for it.

    Before, a node reached through a parent the selector also read was never observed, whether it existed before the run or was created during it. A query node created lazily inside a selector, such as `vm.snapshotsFor(id).state`, never subscribed and stayed loading forever. A selector also lost a dependency when `onObserved` wrote state while it subscribed, and `useSelect` re-ran a kept node's `onUnobserved` and `onObserved` when its other dependencies moved.

-   651f298: A selector that reads `Retree.treeVersion(node)` now re-runs on every write under `node`.

    Before, a selector-only `useSelect` dropped writes to descendants the selector never read directly, unlike `Retree.select`. And `useSelect`, `Retree.select`, `Retree.effect` and `@select` getters all skipped a write to a descendant's field when the selector also read a different field of that descendant.

## 0.11.1

### Patch Changes

-   36a2f1c: An explicit `equals` now decides whether the tracked forms of `Retree.select` and `useSelect` notify.

    When a tracked selector re-ran because a dependency changed, both forms notified (and `useSelect` re-rendered) even when the `equals` option reported the previous and next selections equal. The dependency check existed so a selector returning a stable node reference still notifies when that node's content changes; it now applies only to the default comparison. With `equals` supplied, a re-run whose result compares equal keeps the previous reference and stays silent, which is what lets a component select a derived value such as a sorted order and re-render only when that order changes.

-   b3d7872: `useNode`, `useTree`, `useRaw`, `useSelect`, and `Retree.select` now name themselves when they receive a value that is not a Retree node.

    Passing an unmanaged value to one of these APIs used to throw Retree's internal invariant, which reported an unproxied object and asked the caller to file a Retree issue — even though the value came straight from application code. The error now names the API that received it and what arrived instead, for example: `useRaw: expected a Retree-managed node but received an unmanaged array. Pass an object returned by Retree.root(...) or read a child from an existing Retree tree.` The internal invariant still covers values that reach the base-proxy lookup through an internal path.

## 0.11.0

## 0.10.4

## 0.10.3

## 0.10.2

## 0.10.1

## 0.10.0

### Patch Changes

-   fc56bc7: Resolve base proxies and raw nodes in one proxy trap, walk `treeChanged` ancestors over handler metadata without per-level allocations, and refresh retained `ReactiveNode` dependency records in place while sharing one record between the dependency and dependent registries. Reuse a dependent's current dependency collection after its notification reproxy instead of collecting twice per related write, and drain deferred lifecycles with one live iterator.

    Tracked `Retree.select`, `Retree.effect`, and `useSelect` read their subscription sources and comparison cells from the tracking pass itself instead of re-normalizing every dependency through proxy traps on each run.

-   ad1e507: Tracked runs (`Retree.select`, `Retree.effect`, auto-trapped `@select`, and tracked `useSelect`) now keep one read record per node and subscribe only at the roots of what they read. A record whose parent was also read is covered by that parent, and a cover with covered children listens for changes anywhere in its subtree through a new internal subtree listener that does not reproxy ancestors. On a 50k-row document the tracked scan subscribes in 43 ms instead of 99 ms, a related write costs 45 ms instead of 120 ms, and an unrelated write costs 0.04 ms instead of 28 ms. Tracked `useSelect` scopes its re-validation to the nodes that actually changed.

## 0.9.0

### Minor Changes

-   b040d1c: Resolve only the requested raw child in useRaw. Pass `toManaged(row, { key: index })` to skip the raw slot lookup when the index, property, or Map key is known. Existing value lookup remains supported and indexes raw slots once per node version without materializing other children.

    Share raw slot and result validation with the prepared child resolver to avoid duplicate reads during keyed resolution.

### Patch Changes

-   26b5161: Keep raw child lookup correct after silent structural writes by validating its slot index against write history instead of React render versions. Unrelated writes reuse the index; unknown or expired history triggers a conservative rebuild.

    Shorten repeated ownership, move, and uninitialized-support diagnostics while retaining their failure conditions and recovery guidance.

-   3129073: Validate changed tracked dependencies before rerunning useSelect selectors. Unrelated field writes reuse the previous selection while relevant changes and dependency replacements remain observable.

## 0.8.0

## 0.7.2

### Patch Changes

-   @retreejs/core@0.7.2
