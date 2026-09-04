# SDK scaling findings

The SDK keeps ordinary mutable view models, automatic read tracking, narrow subscriptions, changing React identities, links, moves, undo records, and query reconciliation. The stack removes repeated work attached to those features.

Merge these PRs in order. Each branch targets the preceding branch.

| PR                                                | Change                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| [56](https://github.com/ryanbliss/retree/pull/56) | Linear transaction record accumulation and observed ancestor payloads |
| [57](https://github.com/ryanbliss/retree/pull/57) | Iterative single-pass query reconciliation                            |
| [58](https://github.com/ryanbliss/retree/pull/58) | Shared field validation for React tracked selectors                   |
| [59](https://github.com/ryanbliss/retree/pull/59) | Nested raw input normalization and selective managed resolution       |
| [60](https://github.com/ryanbliss/retree/pull/60) | Root-local snapshot settlement and cached listener paths              |
| [61](https://github.com/ryanbliss/retree/pull/61) | Incremental automatic memo validation                                 |
| [62](https://github.com/ryanbliss/retree/pull/62) | Lazy ancestor views and shared live ownership metadata                |
| [63](https://github.com/ryanbliss/retree/pull/63) | Retained dependency records                                           |
| [64](https://github.com/ryanbliss/retree/pull/64) | Serialized polling and cooperative cancellation                       |
| [65](https://github.com/ryanbliss/retree/pull/65) | Silent raw lookup correctness, scaling checks, and diagnostics        |

The original audit used `main` at `2dd618e`, Node 22.13.1 on macOS arm64, production source bundles, and medians of seven warm rounds. Repeating that probe after the runtime changes produced these representative results. Timings describe synthetic workloads, not a live Neo Compose profile.

| Workload                                                          | Original audit | After runtime changes |
| ----------------------------------------------------------------- | -------------: | --------------------: |
| 1,000 transaction writes at depth 1,000 with a root tree observer |       1,844 ms |                188 ms |
| 1,000 writes at depth 1,000 with an unrelated tree observer       |       53.45 ms |               0.79 ms |
| One changed query leaf at depth 800                               |       14.44 ms |          About 0.1 ms |
| Unchanged automatic memo over 10,000 nested rows                  |        3.11 ms |   Below 1 microsecond |
| 5,000 stable dependency records per owner refresh                 |        4.13 ms |               4.11 ms |

The last row is an allocation improvement, not a meaningful timing improvement. Active records survive refreshes; collection still reads arbitrary dependency getters. Likewise, sub-microsecond memo timings should be read alongside the lookup-count tests, not treated as precise speedup ratios.

Run the permanent probe with:

```sh
npm run benchmark:sdk
```

It bundles current source in production mode, uses the benchmark CLI's duration summary, and writes JSON lines. Each sample yields to the event loop and runs GC outside the timed interval. This prevents discarded weakly referenced trees and prior cold-ingestion cases from dominating later measurements. Fixture creation is outside cold-ingestion timings; ingestion is outside cold-scan and selective-resolution timings. The checked-in [sample output](sdk-scaling-2026-09-04.jsonl) uses this protocol and is separate from the matched historical probe above.

Deterministic tests cover work hidden by emission counts: 5,000-level reconciliation visits each incoming child once; unchanged rows stay cold; unrelated React selector writes do not rerun the selector; warm unrelated-root writes avoid ancestor metadata; memo validation stays bounded after unrelated writes; and ten writes under a depth-100 root observer allocate twenty views. Reads between transaction writes still create distinct intermediate identities.

Raw input normalization has a cost. The permanent probe measured about 27 ms to ingest 10,000 rows containing nested detail and tag objects. Each new graph is inspected once to keep embedded managed references out of raw storage. Subsequent raw reads remain zero-copy, and child proxy allocation remains lazy. Do not fold ingestion into a warm-read speedup claim.

`toManaged(row)` preserves value-only lookup, indexes raw slots and refreshes after direct writes, including silent writes, and materializes only the selected child. A cold full-list mount pays for that index. Passing `toManaged(row, { key: index })` avoids it; object properties and Map keys work too. A 100,000-row keyed lookup materialized one row in the permanent probe. The React benchmark reports the compatibility lookup separately and compares keyed resolution with managed indexing.

The audit initially treated constructor aliases as an ownership defect. Existing tests establish that they are intentional references. They retain their managed identity and existing structural parent; an unmanaged shared object's first materialized occurrence establishes its parent. Explicit assignments still require move/link/clone semantics. Retained views now share the base node's live parent metadata. Use explicit links for shared relationships and managed indexing before writing a cold `peekInto` result.

Full devtools snapshots remain proportional to the selected state size because they support exact inspection and time travel. Automatically caching only structural roots would miss changes reached through aliases, links, ignored fields, or arbitrary getters. The permanent probe isolates Retree's cloning cost from browser-extension serialization:

| Ten writes, four roots with 5,000 rows each | Actions | Clones |   Median |
| ------------------------------------------- | ------: | -----: | -------: |
| Snapshot every root                         |      10 |     40 | 43.80 ms |
| Select one root                             |      10 |     10 | 10.60 ms |
| One transaction, all roots                  |       1 |      4 |  4.27 ms |
| `stateSnapshots: false`                     |      10 |      0 | 0.068 ms |

Choose inspected roots explicitly, batch logically related writes, or disable snapshots when investigating action traffic. The snapshot feature and its defaults remain intact. Broad tree observers still require an ancestor walk; arbitrary collection selectors still require reading their inputs when relevant data changes. Those remaining costs are part of the requested behavior.

`npm run lint:architecture` now checks static imports from SDK runtime files into test frameworks and fixture/testing paths, and CI runs it. It does not claim to detect dead exports. Build, typecheck, package publish-shape checks, React concurrency/compiler coverage, undo tests, and the full suite remain the release checks for this stack.
