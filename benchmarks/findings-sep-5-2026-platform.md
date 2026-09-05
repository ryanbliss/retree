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

## Item 3: handler diet (`perf/handler-diet`)

Per materialized node before this branch: a 19-field handler (176 B), the
proxy (32 B), a `{ handler, propName }` parent edge (40 B), a WeakMap entry,
and for every non-leaf node a dictionary-mode `Object.create(null)` children
cache (184 B with one key). Measured with `%DebugPrint` and a 200k-object
allocation probe.

Changes: the five kind fields (`mapObject`, `setObject`, `dateObject`,
`arrayObject`, `hasInternalSlots`) become one `kind` enum; the four lazily
built caches (`boundFunctionCache`, `arrayMutatorCache`,
`reproxyArrayMutatorCache`, `collectionProxies`) share one `caches` slot; the
children cache is `Object.create(childrenCachePrototype)`, a fast-mode object
whose empty null-prototype parent keeps "constructor" and "__proto__" from
resolving as phantom children (56 B with one to four keys). The handler is
now 12 in-object fields, 120 B.

50k-row document, base = item 1 (`f935f97`):

| Probe | Item 1 | Item 3 |
| --- | --- | --- |
| Heap per materialized node | 269 B | 189 B |
| Heap for 150k nodes | 38.5 MB | 27.1 MB |
| First scan (materialization) | 53 to 57 ms | 52 to 55 ms |
| Cached scan (single run, `s5` A4) | 17.2 to 17.5 ms | 16.2 to 16.3 ms |
| Steady scan via base proxy (`s6`, median of 15) | 14.5 to 14.7 ms | 15.1 to 16.1 ms (min 14.5 to 14.6) |
| View reads (`s8`, every row) | parity | parity |
| 20k leaf writes with a listened root | 17.8 ms | 17.3 ms |

The two steady-read probes disagree by about the batch-to-batch wobble of
this laptop (5%); a fast-mode children cache costs a little more on a miss
and less on a hit than the dictionary did. Against the original baseline the
per-node heap went 296 to 189 B (36% less).

Not done here: the parent edge object (40 B per node) could flatten into
two handler fields now that views delegate their parent accessor to the base
handler, but 20 call sites read it as an object and several mutate it in
place.

## Item 5: coarse tracked reads (`perf/bulk-read-coarsening`)

Spec: `specs/tracked-read-coarsening.md`. A tracked run used to log one
entry per property read and subscribe `nodeChanged` once per node it read.
On the 50k-row scan that was ~300k entries, 150k listeners, a 54 ms
post-run pass to dedupe sources, and a 46 ms summary rebuild on the first
emission after any re-run.

Changes: a tracked frame keeps one `NodeReadRecord` per raw node (keys,
comparison cells, own keys, presence reads, whole-node flag) in first-read
order, and the record doubles as the validation summary. A record whose
parent was also read is covered; the run subscribes only at its covers. A
cover with covered children uses a new internal subtree listener
(`Retree[SUBSCRIBE_SUBTREE_CHANGED_SYMBOL]`) that delivers
`(changedRawNode, changes)` for any descendant write without reproxying
ancestors. Validation re-reads plain, array, Map, Set and Date owners raw
and `ReactiveNode` owners through the base proxy. Tracked `useSelect` gets
the changed nodes from the composite store's snapshot and validates only
their records.

50k-row document, base = item 3 (`4837c9b`), `ONLY=B`, three alternating
serial rounds:

| Probe | Item 3 | Item 5 |
| --- | --- | --- |
| B1 select subscribe (tracked scan of 150k nodes) | 99 to 101 ms | 42 to 45 ms |
| B2 one related scalar write | 120 to 124 ms | 44 to 46 ms |
| B3 one unrelated scalar write | 27 to 28 ms | 0.04 ms |
| B4 one push | 64 ms | 45 to 57 ms |
| Tracked scan, `s6` median of 15 | 105 to 108 ms | 42 to 43 ms |
| Steady scan via base proxy (`s6`) | 14.2 ms | 14.1 to 14.4 ms |
| First scan (materialization) | 51 to 53 ms | 53 to 55 ms |

The subscribe cost is now the scan itself plus per-read tracking:
`trackDependencyPropertyAccess` 24 ms and `getReadRecord` 17 ms across the
two tracked scans in the profile, with no subscription, summary, or
unsubscribe cost left in the top list. B2 is the selector re-run. B3 is one
parent walk, one map lookup, and no record to validate.

Not done here: the record still allocates two arrays per node; a
struct-of-arrays layout per frame would trade that for index bookkeeping.
Whole-node reads still emit a bare node dependency for `@select`, which is
broader than the record's cells.
