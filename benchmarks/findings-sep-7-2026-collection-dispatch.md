# Collection dispatch experiment, September 7, 2026

Stacked on PR #100 at `24f98a5`. Runtime experiment `2a2d4d6` caches Map and Set method wrappers in the existing per-handler bound-function cache. Benchmark correction `c48f3d9` forces separate base and view identities. Precompiler baseline is `a889d81`. Neo uses the same worktree at `0429c817` and the same Neowyn fixture as the PR #100 measurements.

The experiment adds no handler fields, collection subclasses, compiler transformation, runtime exports, or second mutation implementation. A private method creates wrappers on cache misses using the existing Map/Set read and mutation functions. Cache entries are replaced when the source function changes. Captured methods remain bound to their collection and work across view generations.

[Raw rounds, frame samples, commands, and procedures](collection-dispatch-sep-7-2026.jsonl) include five lanes measured in the same session. Three serial rounds use forward, reverse, then rotated lane order. No timing outliers are excluded. Numbers describe these samples on an Apple M3 Max with Node 22.13.1, not confidence intervals or guaranteed application speedups.

The initial Map benchmark requested a view before mutating the model. All 15 initial Map runs were discarded and repeated after adding identity assertions for the model and both child Maps. The reported data uses only that corrected full matrix. Other benchmarks already assert their view identities.

## Interpretation

Keep this as a draft experiment. With the compiler enabled, hot-key primitive Map.get improves from 48.60 to 42.82 ns on the base and from 55.14 to 44.91 ns on the view relative to #100. Varied-key lookups do not show a reliable improvement, and the Neo workloads show no clear application gain over #100.

Caching three methods on 10,000 small Maps retains an additional 6,734,144 bytes relative to #100: about 673 bytes per Map, or 83% more for this deliberately small-Map workload. This percentage is not a prediction for larger Maps. Plain-object retained heap is effectively unchanged. The full core bundle adds 91 gzip bytes.

The direct helper prototype is slower than cached proxy dispatch. These results do not justify adding a compiler rewrite or replacing native Map subclasses. They support a narrow dispatch experiment with a material memory cost, not a general recommendation to enable this cache.

## Map methods

Each read scenario performs 200,000 operations per sample, with three warmup runs and nine measured samples. Each cell is the median of three run medians, in nanoseconds per operation. Changed scalar writes use 2,000 operations per sample. Checksums are asserted outside timing.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| Map.get primitive via raw | 3.61 | 2.83 | 3.69 | 2.80 | 3.92 |
| Map.get primitive via base | 52.02 | 52.95 | 48.60 | 41.19 | 42.82 |
| Map.get primitive via view | 57.22 | 58.27 | 55.14 | 44.08 | 44.91 |
| Map.has via base | 57.69 | 55.06 | 56.26 | 42.01 | 42.88 |
| Map.has via view | 59.22 | 58.75 | 58.34 | 44.85 | 45.54 |
| Map.get object + field via base | 117.02 | 114.74 | 110.31 | 108.89 | 110.68 |
| Map.get object + field via view | 125.32 | 122.21 | 115.77 | 115.40 | 115.32 |
| parent + Map.get via base | 86.81 | 86.25 | 55.53 | 71.26 | 47.54 |
| parent + Map.get via view | 87.86 | 89.23 | 60.99 | 75.63 | 50.43 |
| Map.set property lookup via base | 39.82 | 39.55 | 36.03 | 35.73 | 34.82 |
| Map.set changed scalar via base | 211.56 | 213.75 | 216.04 | 170.06 | 170.58 |
| Map.set changed scalar via view | 213.00 | 213.77 | 216.50 | 152.38 | 150.19 |

The following control cycles through 50,000 keys in a fixed permutation; values are scalars. Units are ns/lookup.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50k Map.get varied keys via raw | 29.86 | 29.51 | 30.29 | 30.81 | 32.37 |
| 50k Map.get varied keys via base | 112.42 | 107.55 | 109.40 | 105.17 | 112.70 |
| 50k Map.get varied keys via view | 115.90 | 113.60 | 113.91 | 112.61 | 123.29 |

The compiler-on experiment is slower than #100 in this control, including its unchanged raw-Map control. This sensitivity limits conclusions from the hot-key microbenchmark; no broad Map lookup gain is established.

The object-value scenario includes a managed child-field read. The parent scenario includes reading the collection field from its ReactiveNode. These separate collection dispatch from the remaining object and model access costs. The method-lookup scenario measures repeated reads of `map.set`; its identity is stable in the experiment.

## Direct helper prototype

The benchmark also calls a helper that resolves the managed receiver's existing handler and invokes its `get` implementation directly. It bypasses the JavaScript Proxy trap and reuses the existing read path. This is an ideal managed-only probe; a production compiler transformation would also need raw-receiver fallback and evaluation-order safeguards. It is benchmark code, not a new runtime API.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| prototype helper Map.get via base | 53.22 | 53.27 | 50.22 | 44.41 | 44.43 |
| prototype helper Map.get via view | 60.19 | 60.37 | 57.73 | 51.26 | 52.15 |

## Scalar reads and lists

Scalar samples perform 1.8 million reads. The following table converts the same medians to ns/read.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| ReactiveNode scalar reads via empty Proxy | 9.46 | 9.54 | 9.60 | 9.47 | 9.33 |
| ReactiveNode scalar reads via base | 36.59 | 36.79 | 9.77 | 36.95 | 9.84 |
| ReactiveNode scalar reads via view | 35.63 | 36.06 | 9.10 | 36.18 | 9.11 |

The following list scenarios are milliseconds per sample. All remaining array-method rows are in the raw artifact.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50k row scan via base | 11.769 | 11.931 | 11.656 | 11.806 | 11.670 |
| 50k row scan via view | 11.956 | 11.990 | 11.551 | 11.994 | 11.943 |
| rows.at(i) x50k via base | 4.455 | 4.526 | 4.639 | 4.530 | 4.597 |
| rows.flatMap(row => [row.id, row.done]) via base | 4.947 | 5.059 | 5.294 | 5.088 | 5.219 |
| for..of rows.entries() via view | 3.576 | 3.648 | 4.063 | 3.742 | 3.930 |

## Neo frame changes

`CharacterBody`, `Walk`, 24 measurements in each cold/warm/steady pass. The fixture has 4,891 values, 769 members, 175 classes, and 2,235 constructed preview rows. Cells show all three run medians in milliseconds.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold first visit | 10.49 / 13.79 / 13.91 | 11.57 / 17.66 / 13.84 | 12.87 / 13.96 / 13.28 | 14.02 / 14.01 / 13.70 | 13.31 / 13.79 / 14.21 |
| Warm revisit | 6.11 / 9.89 / 8.90 | 7.33 / 9.74 / 8.36 | 7.16 / 8.79 / 8.40 | 8.20 / 9.65 / 8.22 | 9.14 / 8.59 / 8.89 |
| Steady revisit | 6.49 / 8.86 / 9.36 | 6.35 / 13.04 / 8.42 | 6.56 / 8.02 / 8.26 | 8.16 / 8.71 / 8.49 | 8.11 / 12.94 / 8.40 |

## Neo heavy lane and isolated overlays

The original ten heavy files run with file parallelism disabled. All 30 tests passed in each of 15 runs. The isolated overlay file passed all four tests in each of 15 runs. The table shows median milliseconds across three runs. Draft flush values are each test's mean of ten flushes.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| Draft flush, 400 roots | 1.32 | 1.38 | 0.78 | 1.36 | 0.79 |
| Draft entry, 400 roots | 1.70 | 1.70 | 1.30 | 1.70 | 1.30 |
| Sparse paint, 50k + 50k placements | 0.74 | 0.83 | 0.75 | 0.77 | 0.82 |
| 10k exact subscriber mount | 39.50 | 42.80 | 42.20 | 40.40 | 41.40 |
| 400 collapsed roots, cold | 183.70 | 184.40 | 182.70 | 180.70 | 180.70 |
| Objects catalog, cold | 20.40 | 21.10 | 20.50 | 20.20 | 20.40 |
| 120 overlays, full heavy lane | 10.40 | 10.20 | 8.00 | 10.30 | 8.90 |
| 120 overlays, isolated file | 9.70 | 8.10 | 8.50 | 8.90 | 8.60 |

The overlay control uses native Maps and Neo's existing `OverlayValueMap`, outside Retree management. It is not a direct benchmark of the optimized path. Many Neo Maps are ignored caches or temporary indexes; counting Map declarations does not establish exposure to managed-Map overhead.

## Babel time and output size

Same 1,338-file corpus and 13 cross-file base names as PR #100. Each lane uses a fresh process with one complete warmup pass before a measured pass. There are three timed processes per lane, in the matrix order. All use the same `next/babel`, decorators, Node-current targets, and noncompact output. This process setup differs from the earlier two-lane in-process test, so use the matched table below for comparisons.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| Babel pass, all rounds, ms | 10122.57 / 10165.27 / 10028.39 | 10148.25 / 10068.49 / 10020.48 | 10971.48 / 10930.24 / 10895.66 | 10339.84 / 10414.43 / 10374.17 | 10848.27 / 10611.82 / 10810.66 |
| Babel pass median, ms | 10122.57 | 10068.49 | 10930.24 | 10374.17 | 10810.66 |
| UTF-8 output bytes | 11,473,153 | 11,473,153 | 12,783,375 | 11,473,153 | 12,783,375 |
| Compiled classes | 0 | 0 | 130 | 0 | 130 |

The compiler source and generated output are unchanged from #100. Differences between #100 and the experiment's Babel timings are therefore a control for process/JIT/machine variation, not a compiler optimization.

A separate single-pass CPU profile per lane records inclusive sampled time under the compiler package. It includes work called from the compiler visitor but excludes later Babel traversal and printing. These fresh-process profiles are separate from the warm timed passes.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| Compiler-inclusive profile, ms | 0 | 0 | 112 | 0 | 124 |

## Clean sample builds

Three clean production builds per lane for each sample, using the same current sample source. Compiler-off configurations explicitly remove the compiler plugin. Vite clears `dist` and its local optimization cache; Next clears `.next`. Next uses an offline placeholder Convex URL. Each cell lists all three wall-clock durations in milliseconds.

| Scenario | Precompiler off | #100 off | #100 on | Experiment off | Experiment on |
| --- | ---: | ---: | ---: | ---: | ---: |
| vite | 806.83 / 578.69 / 581.31 | 582.36 / 588.58 / 581.14 | 629.05 / 650.37 / 642.84 | 573.69 / 574.88 / 571.14 | 628.00 / 629.13 / 635.39 |
| next | 5070.30 / 4486.26 / 4433.23 | 4468.49 / 4508.87 / 4397.81 | 4560.45 / 4549.42 / 4625.14 | 4382.70 / 4971.39 / 4461.40 | 4554.75 / 4499.03 / 4476.80 |

## Bundle size and retained heap

Full core API bundles use browser ESM, es2022, minification, and gzip. Heap probes use fresh `--expose-gc` processes, five alternating rounds, warmup outside measurement, and checksums. Module loading is excluded from retained workload allocation.

| Variant | Minified bytes | Gzip bytes | 100k nested plain rows, retained bytes | 10k managed Maps, retained bytes |
| --- | ---: | ---: | ---: | ---: |
| precompiler | 112447 | 30419 | 65210960 | 8103496 |
| pr100 | 113492 | 30742 | 65216224 | 8117304 |
| experiment | 113734 | 30833 | 65216312 | 14851448 |

The Map workload calls `get`, `has`, and `set` on every live Map. It deliberately exposes the retained cost of caching those three methods. The plain-row workload exercises no collection methods. Both contain ordinary objects rather than compiled model classes, so compiler enablement would not change their representation.

The existing compiler-overhead probe was also rerun against both the precompiler revision and #100, including the optional-runtime-loaded variant. Its detailed five-process results are in the raw artifact. The probe asserts that the optional compiled runtime is absent from compiler-off bundles.

## Browser validation

Both samples are checked in all five lanes in actual browser sessions. Vite edits change `Card.iterate` from +1 to +10 and verify the next click. Next edits change the memo-backed submit threshold and return a managed marker row from the selector, then check behavior before and after reload.

`useRoot` owns the stable base instance; `useNode` subscribes and returns a view. Fast Refresh retains the existing Next model roots in both compiler modes, so reload is required to recreate them from the edited class. This is verified separately from the Vite sample, which recreates its roots during HMR. Expected offline Convex WebSocket errors are distinguished from runtime-error overlays.

All temporary source/configuration edits, build outputs, and Neo dependency installations are restored after the checks. No live Convex backend or deployment is involved.

## Verification and scope

Retree's full suite passed 1,686 tests, including the core proxy and compiled lanes. Typecheck, doctor, architecture lint, and package builds passed before the matrix. The full test suite, typecheck, doctor, and architecture lint also passed after the final benchmark additions. The regression tests cover extracted Map/Set methods across changes and views, plus custom subclass method replacement and raw receiver binding.

This experiment optimizes repeated collection method dispatch. It does not replace native collections or introduce a second implementation of collection mutations. The compiler helper remains a measured prototype. Full Neo unit-suite validation is outside this matrix; the same selected production-scale frame and heavy suites from #100 are rerun here.
