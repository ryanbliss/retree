# @retreejs/core

## 0.10.2

### Patch Changes

-   f42f300: `@fnMemo(keyFn)` entries for new arguments run their key function plainly and are probed for gating on the next read with the same arguments. A lookup whose arguments rarely repeat, such as a by-id resolver called across a whole document, was paying for a tracked key run on every call that nothing ever validated. A key element that is one of the call's arguments now counts as covered, since the entry already matched it, so `@fnMemo((self, id) => [self.rows, id])` gates once its arguments repeat instead of running its key on every read.

## 0.10.1

### Patch Changes

-   fccca10: `@memo(keyFn)` and `@fnMemo(keyFn)` entries whose key cannot be gated (a derived or literal element, or a key run that read past the traps) run their key function plainly again. Every read of such an entry was collecting tracked reads, snapshots, and a source map that nothing validated; on a view model with a few hundred keyed memos that tripled a constructor replay. An unscoped entry re-attempts scoping once after each recompute, so a key that becomes fully tracked in a later state still gates.

    Hiding memo bodies from enclosing frames exposed three gaps that the leaked body reads had covered. A trapped memo that read `a.b.c` dropped its `a.b` read once it read into `b`, so a new `b` never invalidated it; that read now narrows to `b`'s identity instead. Reads a nested memo replays now land in enclosing memo frames too, and a replayed managed value the memo did not read into counts as a whole-node read, so a `@select` over a keyed memo subscribes to the key's nodes and re-runs when one is written. Key elements that are managed nodes no longer read `kind` through their traps while a key normalizes. A key element that is a node validates through a read of that node's view only; a read that compares its identity alone (an array slot, a path read the key then read into) leaves the key unscoped, so `@memo((self) => [self.rows[0]])` recomputes again when the slot's node is written.

## 0.10.0

### Minor Changes

-   6f8fe77: Frozen objects (`Object.isFrozen`) stored in a tree are immutable leaves: stored and returned as-is, never proxied, with replacement as the change signal. This covers plain objects, arrays, class instances, Map and Set values, and array elements. Nothing beneath a frozen object was reactive before (its properties cannot change); now the object itself is a leaf too, so reads run at raw speed and allocate no node. `Retree.root` rejects a frozen object with a precise error.

### Patch Changes

-   a023f73: Store the parent handler on each node's parent edge so `treeChanged` notification, listener precheck, and snapshot-version walks read ancestors without a proxy trap per level. Tracked reads now record one self-validating entry per property, presence, or keys read: the entry doubles as its comparison accessor and validator, the owner handler comes from the trap instead of a second proxy lookup, and `{ node, comparisons }` dependency values and memo source lookups are built only when a consumer asks for them.
-   fc56bc7: Resolve base proxies and raw nodes in one proxy trap, walk `treeChanged` ancestors over handler metadata without per-level allocations, and refresh retained `ReactiveNode` dependency records in place while sharing one record between the dependency and dependent registries. Reuse a dependent's current dependency collection after its notification reproxy instead of collecting twice per related write, and drain deferred lifecycles with one live iterator.

    Tracked `Retree.select`, `Retree.effect`, and `useSelect` read their subscription sources and comparison cells from the tracking pass itself instead of re-normalizing every dependency through proxy traps on each run.

-   ad1e507: Tracked runs (`Retree.select`, `Retree.effect`, auto-trapped `@select`, and tracked `useSelect`) now keep one read record per node and subscribe only at the roots of what they read. A record whose parent was also read is covered by that parent, and a cover with covered children listens for changes anywhere in its subtree through a new internal subtree listener that does not reproxy ancestors. On a 50k-row document the tracked scan subscribes in 43 ms instead of 99 ms, a related write costs 45 ms instead of 120 ms, and an unrelated write costs 0.04 ms instead of 28 ms. Tracked `useSelect` scopes its re-validation to the nodes that actually changed.
-   35158cc: Reproxy views now target the raw node instead of the base proxy, so a read, write, `in`, `Object.keys`, or `delete` through a view runs one trap instead of two. Property reads through a view of a `ReactiveNode` are about 4x faster, whole-array scans through a view about 2x. The per-node view record folds into the base handler.
-   a8cc4e3: Each managed node now costs about a third less heap. The base handler records what its node is (plain object, array, `ReactiveNode`, Map, Set, or Date) as one `kind` field instead of five, its four lazily built caches share one slot, and the children cache is a fast-mode object with an empty prototype instead of a dictionary-mode `Object.create(null)`. Read speed is unchanged.
-   6a7c560: Stop walking raw input up front. `Retree.root(...)` and every write path used to visit each object in the new input to reject structural cycles and unwrap embedded proxies, which made `root()` linear in the size of plain data that is otherwise proxied lazily (57 ms for 50k rows). Both checks now run where an edge is materialized: a cycle throws when its closing edge is built or first read, and a managed node stored as a proxy inside plain input is unwrapped when its holder is first read. Locked data properties keep their exact stored value.

    One pattern the old walk let through now throws: a plain field on a new child that points back at an ancestor already in the tree (a dialog view model holding its page). The walk skipped nodes it had already normalized, so that edge silently became a shared, non-owning reference; it is now rejected at the closing edge like every other structural cycle. Mark such back-references `@ignore` or `Retree.link`.

-   2b6dabb: The children cache stores each child's base handler instead of its proxy, so a child read through a view resolves the child's latest identity from the handler without a sentinel trap: 200k child reads through a view model's view drop from 16.7 ms to 11.4 ms, and scalar reads through either proxy get a smaller get trap. What a read returns is unchanged. New `Retree.version(node)` and `Retree.treeVersion(node)` expose the node's own-field and subtree versions as numbers for cache keys; both accept a managed node or its raw object.
-   e63351f: Writes to a `ReactiveNode` field now skip tracked readers (`Retree.select`, `Retree.effect`, `useSelect`) that never read that field, the same key-scoped validation plain objects already had. Readers of plain getters are scoped by the fields the getter read, readers of `@memo` getters by the memo's dependency reads, and readers of `@select` getters by the fields the getter's last run read. An unrelated write on a view model with hundreds of readers no longer re-validates each of them or re-runs their getters.
-   3411835: `@memo(keyFn)` and `@fnMemo(keyFn)` no longer evaluate their key function on every read. The key function's reads are tracked and validated like a trapped memo's body, so it runs again only after a write to something it read; a memo keyed on three levels of memos now reads in 0.7 µs instead of 16 µs. Auto-trapped `@select` getters cache their last run per instance and return the same value until a read they made changes, so a filter over 1000 rows costs 0.4 µs per repeated read instead of 180 µs and React consumers see a stable identity. Key functions and trapped getters are expected to be deterministic over tree state; a key element that is not a tracked read, or a key function or getter that read past the traps (`Retree.untracked`, `Retree.raw`, an unmanaged object behind `@ignore`), keeps the old evaluate-every-read behavior.

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
