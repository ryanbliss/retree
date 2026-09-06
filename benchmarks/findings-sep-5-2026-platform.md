# Platform findings, September 5 2026

Follow-on to `findings-sep-5-2026.md` after reading how neo-compose works
around Retree. Every number here is from a single Node process on an idle
laptop, `--expose-gc`, medians where noted. Probe sources live outside the
repo (`/tmp/rtprof/s5-neo-shapes.ts`, `/tmp/rtprof/s6-steady-reads.ts`); the
shapes are described inline so they can be rebuilt.

## Neo-shaped baseline (main at #73, `a023f73`)

Shape: a `ReactiveNode` holding 50k plain rows
`{ id, _id, projectId, value: { classId, fields: { a, b } }, createdAt, updatedAt }`
(150k lazily proxied objects). "Scan" reads `row.value.classId`,
`row.value.fields.a` for one class, and `row.id`.

| Probe | Baseline |
| --- | --- |
| `root()` of the 50k rows | 57 ms (all in `normalizeRawInput`) |
| First scan through the base proxy (materializes 150k nodes) | 67 ms |
| Heap per materialized node | 324 B |
| Steady scan through the base proxy | 14 ms |
| Steady scan through the reproxy view | 14 ms |
| Steady scan through `Retree.raw` | 0.9 ms |
| `Retree.select` subscribe over the scan (tracked reads) | 97 ms, 150k per-node `nodeChanged` listeners |
| One related scalar write under that select | 126 ms (re-run + subscription diff) |
| One unrelated scalar write under that select | 27 ms (first-change access-summary build) |
| One push under that select | 69 ms |
| 10k reads of a memo keyed on three levels of memos, no writes | 164 ms (16 µs per read) |
| 10k reads of a flat-keyed memo | 6.6 ms |
| 100 counter bumps on a VM with 500 `nodeChanged` listeners | 1.6 ms |
| 100 bumps on a tiny `Retree.root({ revision })` cell, 500 listeners | 1.0 ms |

Reading of the baseline against neo-compose's workarounds:

- Raw scans (`unproxiedList`, `Retree.peekInto`) exist because a tracked
  scan installs a listener per row and re-collects every read on each
  invalidation. Steady proxied reads are 15x raw but that is not what loses
  frames; the tracked path is.
- The flat-dependency-array invariant exists because a keyed memo runs its key
  function on every read and select getters never cache.
- The tiny-root `revision` cells are not about listener fan-out on big VMs
  (1.6 vs 1.0 ms per 100 bumps). They are about ancestor propagation and
  per-record subscription granularity.

## Item 2: lazy cycle detection (PR #75)

`normalizeRawInput` removed. `root()` of the 50k rows: 57 ms to 0.3 ms.
Heap per node 324 to 296 B (no normalized-input `WeakSet` entries). First
scan and steady scans unchanged within noise.

## Item 4: get-trap fast path (rejected)

Tried two shapes on top of item 2. Reading the value first and returning
primitives before the children-cache and mutator checks made object reads
pay a second `Reflect.get`: first scan 67 to 85 ms, steady 14 to 21 ms.
Reading once and branching by value type (primitive, function, object) was
still slower: steady scan via base proxy 13.9 to 14.5 ms and via view 13.6
to 14.4 ms across two alternating rounds. The trap body is not the cost;
proxy dispatch and the tracking guard are. Dropped.

## Item 1: views target the raw node (`perf/collapse-reproxy`)

A reproxy was `new Proxy(baseProxy, ReproxyHandler)` with only `get` and
`set` traps. Every `in`, `Object.keys`, `delete`, `defineProperty`, and every
`instanceof`/collected-key check inside the view's own get trap dispatched
through the base proxy a second (and third) time. Views now wrap the raw
node; the reproxy handler resolves reads itself and calls the base handler's
traps directly for writes, presence, keys, and deletes. The
`{ base, handler, view, dirty }` record per node folds into two fields on the
base handler.

Probe shapes: a `ReactiveNode` with ten scalar fields, a method, and one
plain child; a plain root with four scalars and a list; the 50k-row document
above with one row edited so the `values` array has a view. Medians of nine
runs, two alternating rounds.

| Read | Before | After |
| --- | --- | --- |
| 1.8M scalar reads via `ReactiveNode` base | 127 ms | 127 ms |
| 1.8M scalar reads via `ReactiveNode` view | 525 ms | 128 ms |
| 200k child reads via view | 51 ms | 18 ms |
| 200k method reads via view | 55 ms | 15 ms |
| 200k `in` via view | 8.1 ms | 4.3 ms |
| 20k `Object.keys` via view | 67 ms | 46 ms |
| 800k scalar reads via plain view | 95 ms | 22 ms |
| 200k `list[0]` via plain view | 49 ms | 31 ms |
| 50k-row scan via `values` view | 30 ms | 16 ms |
| 20k leaf writes with a listened root (2 views each) | 17 ms | 17 ms |

A view read now costs what a base read costs. `useNode` hands components a
view, so this is the common React read path.

Materialization of the 50k-row document (single run each): first scan 68 to
59 ms, heap per node 296 to 269 B. The per-node record was the only
allocation removed.
