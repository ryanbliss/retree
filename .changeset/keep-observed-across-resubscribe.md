---
"@retreejs/react": patch
---

`useSelect` no longer re-runs `onUnobserved` and `onObserved` on a `ReactiveNode` it keeps reading when a prop moves the selector's other dependencies. Query nodes such as `ConvexQueryNode` no longer close and reopen their backend subscription on those re-renders.

React hooks now release a `ReactiveNode` one microtask after its last listener unsubscribes, so `onUnobserved` runs just after unmount rather than during it.
