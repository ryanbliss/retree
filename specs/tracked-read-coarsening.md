# Spec: Coarse tracked reads and subtree subscriptions

Status: **implemented** (2026-09-05, `perf/bulk-read-coarsening`). Item 5 of the Sep 2026 platform work
(`benchmarks/findings-sep-5-2026-platform.md`). Stacked on the handler diet
(#77). Measured with `/tmp/rtprof/s5-neo-shapes.ts` phase B: a tracked
`Retree.select` that scans 50k plain rows (150k nodes, ~300k reads).

## 1. Problem

A tracked run (`Retree.select(() => ...)`, `Retree.effect`, auto-trapped
`@select`, tracked `useSelect`) records one entry per property read and
subscribes `nodeChanged` once per node it read. On the Neo-shaped scan that
is:

| Cost                                        | Baseline (item 3 checkout) |
| ------------------------------------------- | -------------------------- |
| Per read: `TrackedNodeRead` + cells array   | ~300k allocations          |
| Post-run: dedupe sources, comparison values | 54 ms                      |
| Subscribe: one `Retree.on` per node         | 150k listeners, ~50 ms     |
| First emission after any re-run: summaries  | ~46 ms rebuild             |
| B1 select subscribe                         | 102 ms                     |
| B2 related scalar write                     | 127 ms                     |
| B3 unrelated scalar write                   | 31 ms                      |

Neo answers this with `Retree.raw` scans and revision cells, which lose
tracking entirely. The goal is a tracked scan that costs about what the scan
itself costs, and a write that costs a lookup plus a raw re-read.

## 2. Design

### 2.1 One read record per node

A `dependencies` frame keeps `Map<rawNode, NodeReadRecord>` in first-read
order. A record holds parallel `keys`/`values` arrays for property and
element reads, an optional own-keys snapshot, optional presence reads, a
`wholeNodeRead` flag, and replayed memo reads. Values are stored as
comparison cells: the raw node identity for managed values, the value itself
otherwise. A one-slot `lastRecord` cache makes consecutive reads on the same
owner skip the map lookup.

The record is the summary: the run exposes the frame map as `reads`, so
nothing is rebuilt on the first emission. `getDependencies()` produces one
`{ node, comparisons }` per record (plus one per replayed read), which also
collapses the `@select` dependency edges from one per read to one per node.

Comparison equality between two runs (the "dependency set changed" signal
that fires `onChange` even when the selected value is equal) becomes: same
records in the same order with equal cells.

### 2.2 Validation reads raw where it can

A record validates by re-reading each captured key and comparing cells with
`Object.is` after unwrapping managed values. Plain objects, arrays, Map, Set
and Date owners read the raw node; a proxy round trip cannot change the
identity they return. `ReactiveNode` owners keep reading through the base
proxy because getters (`@memo`, `@select`, computed) resolve there.
Key scoping (`canSkipTrackedDependencyChange`) keeps today's rules; the
per-record key set is built lazily on first use.

### 2.3 Covers: subscribe at the roots of the read forest

Reads reached by traversal form chains of records: `doc` → `doc.values` →
row → `row.value`. A record whose parent (via the handler's parent edge) is
also a record is _covered_; a record whose parent was not read is a _cover_.
Sources are the covers only:

-   A cover with covered children subscribes to **subtree changes**: a
    write to any descendant delivers `(changedRawNode, changes)` and the
    listener validates that node's record. Nodes with no record are skipped.
-   A cover with no covered children subscribes to `nodeChanged` as today.

Correctness argument: a covered record's every ancestor up to its cover is a
record. Any write that detaches the node from the cover's subtree writes one
of those ancestors, which is validated (its captured child identity changed)
and re-runs the selector before the detached node can change unnoticed.
Nodes obtained from closures or caches have unread parents and stay their
own covers, so nothing is lost for them.

Subtree changes are a new internal listener kind, not `treeChanged`:
`treeChanged` reproxies every ancestor up to the listened node, and that
identity churn is exactly what Neo's tiny-root workaround exists to avoid.
The subtree registry lives beside the other registries in `Retree`, counts
as an observing listener for `ReactiveNode` lifecycle (observed effect,
dependency collection, `clearListeners`), is dispatched by one parent walk
per write while any subtree listener exists, and defers inside transactions
on the changed node's pending entry with its `nodeChanged` records.

### 2.4 React

Tracked `useSelect` maps covers to external-store sources: subtree covers
use `getTreeSnapshotVersion` for the version and the subtree listener for
the subscription. The composite store records the `(rawNode, changes)` pairs
its live subscription receives and attaches them to the next snapshot, so a
snapshot change validates only the records of the nodes that changed; a node
without a record (a descendant the selector never read) is skipped. A
version that moved without a live subscription yields no change list, and
the hook falls back to validating every record under the moved source.

Why this matters: a `@select` getter returns a fresh value on every call, so
validating a record that captured such a getter always reports a change.
Scoping validation to the changed node keeps a write to an unread descendant
from re-running the selector and re-rendering on the new identity.

## 3. Semantics preserved

-   Whole-node reads (a managed value returned or passed on without reading
    a property) still make any change on that node re-run the selector.
-   Primitive reads still count as comparison cells: equal selected values
    with changed reads still notify (`Retree.spec` "compares primitive
    reads").
-   Array element reads compare raw identities; `length` and index writes
    validate as before, and arrays stay excluded from key scoping.
-   Writes during a run still retire the matching read and keep it as a
    write-invalidated validator for `Retree.effect`.
-   `comparisons` mode (memo key functions) is untouched.

## 4. Verification

-   `npm run test`: 981 passed.
-   `s5-neo-shapes.ts` phase B, serial, against `/tmp/rtprof/base4` (the
    handler-diet commit), three alternating rounds:

| Probe               | Item 3 (base4) | Item 5      |
| ------------------- | -------------- | ----------- |
| B1 select subscribe | 99 to 101 ms   | 42 to 45 ms |
| B2 related write    | 120 to 124 ms  | 44 to 46 ms |
| B3 unrelated write  | 27 to 28 ms    | 0.04 ms     |
| B4 push             | 64 ms          | 45 to 57 ms |

-   Steady reads (`s6`) and materialization (`s5` phase A) unchanged.
    Results are recorded in `benchmarks/findings-sep-5-2026-platform.md`.
