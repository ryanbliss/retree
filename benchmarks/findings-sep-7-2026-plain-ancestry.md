# Plain-object ancestry optimization, September 7, 2026

First materialization of deep plain-object trees is faster after removing a redundant ancestor walk. This is the successful continuation of #104, stacked on #103 at `93ba2bfbc15d7d68389b1493756c72d44f488710`. The final implementation keeps ordinary proxies. The failed accessor facade and its optional SDK factory changes have been removed. Its historical report and raw samples remain available.

## Why the check is redundant

`getOrCreateProxiedChildHandler` checks the raw-to-managed WeakMap before creating a child. When no handler exists, it already passes `knownUnmanaged = true` to `buildProxyHandler`. Every ancestor has a registered handler before its children are built, so this fresh raw object cannot be an ancestor. The change skips the ancestor walk only under that existing precondition.

Existing managed children, shared-node edges, and reparenting retain their cycle checks. A raw graph that closes a cycle eventually reaches an already-managed object and still fails. A new test covers a cycle after a long chain of fresh children; the existing plain/class/collection/write/link cycle cases also pass. No raw input pre-scan, schema inference, compiler transform, duplicated runtime logic, or new handler fields are introduced.

A 5,000-deep fresh chain previously performed about 12.5 million ancestor comparisons while materializing its children. The fast path avoids those comparisons. This is a runtime optimization available to both compiled and uncompiled users, not a compiler-specific speedup.

## Repeated materialization results

Apple M3 Max, macOS 26.6.2, Node 22.13.1. Eight serial blocks for each matrix, one process per variant per block, five measured fresh graphs after two warmups. Order reverses each block. Benchmark processes ran without concurrent tests, typechecks, or other benchmark workers. Every sample validates traversal output. No raw samples were filtered out.

Input construction and GC precede timing. Root creation is timed separately. First traversal exhaustively exposes the requested plain nodes; cleanup follows timing. These are cold managed nodes with warmed code, not cold process/JIT measurements. Tables show medians of eight process medians. Root, combined root-plus-first-traversal, warm traversal, and every warmup/sample are in the raw artifact.

| First traversal, ms | #103 compiler off | Optimized off | #103 compiler on | Optimized on |
| --- | ---: | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 8.856 | 8.484 | 9.387 | 9.437 |
| full materialization 100x100 | 16.360 | 15.730 | 16.356 | 16.094 |
| 5000-deep full traversal | 89.209 | 1.235 | 95.358 | 1.311 |
| existing synchronous materialization 10k rows | 4.670 | 4.560 | 4.779 | 4.648 |
| plain forest depth 16, 16371 nodes | 4.971 | 4.450 | 5.169 | 4.674 |
| plain forest depth 64, 16380 nodes | 5.830 | 4.263 | 6.072 | 4.549 |
| plain forest depth 256, 16191 nodes | 9.737 | 4.266 | 10.224 | 4.644 |
| plain forest depth 1024, 15375 nodes | 38.714 | 3.966 | 42.130 | 4.134 |
| explicit prepareTree, 16191 plain nodes | 28.044 | 21.822 | 28.565 | 21.519 |
| Neowyn fixture exhaustive plain traversal | 56.134 | 55.452 | 56.082 | 55.087 |

The original first-touch tree and its full traversal share the existing core perf fixture. The row workload adapts the existing synchronous materialization benchmark with loops instead of the generator driver. Forests hold approximately the same number of nodes while varying depth. The explicit `prepareTree` case uses a ReactiveNode with 16,191 plain descendants, prepares all of them, then checks their values. It exercises actual compiled and uncompiled class behavior. The pure plain-object cases have no class for the compiler to transform, so their on/off lanes serve as controls.

| Forest depth | #103 ns per plain node | Optimized ns per plain node |
| --- | ---: | ---: |
| 16 | 303.7 | 271.8 |
| 64 | 355.9 | 260.3 |
| 256 | 601.4 | 263.5 |
| 1024 | 2518.0 | 257.9 |

These are amortized first-traversal nanoseconds per plain chain node with the compiler off, including traversal and container overhead. They are not isolated scalar-read timings. The optimized per-node cost stays roughly flat as depth increases.

## Effects and uncertainty

Effects below use the geometric mean of paired process-median ratios within each block. Intervals are nominal 95% percentile bootstrap intervals from 20,000 resamples of the eight blocks, seed 10407. The five samples within a process are not treated as five independent runs. These intervals do not correct for multiple comparisons and do not establish cross-machine or Neo-wide gains. Positive percentages mean less time.

| Workload | Compiler off reduction, nominal 95% interval | Compiler on reduction, nominal 95% interval |
| --- | ---: | ---: |
| existing first-touch scan 100x100 | -0.3% [-6.7%, 4.6%] | 0.8% [-3.8%, 4.9%] |
| full materialization 100x100 | -0.6% [-7.0%, 4.7%] | 0.6% [-3.2%, 3.6%] |
| 5000-deep full traversal | 98.6% [98.5%, 98.7%] | 98.6% [98.6%, 98.7%] |
| existing synchronous materialization 10k rows | 0.6% [-3.9%, 3.7%] | 2.9% [-0.5%, 5.8%] |
| plain forest depth 16, 16371 nodes | 8.8% [4.3%, 11.6%] | 13.8% [6.1%, 24.2%] |
| plain forest depth 64, 16380 nodes | 25.7% [22.5%, 27.9%] | 28.6% [21.4%, 37.9%] |
| plain forest depth 256, 16191 nodes | 56.0% [54.4%, 57.9%] | 54.8% [53.0%, 56.7%] |
| plain forest depth 1024, 15375 nodes | 89.7% [89.5%, 90.0%] | 90.1% [89.6%, 90.3%] |
| explicit prepareTree, 16191 plain nodes | 20.5% [18.1%, 22.5%] | 23.6% [18.0%, 28.3%] |
| Neowyn fixture exhaustive plain traversal | 1.6% [0.9%, 2.3%] | 1.3% [-2.4%, 4.6%] |

The deep-tree result is consistent across both modes. The shallow tree and 10,000-row controls do not establish an improvement. Warm traversal stays close because it reuses existing materialized nodes and does not take the optimized creation path.

## Real Neowyn data

The exhaustive fixture probe uses `neo-compose/scripts/fixtures/neowyn-character-body-runtime-state.json.gz`, the same checked-in data used by the world-animation frame test. It clones the raw JSON outside timing, roots it, and iteratively reads every enumerable property. It does not construct Neo view models or render React. The fixture itself is not copied into this repository. Its hash and object-depth histogram are recorded in the raw artifact.

This data has a maximum object depth of 25. First traversal moved from about 56 ms to 55 ms. The off lane shows a small nominal improvement, but the on interval includes no change; this does not establish a meaningful Neo load-time win. The stronger evidence is the deep plain-tree and explicit eager-preparation improvement.

## Bundle and build check

A minified browser ESM consumer of `Retree.root({ rows: [] })`, target ES2022, grew from 99,310 to 99,314 bytes; gzip from 27,875 to 27,878 bytes; Brotli from 24,487 to 24,535 bytes. These are compressed bundle measurements, not heap usage. The change adds no fields or allocations.

Eight serial reversed-order esbuild pairs after warmup measured medians of 9.00 ms for #103 and 7.12 ms for the optimized consumer. This is a small local bundle probe, not evidence of faster application builds. No compiler transform changed; no Next.js or Babel-corpus build improvement is claimed. The reproducible probe uses esbuild `bundle`, `minify`, browser platform, ESM, ES2022, `write: false`, and Node gzip/Brotli defaults. Every build observation is retained.

## Reproduce

Archive the frozen #103 commit to a temporary baseline directory and provide dependencies. Copy the current `benchmarks/plain-materialization.mts` and `packages/retree-core/src/test-fixtures/materialization.ts` into matching paths in that archive without changing its SDK source.

```sh
node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON
RETREE_MATERIALIZATION_SCENARIO=prepareTree node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY PREPARE_JSON
RETREE_MATERIALIZATION_SCENARIO=Neowyn RETREE_PLAIN_FIXTURE=/path/to/neowyn-character-body-runtime-state.json.gz node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY FIXTURE_JSON
```

The saved traversal matrix preceded the additional prepared-class and optional Neowyn cases. Those cases were measured separately using the filters above. Running the full script now includes the prepared-class case at the end. Neither the fixture contents nor an external Neo checkout is required for the synthetic cases.

Raw observations, paired effects, and fixture metadata: [plain-ancestry-sep-7-2026.json](./plain-ancestry-sep-7-2026.json). Historical facade evidence: [original report](./findings-sep-7-2026-plain-materialization.md).

## Validation

All 1,688 SDK tests passed with one worker. Full typecheck, benchmark typecheck, core build, doctor, and architecture checks passed. The new long-cycle regression is covered in both core test lanes.

All 30 tests in the original ten Neo heavy files passed with one worker and file parallelism disabled using the matching compiler/runtime. The initial attempt mixed Neo's newer installed compiler with this stack's runtime and failed on a missing helper; replacing both packages with the matching build resolved the failures. Neo's existing packages and configuration were restored. These heavy-suite runs validate behavior and are not timing comparisons.
