# Compiler remeasurement, September 7, 2026

Measured Retree code at `cd701fd3343ce007aebc694586c7d04b38439146`, after removing compiled memo specialization and sharing runtime writes and deletes. Neo is the original benchmark worktree at `0429c81746ad4f71940f591e0da5052539864b13`. Its core and compiler package files were verified byte-for-byte against this Retree build. The worktree and original dependencies were restored afterward.

Apple M3 Max, Node 22.13.1. All benchmark processes ran serially. Three rounds alternate off/on, on/off, off/on. No rounds were excluded. This is a normal desktop session, not an isolated performance machine. Percentages describe these samples, not statistical confidence or universal application gains.

[Raw results, corpus manifest, configuration, and executed procedures](compiler-remeasurement-sep-7-2026.jsonl) preserve every scenario and round. Historical figures below are the results previously reported for the pre-fix PR at `a3f306a`; they were not rerun in this session. They are kept separately because they include the removed memo implementation and duplicated write path.

## Scalar reads and array controls

`RETREE_COMPILER=0/1 npm run benchmark:node-reads`, three runs per mode. Each scenario has nine measured samples after warmup; scalar scenarios perform 1.8 million reads per sample. Each number below is the median of the three run medians.

| Scenario | Off, ms | On, ms | Change |
| --- | ---: | ---: | ---: |
| ReactiveNode scalar reads via empty Proxy | 17.891 | 17.749 | -0.8% |
| ReactiveNode scalar reads via base | 69.088 | 18.406 | -73.4% |
| ReactiveNode scalar reads via view | 66.004 | 17.150 | -74.0% |
| plain scalar reads via base | 57.697 | 54.530 | -5.5% |
| plain scalar reads via view | 56.169 | 52.698 | -6.2% |
| 50k row scan via base | 12.946 | 12.927 | -0.1% |
| 50k row scan via view | 13.296 | 13.787 | +3.7% |
| 50k row map(row => row.id) via base | 2.579 | 2.773 | +7.5% |
| 50k row map(row => row.id) via view | 2.558 | 3.031 | +18.5% |

The base and view scalar reads remain about 3.8 times faster and reach the empty-Proxy floor. Raw class reads are excluded from this comparison because Babel lowering changes the optimization opportunities for the benchmark itself.

Plain rows remain proxied. The separate `benchmark:array-reads` control contains no compiled ReactiveNode class. Its managed-array scenarios varied from -17.5% to +10.8% across the two build modes. All raw and managed rows are in the JSONL. Small differences in these controls should not be presented as compiler wins.

## Neo frame changes

The original `scripts/benchmark-world-animation-frame-change.mts` ran against Neowyn's `CharacterBody`, `Walk` clip, with 24 measurements in each pass. The fixture still has 4,891 values, 769 members, 175 classes, and 2,235 constructed preview rows. Each pass made 72 React commits. Each cell lists the three run medians in milliseconds.

| Pass | Off, rounds 1 / 2 / 3 | On, rounds 1 / 2 / 3 | Median change |
| --- | ---: | ---: | ---: |
| cold (first visit) | 14.00 / 13.40 / 13.50 | 14.10 / 14.00 / 13.50 | +3.7% |
| warm (revisit, reverse) | 9.40 / 8.60 / 8.90 | 10.00 / 8.50 / 10.10 | +12.4% |
| steady (revisit, forward) | 8.70 / 8.60 / 8.70 | 8.10 / 8.10 / 8.60 | -6.9% |

This does not establish an overall frame-rendering speedup. Cold and warm pass medians were higher with compilation; steady revisits were lower. The full React work remains much larger than a scalar read.

## Neo heavy workloads

The same ten P75 heavy test files ran with `--project heavy --no-file-parallelism --disableConsoleIntercept`. All 30 tests passed in all six runs. Each cell lists all three rounds in milliseconds. Draft flush values are the test's mean of ten flushes; the other values are individual scenario measurements per test run.

| Scenario | Off, rounds 1 / 2 / 3 | On, rounds 1 / 2 / 3 | Median change |
| --- | ---: | ---: | ---: |
| 400 roots, ten debounced draft flushes | 1.44 / 1.30 / 1.29 | 0.87 / 0.83 / 0.83 | -36.2% |
| Draft entry over 400 collapsed roots | 1.90 / 1.60 / 1.70 | 1.20 / 1.30 / 1.40 | -23.5% |
| Sparse paint, 50k placements and 50k unrelated | 0.78 / 0.75 / 0.73 | 0.88 / 0.92 / 0.87 | +17.3% |
| 10k exact variant subscribers, mount | 38.70 / 42.40 / 41.30 | 40.60 / 39.00 / 39.10 | -5.3% |
| 400 collapsed roots, cold | 174.00 / 175.30 / 184.40 | 185.70 / 184.30 / 180.30 | +5.1% |
| Objects catalog, cold | 19.80 / 20.10 / 20.30 | 20.20 / 20.00 / 20.30 | +0.5% |
| 120 membership overlays, 50k rows, full lane | 10.70 / 10.40 / 9.40 | 8.10 / 7.60 / 7.60 | -26.9% |

Draft flushes and draft entry still benefit. The previous sparse-paint speedup is not reproduced: the compiled median is 17.3% slower in this run. Cold root setup is 5.1% slower. These are current measured tradeoffs, not a blanket claim that compilation speeds up writes or construction.

The Objects catalog fixture contains 4,543 classes, 500 assets, 8,500 members, and 9,000 relations. Its full-lane cold measurement is essentially unchanged.

The separate catalog/overlay control was also repeated three times per mode, matching the original follow-up. All four tests in that file passed in every run.

| Control | Off, rounds 1 / 2 / 3 | On, rounds 1 / 2 / 3 | Median change |
| --- | ---: | ---: | ---: |
| 120 membership overlays, isolated file | 8.40 / 8.70 / 8.20 | 10.20 / 8.70 / 10.30 | +21.4% |

The isolated overlay result reverses the apparent full-lane improvement. This workload uses plain Maps, so the full-lane number is not evidence that the compiler accelerates Map operations. Process/JIT/test order effects remain material at this scale.

## Babel compile time and generated size

The original 1,338-file source list and 13 configured cross-file bases were reused. Exactly 130 classes compiled, with zero transform failures. Both lanes use `next/babel`, Node-current targets, TypeScript `allowDeclareFields`, standard decorators version `2023-11`, no source maps, and noncompact output. One whole pass per mode warms Babel before three alternating timed rounds.

| Metric | Off | On |
| --- | ---: | ---: |
| Whole pass, round 1 | 10.175 s | 10.852 s |
| Whole pass, round 2 | 10.079 s | 10.472 s |
| Whole pass, round 3 | 10.031 s | 10.775 s |
| Median whole pass | 10.079 s | 10.775 s |
| Generated JavaScript, UTF-8 bytes | 11,473,153 | 12,783,375 |
| Generated JavaScript, string characters | 11,466,184 | 12,776,406 |

The median compile cost is +0.696 s, or 6.9%. Extra output is 1,310,222 bytes, about 10,079 bytes per compiled class. These are unminified Babel outputs, not shipped bundle sizes.

A separate fresh-process CPU profile of one compiled corpus pass sampled 115 ms inclusively under the compiler package, of 15.022 s total sampled process time. This includes parsing performed beneath the compiler's visitor. It excludes later Babel work that walks and prints emitted nodes. It is not a decomposition of the warm median timing above.

The original 258 ms profile covered two compiled passes, including warmup, and two proxy passes. The old description's roughly 0.26-second figure therefore should not be compared directly to this single-pass 115 ms result. The old and new unprofiled whole-pass timings remain separately reported.

## Clean production builds

Both samples built successfully in all six runs. Vite `dist` and its local optimization cache were removed before each build; Next `.next` was removed. Both modes keep the same decorators and bundler configuration. The off lane explicitly removes the compiler plugin and verifies that difference. Next uses `NEXT_PUBLIC_CONVEX_URL=https://test.convex.cloud`, so this is not live-backend validation.

| Sample | Off, ms, rounds 1 / 2 / 3 | On, ms, rounds 1 / 2 / 3 | Median change |
| --- | ---: | ---: | ---: |
| vite | 697.02 / 581.72 / 575.17 | 611.26 / 611.17 / 608.05 | +5.1% |
| next | 4857.82 / 4548.09 / 4614.57 | 4387.07 / 4525.89 / 4608.92 | -1.9% |

These samples compile three classes each. Vite's median is about 29 ms higher with the compiler; Next's is about 89 ms lower. The run spread does not support an application build-speed claim.

## Browser hot reload

Vite 8.0.10 and Next.js 16.2.6 Turbopack were checked in actual browser sessions with the compiler both off and on.

- Vite: edit `Card.iterate` from incrementing by 1 to incrementing by 10. HMR updates the two importing components and recreates the sample roots. The next click changes the displayed counter from 1 to 11 in both modes. No Vite error overlay.
- Next: edit the memo-backed submit condition from one required character to four, and change the tasks selector to return a managed marker row. Fast Refresh rebuilds successfully. The existing input remains `x`, submit remains enabled, and the marker is absent in both modes. After reload, `x` disables submit, `xxxx` enables it, and the marker appears. No runtime-error dialog on either successful check.

`useRoot` retains the stable base instance. `useNode` subscribes to it and returns its current view. These are different operations. The sample uses both; preserving the old root through Fast Refresh also preserves its original class implementation. A view refresh does not recreate the root from the edited class. Reload does. This limitation is shared by the proxy and compiled lanes.

The Next probe used an offline placeholder backend. Expected WebSocket DNS errors are not compiler failures. An initial temporary fixture incorrectly returned unmanaged rows to a component calling `useNode`; it was corrected to return managed rows, and both checks were repeated. All temporary source edits and configuration changes were restored.

## Cost without the compiler

The same code revision was already measured in [the compiler-boundary report](findings-sep-7-2026-compiler-boundary.md). Those current-revision results are retained rather than rerun after documentation-only changes.

| Variant | Minified core bytes | Gzip bytes | Median retained bytes, 100k rows |
| --- | ---: | ---: | ---: |
| Precompiler main, a889d81 | 112,447 | 30,419 | 65,210,968 |
| Current, compiler off | 113,492 | 30,742 | 65,216,256 |
| Current, optional runtime loaded | 123,797 | 33,549 | 65,216,312 |

Five fresh processes per variant, alternating order, materialize 100,000 rows and a nested object per row. Retained heap excludes module loading and warmup. The optional-runtime variant does not include generated application classes. Compiler-off overhead is 323 gzip bytes and about 5.3 KB of retained workload allocation. Core's compiler-off bundle excludes the compiled runtime.

## Historical measurements retained from the original PR

These numbers predate the fixes and were reported before this rerun. They are historical evidence, not current-head validation. The original frame and heavy tables below preserve their reported round values; the earlier frame report excluded an interference round. This rerun excluded none.

| Original scalar scenario | Proxy | Compiled |
| --- | ---: | ---: |
| Base, 1.8M reads | 68.8 ms, 38.2 ns/read | 18.3 ms, 10.2 ns/read |
| View, 1.8M reads | 68.9 ms, 38.3 ns/read | 17.1 ms, 9.5 ns/read |
| Empty Proxy | 17.8 ms | 17.9 ms |

| Original Neo scenario | Proxy, ms | Compiled, ms |
| --- | ---: | ---: |
| Cold frame | 13.4 / 13.4 | 15.3 / 13.5 |
| Warm frame | 8.9 / 9.0 | 9.4 / 9.5 |
| Steady frame | 9.2 / 9.0 | 10.2 / 8.6 |
| Draft flush mean | 1.34 / 1.25 | 0.81 / 0.78 |
| Draft entry, 400 roots | 1.6 / 1.5 | 1.3 / 1.2 |
| Sparse paint | 1.03 / 0.89 | 0.67 / 0.73 |
| 10k subscriber mount | 41.8 / 41.5 | 40.4 / 40.0 |
| 400 roots, cold | 181 / 183 | 183 / 186 |
| Objects catalog, cold | 20.6 / 20.2 | 20.4 / 20.2 |
| Isolated overlays | 8.3 / 9.5 / 8.9 | 8.4 / 9.8 / 9.0 |

| Original compile/build evidence | Proxy | Compiled |
| --- | ---: | ---: |
| Babel median, 1,338 files | 10.04 s | 11.04 s, +9.9% |
| Unminified output, reported approximate size | 11.47 MB | 12.99 MB, +1.53 MB |
| Vite build, three rounds | 654 / 629 / 691 ms | 654 / 1194 / 661 ms |
| Next build, three rounds | 4.53 / 5.45 / 4.52 s | 4.44 / 6.73 / 4.74 s |

The old output-size probe used JavaScript string lengths; the current table explicitly distinguishes UTF-8 bytes. The old profile reported about 0.26 s under the compiler visitor; its multi-pass scope is explained above. Original Vite HMR picked up the changed method; original Next selector editing rebuilt in 76 ms and required reload to replace retained model instances. Both behaviors were checked again here.

## Reproduction

The JSONL artifact includes the exact corpus file list, base-class configuration, executed orchestration scripts, Babel timing script, and every microbenchmark row. Replace its `<RETREE_ROOT>` and `<NEO_ROOT>` placeholders with the corresponding checkouts. Neo's original Vitest configuration adds the Retree compiler before decorators only when `RETREE_COMPILER=1`. Use current packed core/compiler packages for both Neo lanes; do not compare different SDK versions as an off/on test.

Run the node/array scripts from Retree. Run the frame driver and heavy-file list from Neo. Keep performance processes serial and alternate lane order. The frame command is:

```sh
RETREE_COMPILER=1 npx tsx scripts/benchmark-world-animation-frame-change.mts \
  --workspace /path/to/neowyn/neo --iterations 24
```

Repeat with `RETREE_COMPILER=0`. The heavy command and its ten exact test paths are recorded in `runs` in the JSONL. The isolated control is `src/components/projects/world-grid-builder/world-grid-model.p75-cold-asset-catalog.heavy.test.ts` using the same heavy-lane options.

These remeasurements validate the real frame fixture and the selected heavy suite, not a fresh run of Neo's entire unit suite. Retree's complete suite passed: 1,680 tests across 122 files. `npm run doctor` also passed.
