# Where Retree's time goes in Neo's mount, September 8, 2026

Retree at the head of `experiment/lazy-child-adoption` (PR #106), packed and installed into the Neo worktree `retree-0-10-4`. Neo's `scripts/benchmark-world-animation-frame-change.heavy.test.tsx` loads the checked-in Neowyn CharacterBody fixture (7.1 MB JSON, 6,179 records in 17 kinds). Apple M3 Max, Node 22.13.1, serial runs. Raw numbers, counters, and profile summaries are in [neo-mount-cost-sep-8-2026.json](neo-mount-cost-sep-8-2026.json).

The first half answers "what does materializing Neowyn's corpus cost" against the real mount path instead of the synthetic exhaustive walk used by the last five PRs. The second half, [What changed](#what-changed), is the three read-path trims the profile pointed at and what they bought.

## How the corpus reaches Retree

One root. `ProjectProvider.tsx` creates a single `ProjectVM` with `useRoot`; its constructor builds one plain `ProjectDocumentState` object (26 arrays of plain records plus a few scalars) and stores it in a `ProjectDocumentStateNode`. Every VM getter reads through that object. There is no Convex subscription for the corpus; a revision-marker query triggers delta catch-up.

Records are stored in Convex as `projectRecordSnapshots.dataJson`, an opaque JSON string. The Convex validator describes the envelope only. Record shapes exist as TypeScript interfaces and hand-written guards (`isAnyMember`, `isNeoSchemaClass`, and so on). A compiled document representation driven by Convex validators has no input in Neo.

## Phase timings on this branch

Three runs of the heavy test, unprofiled run first.

| Phase | Run 1, ms | Run 2, ms | Run 3, ms |
| --- | ---: | ---: | ---: |
| documentLoad (raw parse and guards, no Retree) | 60.4 | 54.0 | 54.3 |
| vmBuild (corpus into `ProjectVM`) | 35.6 | 25.6 | 23.0 |
| constructorReplaySetup | 1617.6 | 1609.8 | 1591.1 |
| constructorReplay | 371.5 | 372.0 | 368.3 |
| initialMount | 383.8 | 366.6 | 415.6 |
| panelHydration | 2126.7 | 2109.6 | 2059.2 |
| clipHydration | 1775.1 | 1792.8 | 1792.2 |

`vmBuild` has 0.0 ms of Retree self time in its CPU profile. Its cost is Neo's `cloneConvexState` JSON round trip (18.7 ms), which production skips with `owned-plain` ownership. Materialization is lazy, so the corpus costs nothing to root.

## Get-trap counts per phase

A scratch counter in the installed core build counted every base get-trap call by node kind and, for `ReactiveNode` targets, by key role.

| Phase | Plain | ReactiveNode | Array | Tracked | Handlers built |
| --- | ---: | ---: | ---: | ---: | ---: |
| vmBuild | 1 | 29 | 0 | 0 | 36 |
| constructorReplaySetup | 5,736,846 | 2,354,628 | 145,593 | 17,753 | 23,573 |
| constructorReplay | 743,699 | 971,649 | 58,548 | 7,639 | 9 |
| initialMount | 83,479 | 160,525 | 14,843 | 31,149 | 853 |
| panelHydration | 152,753 | 328,390 | 3,255 | 4,604 | 540 |

ReactiveNode reads in constructorReplaySetup split into 1,090,513 field reads, 668,351 getter reads, and 595,764 `@ignore` reads. Only 0.2% of the 8.2 million reads in that phase happen inside a dependency frame. View (reproxy) reads are negligible everywhere except initialMount (3,910).

## Retree's share

CPU profiles of single phases, inspector overhead excluded from the share.

| Phase | Profiled, ms | Retree self, ms | Share | Largest Retree self costs, ms |
| --- | ---: | ---: | ---: | --- |
| constructorReplaySetup | 1,739 | 551 | 32% | get trap 318, `readReactiveNodeGetter` 48, metadata probe 34, `readArrayElement` 28, array `find` wrapper 18, `adoptStoredProxy` 14, `ownKeys` 9 |
| initialMount | 415 | 51 | 12% | get trap 9, `readReactiveNodeGetter` 8, metadata probe 6 |
| vmBuild | 26 | 0 | 0% | none |

In constructorReplaySetup that is about 67 ns of Retree per read all-in, with 39 ns inside the get trap itself. The engine floor for a Proxy get with a trivial trap is 23 ns. Proxy enumeration is not on the mount path: `ownKeys` is 9 ms, and the enumeration and stringify sites the code search found (`reconcileObject`, `collectChangedRecordIds`, `stableHydrationStringify`) run on delta catch-up and version switch.

The remaining 68% of constructorReplaySetup and 88% of initialMount is Neo's own evaluation and React rendering.

## The synthetic walk, for comparison

`npm run benchmark:corpus` with `RETREE_PLAIN_FIXTURE` set to the fixture (42,912 nodes, 149,760 reads):

| Step | ms |
| --- | ---: |
| JSON.parse | 11.9 |
| Raw walk, reads only | 2.9 |
| First walk through Retree (materializes every node) | 20.5 |
| Warm walk, untracked reads | 10.9 |
| Warm walk inside a tracked frame | 28.8 |
| `Object.keys` on every proxy, untracked | 43.6 |
| `Object.keys` on every proxy, tracked | 70.3 |
| `JSON.stringify` through proxies | 63.6 |
| `JSON.stringify(Retree.raw(root))` | 6.8 |

The walk that materializes everything costs 20 ms. Production never does it; it materializes 23.6k of the 42.9k nodes over the course of constructor replay, at a few hundred nanoseconds each.

## Representation floors for a compiled document

Node 22, 40,000 eight-key objects, no Retree.

| Representation | Create, ms | 320k reads, ms | `Object.keys`, ms | Spread, ms |
| --- | ---: | ---: | ---: | ---: |
| Proxy with get and ownKeys traps | 0.46 | 7.54 | 46.9 | 98.0 |
| Class with prototype accessors | 0.30 | 4.49 | 0.6 (returns nothing) | 1.0 (empty) |
| Instance with own accessors | 35.38 | 3.70 | 0.6 | 6.8 |
| Raw object | 0.23 | 1.30 | 0.45 | 3.7 |

Prototype-accessor classes are the only viable compiled form, and they hide fields from `Object.keys`, spread, and `for...in`. Neo's `reconcileObject` enumerates managed records with `Object.keys`, so an automatic switch would silently reconcile nothing. Own accessors are 880 ns per instance to create. `Object.preventExtensions` costs 17 ns per instance and makes undeclared writes throw.

Ceiling estimate for compiled plain records in constructorReplaySetup: reads go from about 67 ns to roughly 30 ns, on 5.7 million plain reads, or about 210 ms of 1.6 s. That needs runtime shape inference (614 distinct shapes in the fixture, many single-use id-keyed dictionaries) and an opt-in, since enumeration breaks.

## Conclusions

- Materializing the corpus is not the cost. Rooting it is free and materialization is spread thinly through evaluation.
- Retree's cost in Neo's heaviest phase is per-read trap overhead on untracked reads: 8.2 million reads, 0.2% tracked, 32% of the phase.
- A Convex-schema compiled document cannot be built for Neo; the record payloads carry no validator.
- The levers that remain, with their measured ceilings in constructorReplaySetup: Neo reading raw rows in the evaluators that never track (up to about 500 ms, Neo-side); compiled plain shapes by inference (about 210 ms, opt-in, breaks enumeration); the ReactiveNode compiler on 2.35 million ReactiveNode reads (about 70 ms); trimming the plain get trap (roughly 60 to 90 ms).

## What changed

Three trims, each picked from the constructorReplaySetup profile above and measured the same way (same fixture, same phase profile, inspector time excluded).

1. **Getter results are not stored slots.** A `ReactiveNode` getter read through the base or view trap used to send its result through `resolveStoredObject`: a metadata probe, an own-property descriptor lookup that a getter never satisfies, and `adoptStoredProxy` for a managed result. Neo's view-model getters (`projectVM`, `documentState`, `snapshot`, `baseMembers`, and so on) return managed nodes on about 550k of the 668k getter reads in this phase. The traps now serve a getter result as returned, at its latest identity when it is a managed node, which is what compiled classes already did. Each handler also carries a `keyless` flag instead of probing a prototype WeakSet on every getter read, and `@ignore` and `@link` reads resolve a managed value with one metadata probe instead of two.
2. **Array callback wrappers walk without a visitor closure.** `forEach`, `map`, `filter`, `find`, `findIndex`, `some`, `every`, `reduce`, `flatMap`, and `slice` each loop over the raw array themselves, and a primitive element is served straight from its slot with no hole check and no element resolver call.
3. **Memo comparison snapshots allocate less.** The captured values of a comparison accessor are normalized in place instead of copied first, and a captured value that is not an explicit `{ node, comparisons }` dependency is compared as itself instead of through a freshly built dependency slot.

### Retree self time in constructorReplaySetup, ms

| Function | Before | Getter trim | All three |
| --- | ---: | ---: | ---: |
| get trap | 318.5 | 250.4 | 235.8 |
| `readReactiveNodeGetter` | 47.6 | 25.8 | 31.1 |
| metadata probe | 33.7 | 12.6 | 10.0 |
| `adoptStoredProxy` | 13.8 | 0.0 | 0.0 |
| `array-read.js`, all functions | 68.9 | 71.5 | 58.8 |
| memo comparison normalization | 9.0 | 17.5 | 3.7 |
| Retree self, total | 550.9 | 450.7 | 424.0 |
| Phase, profiled | 1,739 | 1,645 | 1,653 |

Retree's share of the phase goes from 32% to 26%. The get trap's own drop is the getter branch no longer reaching the stored-object path; the trap body for a plain read is unchanged and sits about 7 ns above the 23 ns engine floor.

### Wall clock, ms

Unprofiled heavy-test runs. "Before" and "Getter trim" are an interleaved series of three each (a fourth pair failed a Neo paint-interval budget unrelated to Retree); "All three" is three runs afterwards. Run-to-run spread on this test is about ±100 ms, so the profile table above is the signal and this table is the sanity check.

| Phase | Before | Getter trim | All three |
| --- | ---: | ---: | ---: |
| constructorReplaySetup | 1,647 / 1,583 / 1,580 | 1,527 / 1,551 / 1,773 | 1,570 / 1,535 / 1,556 |
| constructorReplay | 360 / 404 / 359 | 354 / 403 / 404 | 359 / 387 / 363 |
| initialMount | 367 / 365 / 408 | 381 / 395 / 431 | 392 / 369 / 364 |

### Array callback methods, ms

A scratch probe in the shape of `benchmarks/array-reads.mts`, not committed: 50k rows `{ id, done }` and a 50k number list under `Retree.root`, every row materialized, median of 15, two serial samples per cell (base worktree at the #106 head versus this branch).

| Read | Before | After |
| --- | --- | --- |
| `ids.find(last)` via base | 0.886 / 0.875 | 0.402 / 0.401 |
| `ids.map(x => x)` via base | 0.954 / 0.933 | 0.584 / 0.577 |
| `ids.find(last)` via view | 0.884 / 0.898 | 0.400 / 0.399 |
| `rows.map(row => row.id)` via base | 2.338 / 2.305 | 2.123 / 2.239 |
| `rows.forEach` via base | 2.193 / 2.219 | 2.075 / 2.098 |
| `rows.filter(done)` via base | 2.414 / 2.465 | 2.285 / 2.242 |
| `rows.filter(done)` via view | 2.645 / 2.733 | 2.311 / 2.301 |
| `rows.find(last)` via base | 2.005 / 1.931 | 2.015 / 2.031 |
| `rows.every(row => row.id >= 0)` via base | 2.264 / 2.268 | 2.170 / 2.113 |

Lists of primitives drop 40 to 55%; lists of records 5 to 14%, because the callback's own `row.id` read through the element proxy is most of what remains. `npm run benchmark:node-reads` and `npm run benchmark:array-reads` moved within ±3% on every scalar-read and scan scenario; `rows.slice()` via view dropped 34% and `flatMap` 14 to 16%.

### Not shipped

- Calling a cached prototype getter directly instead of `Reflect.get(instance, prop, receiver)`: 30 ns to 18 ns per getter read in isolation, about 8 ms of this phase, and it needs a per-instance check for an own data property shadowing the getter. Not worth the machinery.
- Per-read trimming of the get trap for plain reads: the body is about 7 ns above the trivial-trap floor.

