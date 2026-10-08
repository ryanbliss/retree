---
"@retreejs/core": patch
"@retreejs/react": patch
---

Selector-only `Retree.select(selector, callback)`, `Retree.effect`, and `useSelect` now observe every `ReactiveNode` they read, so `onObserved` and `onUnobserved` run for it.

Before, a node reached through a parent the selector also read was never observed, whether it existed before the run or was created during it. A query node created lazily inside a selector, such as `vm.snapshotsFor(id).state`, never subscribed and stayed loading forever. A selector also lost a dependency when `onObserved` wrote state while it subscribed, and `useSelect` re-ran a kept node's `onUnobserved` and `onObserved` when its other dependencies moved.
