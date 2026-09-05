# Spec: Key-scoped validation for ReactiveNode writes

Status: **implemented** (2026-09-05, `perf/reactive-node-key-scoping`). Item 8
of the Sep 2026 platform work (`benchmarks/findings-sep-5-2026-platform.md`).
Stacked on item 7 (#80).

## 1. Problem

Item 8 started as "cheap cells and boundaries": Neo's `ProjectInvalidations`
mints hundreds of tiny `Retree.root({ revision: 0 })` cells inside `@ignore`
fields so that bumping one revision does not wake readers of the big view
model. The measure-first step asked why a counter field on the view model
itself was too expensive.

A Neo-shaped probe (`s10-cells.ts`: one `ReactiveNode` VM with 50 data
fields and 3 getters, 500 tracked `Retree.select` readers, 100 bumps of a
`counter` field nobody reads) answered it:

| Shape                                          | 100 bumps |
| ---------------------------------------------- | --------- |
| ReactiveNode VM, readers of 3 data fields each | 18.6 ms   |
| Plain-object VM, readers of 3 data fields each | 7.4 ms    |
| ReactiveNode VM, readers of 3 getters each     | 36.5 ms   |
| 500 tiny root cells, 1 reader each             | 0.6 ms    |

The fan-out itself (every subscriber of the node hears every write) costs
about 140 ns per reader per write. The rest is validation:
`canSkipTrackedDependencyChange` refuses key scoping for every write whose
owner is a `ReactiveNode`, so each reader falls back to `isUnchanged()`,
which re-reads every captured key through the base proxy. Readers of
getters re-run the getter bodies. On a view model with hundreds of `useSelect`
readers, one unrelated write validates all of them, which is the cost Neo
escaped by minting roots.

The exclusion dates from before records carried node identity and before
memo and select reads replayed into the enclosing frame. Its stated reason
was that a getter's value derives from other own fields, so a write to the
backing field would be skipped while the getter's value changed.

## 2. Design

Remove the `ReactiveNode` exclusion, and give the two getter kinds whose
reads do not land in the reader's record a key set of their own.

-   **Plain getters are transparent.** The getter runs with the proxy as
    `this`, so every backing field it reads lands in the same record as a
    key. A write to `b` is relevant to a reader of `get sum() { return a + b }`
    because `b` is in the reader's key set.
-   **`@memo` getters replay their dependency reads as keys.** A memo read
    under a tracked frame already appends a `ReplayedRead` per key-function
    read to the record of the node that read touched. Each replay carries
    the property key its accessor read, and `hasPropertyKey` now includes
    those keys; a key-set read (no property key) keeps the record
    unscopable. Keyless `this.memo(fn, deps)`, auto-trapped `@memo` and
    `@fnMemo` share the runner. The snapshot cannot go stale: the key
    function's own reads are in the set, so any write that could change
    which keys it reads changes a replayed cell, fails validation, and
    re-runs the reader.
-   **`@select` getters are scoped by their cached body run, looked up
    live.** The body runs in its own frame, so the reader's record only
    holds the getter name. `collectSelectGetter` records the getter's cache
    key on the reader's record (`selectGetterKeys`), and
    `isPossiblyRelevantFieldChange` asks `selectGetterMayReadKey` whether
    the getter's *current* cached run read the changed key on the owner
    (recursing into nested `@select` reads, conservative when the entry is
    missing or its owner record is unscopable). Because the lookup reads
    the cache at change time, a body whose read set changed without
    changing its value is still followed.
-   **Dependency-forwarded records** (`change.node !== changedRawNode`, the
    ReactiveNode `dependencies` path) stay conservatively relevant, which is
    how reads of other nodes inside memo and select bodies reach readers.
-   **Whole-node reads, key enumeration and array owners** keep their
    existing exclusions.

Reads that were never tracked (an `@ignore` field, `Retree.untracked`,
`Retree.raw`) were never a dependency; a skipped write to them is the
behavior the reader already had for plain objects.

## 3. Semantics preserved and changed

-   Preserved: a tracked reader re-runs whenever a key it read, directly or
    through a getter, changes value, and whenever a memo or select getter it
    read is invalidated by its own dependencies.
-   Changed: a write to a `ReactiveNode` field no tracked reader read no
    longer re-validates those readers. Getter bodies are not re-run for
    unrelated writes. This matches plain-object owners.

## 4. Verification

-   `reactive-node-key-scoping.spec.ts` (11 tests): data-field reader,
    plain getter, keyed `@memo` (with a dependency-function run counter
    proving no re-evaluation), `@memo` whose dependency list changes shape,
    auto-trapped `@memo`, explicit-dependency `@select`, auto-trapped
    `@select`, a `@select` body whose read set changes without changing its
    value, nested `@select`, keyless memo inside a getter, and
    `Retree.effect`. Each skips an unrelated write without re-running and
    re-runs on a relevant one.
-   `npm run test`: 1003 passed (react `useSelect` shares
    `canSkipTrackedDependencyChange`).
-   Probe (`s10-cells.ts`, serial alternating rounds, item 7 bundle vs this
    branch; 500 readers, 100 bumps of an unread `counter`). Selector re-run
    counts confirm zero re-runs for the bumps and exactly the expected
    readers (30 of 500 data-field readers; all 500 getter readers) for a
    write to `f0`.

| Reader shape on a ReactiveNode VM              | Item 7  | Item 8  |
| ---------------------------------------------- | ------- | ------- |
| 3 data fields each                             | 18.7 ms | 9.3 ms  |
| 3 plain getters each                           | 42 ms   | 3.6 ms  |
| 3 `@select` getters each                       | 24 ms   | 11.5 ms |
| 3 `@memo` getters each                         | 38 ms   | 7.3 ms  |
| Plain-object VM, 3 data fields each (control)  | 7.5 ms  | 6.6 ms  |
| 500 tiny root cells, 1 reader each (control)   | 0.6 ms  | 0.6 ms  |

What remains is fan-out: 500 subscribers each hear the write and run the
skip check (70 to 230 ns per reader). The `@select` shape pays one live
cache lookup per getter read.

## 5. What this means for the cell primitive

The tiny-root pattern is the fastest shape for a revision that has one
reader per record, and minting a root costs about 0.5 µs. It is not slow;
it is a workaround for the validation storm above, and for revisions that
are naturally fields of a view model the field is now the right home. A
first-class cell or boundary primitive is not designed here: the remaining
fan-out cost is the subscriber count of the node, and a boundary marker
would not change who subscribes. Revisit with a measured case where a node
must carry both a hot counter and hundreds of readers of other fields.
