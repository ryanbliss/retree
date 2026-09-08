# Collection dispatch: paired follow-up and Neo coverage

This follow-up compares frozen #100 `24f98a5` against the same runtime experiment `2a2d4d6`, with the compiler enabled in both. It does not change runtime code. Original five-way measurements remain in the [original report](findings-sep-7-2026-collection-dispatch.md).

## Findings

The repeated hot-key Map improvements reproduce. They are statistically detectable in this session, including correction across all 23 scenarios. The strongest comparisons have an exact two-sided randomization p of 0.00216 and Holm-adjusted p of 0.04978. The corrected result is close to the conventional 0.05 threshold; effect sizes and experimental scope matter more than that cutoff.

Large varied-key view lookup remains inconclusive. Small object-value differences do not survive the multiple-comparison correction. Unchanged raw Map controls show no statistically detectable differences.

The Neo frame and selected heavy benchmarks did not exercise managed Map/Set method dispatch in the instrumented ranges. They therefore cannot directly measure the intended caching benefit. Their earlier timing differences remain observations, but provide no demonstrated causal evidence of a Map dispatch regression. Indirect effects from code layout/JIT behavior are not ruled out by counters.

## Paired measurements

Twelve adjacent pairs, fresh processes, six baseline-first and six experiment-first, order shuffled with seed 73101 before execution. One process runs at a time. Each scenario keeps the existing three warmups, nine measured samples, GC outside timing, and checksum assertions. Analysis uses one median per process, not nine independent observations. The same benchmark file is used in both frozen archives.

Effect is the geometric mean experiment/baseline ratio across pairs, expressed as a percentage change in time. Negative means faster. The ns columns are separate medians across processes, so their ratio need not equal the paired estimate. Intervals are nominal 95% percentile bootstrap intervals over the 12 pairs, using 20,000 resamples with seed 431. They are not simultaneous confidence intervals. P-values enumerate all 924 possible balanced orders under the sharp no-effect null; Holm correction covers every one of the 23 measured scenarios, including raw controls. This assumes the adjacent process slots are exchangeable under the randomized assignment and no treatment carryover. Results describe one machine/session and this microbenchmark; they do not account for systematic benchmark bias or establish cross-engine performance.

| Scenario | #100 ns/op | Experiment ns/op | Paired change | Nominal 95% interval | Faster pairs | Holm p |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Map.get primitive via raw | 3.39 | 3.11 | -2.3% | -11.6% to +8.0% | 6/12 | 1.0000 |
| Map.has via raw | 2.95 | 2.57 | -2.1% | -12.9% to +10.2% | 8/12 | 1.0000 |
| Map.get object + field via raw | 3.27 | 2.91 | -1.9% | -11.0% to +8.2% | 5/12 | 1.0000 |
| parent + Map.get via raw | 3.27 | 2.81 | -2.5% | -12.6% to +8.7% | 8/12 | 1.0000 |
| Map.set property lookup via raw | 0.70 | 0.70 | -0.5% | -1.2% to +0.0% | 7/12 | 1.0000 |
| Map.set changed scalar via raw | 6.21 | 6.15 | -0.5% | -2.2% to +1.2% | 6/12 | 1.0000 |
| Map.get primitive via base | 47.28 | 40.56 | -14.4% | -17.2% to -11.4% | 12/12 | 0.0498 |
| Map.has via base | 51.67 | 42.14 | -20.0% | -22.1% to -17.9% | 12/12 | 0.0498 |
| Map.get object + field via base | 108.53 | 105.74 | -3.0% | -4.4% to -1.5% | 10/12 | 0.1126 |
| parent + Map.get via base | 52.59 | 46.22 | -12.2% | -13.8% to -10.6% | 12/12 | 0.0498 |
| prototype helper Map.get via base | 47.07 | 43.57 | -7.5% | -10.0% to -5.0% | 11/12 | 0.0498 |
| Map.set property lookup via base | 35.46 | 34.28 | -3.6% | -5.6% to -1.1% | 11/12 | 0.2338 |
| Map.set changed scalar via base | 212.06 | 168.89 | -21.1% | -23.6% to -18.6% | 12/12 | 0.0498 |
| Map.get primitive via view | 50.83 | 43.99 | -13.6% | -16.1% to -10.7% | 12/12 | 0.0498 |
| Map.has via view | 55.05 | 44.97 | -19.0% | -21.0% to -17.2% | 12/12 | 0.0498 |
| Map.get object + field via view | 111.36 | 109.42 | -1.7% | -3.2% to -0.1% | 10/12 | 0.7143 |
| parent + Map.get via view | 57.49 | 50.22 | -12.2% | -13.7% to -10.5% | 12/12 | 0.0498 |
| prototype helper Map.get via view | 53.76 | 50.56 | -6.7% | -8.7% to -4.5% | 11/12 | 0.0498 |
| Map.set property lookup via view | 37.73 | 37.37 | -1.3% | -3.4% to +1.2% | 8/12 | 1.0000 |
| Map.set changed scalar via view | 209.01 | 151.97 | -27.0% | -28.4% to -25.4% | 12/12 | 0.0498 |
| 50k Map.get varied keys via raw | 29.66 | 30.27 | +1.5% | -1.2% to +4.3% | 4/12 | 1.0000 |
| 50k Map.get varied keys via base | 97.63 | 96.13 | -1.9% | -3.1% to -0.4% | 9/12 | 0.3333 |
| 50k Map.get varied keys via view | 102.65 | 101.70 | +0.7% | -1.4% to +3.4% | 6/12 | 1.0000 |

The changed-scalar write probe repeatedly writes one key, attaches no application subscribers, and does not await a flush between writes. Its gain describes that operation pattern, not complete React updates. Small object-value lookup gains and varied-key lookup gains are not established after correction.

## Neo operation counts

Temporary instrumentation in #100 counts managed Map/Set method-property dispatch and actual managed Map `get`/`set` wrapper calls. The compiler stays enabled. Diagnostic timing is excluded from performance comparisons.

- Frame benchmark: all 72 measured frame changes recorded zero counts. No collection calls were recorded during setup before the positive control either. A managed Map positive control produced exactly one `get`, `set`, and `has` dispatch and one actual `get` and `set` call, proving the counters were connected to the loaded runtime.
- Original ten heavy files: all 30 tests passed and each recorded zero counts in its instrumented test range. Before every test, a managed Map positive control asserted that actual `get` and `set` calls were counted, then reset the counters. These ranges cover test execution and applicable hooks after reset, not module import time.
- Each diagnostic uses one Vitest worker and disables file parallelism. Correction to the prior conversational description: the frame benchmark's tsx launcher spawns Vitest for its single heavy test file; it is not a worker-free standalone benchmark.

The failure to show a Neo benefit is therefore not explained merely by a read-heavy mix missing the faster `set` case. These selected ranges do not use the affected managed collection path at all. Native and ignored Maps retain their ordinary behavior.

## Decision

The evidence supports a localized runtime optimization for repeatedly accessed managed Maps, especially scalar writes and hot scalar reads. It does not establish a compiler improvement, broad lookup improvement, or benefit to the measured Neo workloads. The previously measured roughly 673 retained bytes per Map after caching three methods remains a workload-dependent tradeoff, not an automatic rejection criterion.

A blanket rejection based on noisy Neo medians was unwarranted. A blanket application-speedup claim would also be unwarranted. The useful decision is whether the demonstrated managed-Map gains justify the small implementation and retained cache cost for SDK users. This experiment provides affirmative evidence for that specific benefit, while leaving native/ignored collection workloads unaffected by its intended mechanism.

All temporary Neo source and dependency edits were restored. Runtime source is unchanged. No new build-time matrix was needed because this follow-up changes only measurement evidence. [Commands, analysis, per-process summaries, and diagnostic counters](collection-dispatch-followup-sep-7-2026.json) are preserved separately from the original results.
