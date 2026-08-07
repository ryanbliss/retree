# @retreejs/core

## 0.8.0

### Minor Changes

-   81faea8: Defer the `ReactiveNode` lifecycle (dependency collection and `@select` value capture) during transactions so `@select` getters and the memos they read never evaluate against torn mid-transaction state. Select "previous" values are now captured from settled state, which fixes a memo keyed on a revision counter caching pre-write state under the new revision permanently when a transaction bumped the counter before writing its backing state.

    Evaluate dependency arrays once per flush. A version-stamped cache holds one full collection pass (the `dependencies` getter plus every `@select` getter) per node per write version, shared by dependency validation and the lifecycle pass, so a flush touching many dependencies no longer re-runs every getter per changed dependency. Trapped `@select` getters now run once per pass instead of twice, and explicit-selector getters resolve their value lazily so an unchanged-dependency validation still never runs the output getter.

    A 50-write transaction against a trapped `@select` scanning 1,000 items drops from 235 ms to 6.9 ms, and a transaction changing 20 `@select` dependencies in one flush from 0.67 ms to 0.26 ms.

    Two behavior changes to note: `ReactiveNode.onChanged` now runs before the node's dependency and `@select` refresh rather than after, and an impure trapped `@select` getter runs fewer times per flush, so its notification count can differ.

## 0.7.2
