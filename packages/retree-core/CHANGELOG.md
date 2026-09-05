# @retreejs/core

## 0.9.0

### Minor Changes

-   b5475d5: Add `Retree.materializeAsync` to run bounded generator steps across host tasks. It preserves proxy and memo caches between slices, rejects stale or cancelled work, reports progress, and returns only the completed result.

### Patch Changes

-   bff2f99: Make unchanged automatic memo reads constant-time when all reads have managed owners. Validate only recently written owners, retain dependency replay values, and fall back to full validation for silent writes and bounded-history overflow. Ignored data and unscoped getters retain their validation behavior.

    Track returned managed-node identities as well as property owners so terminal child reads invalidate correctly. Fall back to full validation when WeakRef is unavailable, preserving ordinary writes in those runtimes.

-   4abe8cd: Store each managed node's base and current view in one record. Invalidate unobserved ancestor identities on writes and create their views on first read. Observers and intermediate transaction reads still receive fresh identities. Retained views share the base node's live parent edge across adoption and detachment.
-   eb671d5: Accumulate transaction change records in linear time and avoid scheduling unused ancestor payloads. Traverse deep tree listeners iteratively while preserving change order and React identities.
-   f6d0748: Keep direct snapshot writes constant-time after the first root lookup. Settle subtree versions only when their root is read, coalesce shared ancestor work, and cache tree-listener paths. Preserve pending versions across moves and detachments without enabling expensive writes through unrelated listeners.
-   b040d1c: Normalize nested managed references in new input so raw trees remain proxy-free before their children are read. Reuse the existing managed identity when rooting an already-managed raw object.

    Keep plain ancestors lazy when an input contains an existing managed leaf, so deep inputs do not enter recursive proxy construction.

-   26b5161: Keep raw child lookup correct after silent structural writes by validating its slot index against write history instead of React render versions. Unrelated writes reuse the index; unknown or expired history triggers a conservative rebuild.

    Shorten repeated ownership, move, and uninitialized-support diagnostics while retaining their failure conditions and recovery guidance.

-   b040d1c: Resolve only the requested raw child in useRaw. Pass `toManaged(row, { key: index })` to skip the raw slot lookup when the index, property, or Map key is known. Existing value lookup remains supported and indexes raw slots once per node version without materializing other children.

    Share raw slot and result validation with the prepared child resolver to avoid duplicate reads during keyed resolution.

-   514c0bc: Retain active dependency records across lifecycle refreshes, preserve pending comparison baselines, and remove consumed entries from the prior-record lookup instead of building a second key set.

## 0.8.0

### Minor Changes

-   81faea8: Defer the `ReactiveNode` lifecycle (dependency collection and `@select` value capture) during transactions so `@select` getters and the memos they read never evaluate against torn mid-transaction state. Select "previous" values are now captured from settled state, which fixes a memo keyed on a revision counter caching pre-write state under the new revision permanently when a transaction bumped the counter before writing its backing state.

    Evaluate dependency arrays once per flush. A version-stamped cache holds one full collection pass (the `dependencies` getter plus every `@select` getter) per node per write version, shared by dependency validation and the lifecycle pass, so a flush touching many dependencies no longer re-runs every getter per changed dependency. Trapped `@select` getters now run once per pass instead of twice, and explicit-selector getters resolve their value lazily so an unchanged-dependency validation still never runs the output getter.

    A 50-write transaction against a trapped `@select` scanning 1,000 items drops from 235 ms to 6.9 ms, and a transaction changing 20 `@select` dependencies in one flush from 0.67 ms to 0.26 ms.

    Two behavior changes to note: `ReactiveNode.onChanged` now runs before the node's dependency and `@select` refresh rather than after, and an impure trapped `@select` getter runs fewer times per flush, so its notification count can differ.

## 0.7.2
