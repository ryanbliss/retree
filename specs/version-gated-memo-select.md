# Spec: Version-gated keyed memos and cached `@select` getters

Status: **implemented** (2026-09-05, `perf/version-gated-memo-select`). Item 6 of the Sep 2026 platform work
(`benchmarks/findings-sep-5-2026-platform.md`). Stacked on item 5 (#78).
Measured with `/tmp/rtprof/s5-neo-shapes.ts` phase C.

## 1. Problem

Neo declares 234 `@memo((self) => [...])` getters and flattens their key
lists by hand ("flat deps invariant") because a key that reads another memo
pays that memo's key on every read. Auto-trapped `@memo` already skips its
body and its comparison traversal when the global write version is
unchanged, but the explicit-key form evaluates the key function on every
read, and the key function is where the nesting cost lives.

`@select` getters have no cache at all: every read runs the body and returns
a fresh value, so a `filter` over 1000 rows costs 0.18 ms per read and React
consumers see a new identity on every render. Neo answers this with
`@ignore` caches and revision cells.

| Probe (item 5 checkout)                                     | Cost   |
| ----------------------------------------------------------- | ------ |
| C1 10k reads of a memo keyed on three levels of memos       | 163 ms |
| C2 10k reads of a flat-keyed memo                           | 6 ms   |
| C3 10k nested-memo reads, unrelated write every 10 reads    | 157 ms |
| C4 1k related write + nested-memo read pairs                | 47 ms  |
| C5 1k reads of a `@select` filter over 1000 rows, no writes | 182 ms |
| C6 1k `@select` reads, unrelated write every 10 reads       | 183 ms |

## 2. Design

### 2.1 Keyed memos validate their key reads

`@memo(keyFn)` and `@fnMemo(keyFn)` run the key function under
comparisons-mode tracking (the frame auto-trapped memos already use). The
cache entry stores the normalized key result as today plus the key
function's reads as validation accessors with a write-version stamp.

Read path:

1. Version unchanged, or every read whose owner was written since the stamp
   re-reads equal: hit. The key function does not run. Same rule as
   `validateTrappedMemo`, so nested memo keys resolve through their own
   cheap hits.
2. Otherwise run the key function (tracked), normalize, shallow-compare with
   the stored key result: equal is a hit that refreshes the stored reads;
   different recomputes the body.

The key function's reads are replayed into any enclosing tracking frame on
every path, so selectors and lifecycles that used to see them leak through
still see them.

Scope guard: an object element of the key result that is not one of the key
function's tracked read values, one of the call's arguments, or a managed
node (a derived plain object, a function) marks the entry unscoped, and the
key function runs on every read exactly as today. Managed elements compare
by raw identity for this check; a managed node the run only compared by
identity gains a version read so the entry validates on the node's own
version. Primitive elements (`?? 0`, `.length`, derived strings) need no
read: the normalized result compares them by value, so a key must derive
its primitives from Retree reads and arguments, as an auto-trapped memo
must ("deterministic for the same dependency values"). `Retree.version`
and `Retree.treeVersion` are tracked reads, so they are valid key elements.

The same fallback applies when any read during the key function bypassed
the traps: `Retree.untracked`, `Retree.peekInto`, `Retree.raw`, or the
interior of a mutable unmanaged object held behind an `@ignore` field (a raw
`Map` cache, say; a frozen object is a leaf, as in a regular field). Such a
read can hand the key function a managed row that
no tracked read led to, so the row's own reads validate fine while the cache
that chose the row has moved on. Tracking frames record this as partial
coverage (`ReadCoverage`), and a partial key run is never gated. Keys whose
control flow depends on state Retree cannot see at all (module-level
caches) remain the caller's contract, as for auto-trapped memos
("deterministic for the same dependency values").

`ReactiveNode.memo(key, fn, comparisons)` is unchanged: the caller already
evaluated its comparisons.

### 2.2 Auto-trapped `@select` getters cache their last run

An auto-trapped `@select` getter keeps, per instance, the
`ITrackedSelectionAccesses` of its last body run plus a write-version stamp.
Both the getter read path and the lifecycle's `collectTrackedDependencies`
and `getValue` consult the cache:

1. Version unchanged: return the cached run.
2. Otherwise validate only the records of owners written since the stamp
   (`getWrittenOwnersSince`); a write to a node the body never read is
   skipped. If the write history overflowed, every record validates. All
   unchanged: restamp, return the cached run.
3. Otherwise run the body under a fresh dependencies frame and cache it.

Consequences:

-   The getter returns the same instance until a read it made changes, so
    React `!==` checks and `memo` boundaries hold without
    `stabilizeSelectedRetreeReferences`.
-   The lifecycle compares the exact instance consumers read.
-   The body's reads no longer leak into an enclosing tracked frame. The
    enclosing frame records the property read of the getter on its owner;
    the owner's `@select` lifecycle emits `nodeChanged` for that key when
    the value changes, which re-validates the enclosing record. Enclosing
    selectors therefore hold one subscription on the owner instead of one
    per row the body touched.
-   Unmanaged instances (`Retree.raw(vm).visible`, a bare `new VM()`) run
    the body untracked as today.
-   A body whose run had partial read coverage (see §2.1) is not cached: it
    runs on every read as before this item.

Explicit-selector `@select((self) => [...])` getters are unchanged in this
item: their selector may return `self.dependency(...)` entries that are
fresh objects on every call, so the memo key comparison never hits.

### 2.3 Validation stays owner-scoped

Both caches lean on `bumpGlobalWriteVersion(owner)`, which already runs for
the written node and for every ancestor the reproxy walk refreshes. A deep
write therefore names the array or object a key or body read, and the
record or accessor for that owner is the only one validated.

## 3. Semantics preserved

-   Key results still decide the memo: the body recomputes exactly when the
    normalized key result changes.
-   Managed key elements still compare by latest reproxy identity, so deep
    writes beneath a listed node invalidate as before.
-   `undefined` key results ("recompute once per reproxy") and `[]` ("cache
    forever") keep their meaning; both mark the entry unscoped.
-   `@select` lifecycle emission and `compareValueBeforeNotify` are
    unchanged; only the value source is cached.

## 4. Verification

-   `npm run test`: 985 passed. New cases: key function not evaluated on
    unrelated writes, evaluated when a key read changes, unscoped keys
    evaluate every read; `@select` identity stable across reads, invalidates
    on a related write, ignores unrelated writes, owner still emits, raw
    instances stay uncached.
-   `s5` phase C against the item 5 bundle, three alternating serial rounds:

| Probe                                                       | Item 5     | Item 6       |
| ----------------------------------------------------------- | ---------- | ------------ |
| C1 10k reads of a memo keyed on three levels of memos       | 163-166 ms | 6.2-7.9 ms   |
| C2 10k reads of a flat-keyed memo                           | 6.2-6.5 ms | 2.6-2.7 ms   |
| C3 10k nested-memo reads, unrelated write every 10 reads    | 155-156 ms | 14.9-15.9 ms |
| C4 1k related write + nested-memo read pairs                | 47 ms      | 30-33 ms     |
| C5 1k reads of a `@select` filter over 1000 rows, no writes | 181-186 ms | 0.38-0.39 ms |
| C6 1k `@select` reads, unrelated write every 10 reads       | 180-185 ms | 0.43-0.48 ms |

-   Phases A and B (materialization, tracked scan) unchanged.

## 5. Notes from implementation

-   Getter reads on a `ReactiveNode` have no owner to scope to, so the
    existing trapped-memo validation re-read them on every read even with
    the version unchanged. Validation now returns early whenever the write
    version is unchanged: a getter's value derives from tree state, so it
    cannot move without a write. Without this the keyed form was four times
    slower than before, because each level re-validated the level below.
-   Fresh runs snapshot their comparisons from the values the reads
    captured instead of re-reading every property a second time. Two memo
    tests that counted those re-reads now count one read per compute.
-   A trapped memo's first compute now replays its reads into the enclosing
    tracked frame, as a hit already did. The `@select` cache depends on it:
    a memo read inside a select body must land the memo's dependencies in
    the select's records, or a write beneath them would validate as
    unrelated.
-   Tracked `useSelect` no longer re-renders when a `@select` getter it read
    re-evaluates to the same value; one React test that expected that
    render now expects none.
-   Unscoped entries run their key function plainly (2026-09-06). The first
    cut ran every key under comparisons tracking and stored snapshots and a
    source map even when the entry could never validate; Neo's 234 keyed
    memos are all unscoped (`peekInto` cells, derived elements), so each
    read paid that allocation for nothing and a constructor replay went from
    405 ms to 1500 ms. An entry's scope is `Unknown` when fresh and after an
    unscoped recompute, `Scoped` once a tracked run finds every element read,
    and `Unscoped` otherwise; only `Unknown` runs the key under tracking.
-   Hidden memo bodies exposed reads the leaks had covered (2026-09-06).
    A trapped memo's path read `a.b` was dropped once the run read into
    `b`, so replacing `b` never invalidated it; the read now narrows to
    `b`'s identity. Replays land in comparison frames too, a replayed
    managed value the memo did not read into marks a whole-node record,
    and the `@select` getter cache treats a whole-node record of a written
    owner as changed. Normalizing a key no longer reads `kind` through a
    managed element's trap, which had narrowed the key's own read of it.
    A key element that is a node is covered only by a read of its view; an
    identity-only read (array slot, narrowed path read) leaves the key
    unscoped, which also closes a 0.10.0 hole where
    `@memo((self) => [self.rows[0]])` gated on the slot's identity and
    missed writes to the row.
-   `@fnMemo` entries for new arguments run their key plainly and are probed
    on the first repeat (2026-09-06). Counting inside Neo Compose's
    constructor replay showed 22,549 of 23,949 keyed reads were fresh by-id
    lookups whose tracked key run was discarded as unscoped; the replay was
    17% over 0.9.0 with every body count identical. A key element that is one
    of the call's arguments counts as covered, so those lookups gate once an
    argument repeats.
-   Version reads are tracked and key coverage gates on primitives
    (2026-09-06). Instrumenting Neo Compose's steady state with 0.10.2 showed
    182k keyed reads and 243 gated hits: 72 keys were unscoped for a literal
    `?? 0` or `: 0`, and the rest were partial from `Retree.raw` in the
    project locator and the mutable `ProjectInvalidations` object behind an
    `@ignore` field. A ceiling experiment that gated every key regardless
    (unsound) showed no timing win, so the sound rule was widened instead:
    primitives compare by value in the result, identity-only nodes get a
    node version read, and only derived plain objects stay unscoped.
    `Retree.version` / `Retree.treeVersion` reads land as comparison
    accessors in key frames and as keyless replayed reads in dependency
    frames; a tree version read marks its record as covering the subtree,
    and tracked selectors, effects and the `@select` lifecycle resolve a
    `nodeChanged` from an unread descendant to the nearest such ancestor
    record. The `@select` lifecycle subscribes such an edge to the node's
    subtree in addition to its `nodeChanged`. A frozen object behind an
    `@ignore` field reads as a leaf, matching regular fields. Widening
    gating exposed a cost on Neo's frame clicks (+0.3–1.0 ms per click,
    three interleaved rounds): keys such as `ConstructorPreviewGraphVM`'s
    (138 accessors) read `documentState` chains that move on every click
    while the key holds, so each click re-validated, re-tracked and re-stored
    them. A scoped key whose reads moved now runs under tracking once; if
    its result held it is unscoped until its body next recomputes, so the
    reads-churn-faster-than-key case costs one plain run per read, as in
    0.10.2.
