# Where Retree's time goes in Neo's mount, September 8, 2026

Retree at the head of `experiment/lazy-child-adoption` (PR #106), packed and installed into the Neo worktree `retree-0-10-4`. Neo's `scripts/benchmark-world-animation-frame-change.heavy.test.tsx` loads the checked-in Neowyn CharacterBody fixture (7.1 MB JSON, 6,179 records in 17 kinds). Apple M3 Max, Node 22.13.1, serial runs. Raw numbers, counters, and profile summaries are in [neo-mount-cost-sep-8-2026.json](neo-mount-cost-sep-8-2026.json).

This is a measurement, not a change. It answers "what does materializing Neowyn's corpus cost" against the real mount path instead of the synthetic exhaustive walk used by the last five PRs.

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
