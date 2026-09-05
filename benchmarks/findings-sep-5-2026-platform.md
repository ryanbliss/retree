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
