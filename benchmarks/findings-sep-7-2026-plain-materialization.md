# Plain-object materialization experiment, September 7, 2026

Historical facade experiment at `fc39578`. Its runtime fixture and optional SDK routing changes were subsequently removed. Reproduce the commands below from that commit. The later ancestry optimization uses a separate report and raw artifact.

This fixed-shape accessor facade fails the cold-materialization target. Keep this PR in draft. It is stacked on #103 at `93ba2bfbc15d7d68389b1493756c72d44f488710`. It does not change the conclusions or measurements in #100, #101, or #103.

## What was tested

Plain records use a benchmark-only facade with shared accessor descriptors for each observed shape. Arrays and exotic objects retain proxies. Reads reuse `readPrimitive` and `readObject`; writes reuse `BaseProxyHandler.set`. Core only broadens its existing optional factory lookup, with no core-to-compiler import or duplicated tracking, ownership, or notification logic.

This tests a representation that a compiler or schema adapter could select. It is not a new Babel transform and does not compile Convex query schemas. Incoming JSON shapes cannot be inferred just by compiling the code that consumes them. Shape discovery and per-instance descriptor installation are included in materialization time. Shape descriptors and JIT state are warmed before the five recorded steady process samples; the two warmup samples are also retained in the raw artifact.

## Measurements

Apple M3 Max, macOS 26.6.2, Node 22.13.1. Six serial blocks, one fresh process per variant per block, five measured graphs per scenario after two warmups. Order alternates baseline/control/facade and facade/control/baseline. No tests, typechecks, or other benchmark workers ran alongside the timing runs. These controls cannot eliminate unrelated OS activity. Every traversal checks its result. Graph construction and forced GC precede timing; listener cleanup follows timing.

Tables show the median of six process medians in milliseconds. The independent replication count is six, not thirty. Cold means previously unmaterialized nodes with warmed code. Root time includes Retree normalization but excludes input construction. Total is measured root time plus first traversal, computed per sample before taking medians. `processMs` in the raw JSON includes bundling, startup, GC and cleanup; it is not a build-time metric.

| Scenario / phase | #103 | Factory routing only | Facade |
| --- | ---: | ---: | ---: |
| existing first-touch scan 100x100 / root | 4.401 | 4.291 | 4.387 |
| existing first-touch scan 100x100 / first traversal | 9.590 | 9.824 | 27.140 |
| existing first-touch scan 100x100 / total | 14.096 | 14.211 | 31.562 |
| existing first-touch scan 100x100 / second traversal | 2.390 | 2.382 | 1.785 |
| full materialization 100x100 / root | 8.238 | 8.274 | 8.268 |
| full materialization 100x100 / first traversal | 16.326 | 16.379 | 41.445 |
| full materialization 100x100 / total | 24.459 | 24.925 | 49.603 |
| full materialization 100x100 / second traversal | 6.555 | 6.627 | 3.710 |
| 5000-deep full traversal / root | 0.578 | 0.582 | 0.614 |
| 5000-deep full traversal / first traversal | 94.292 | 92.272 | 113.358 |
| 5000-deep full traversal / total | 94.933 | 92.842 | 114.030 |
| 5000-deep full traversal / second traversal | 0.320 | 0.310 | 0.694 |
| existing synchronous materialization 10k rows / root | 3.360 | 3.139 | 3.157 |
| existing synchronous materialization 10k rows / first traversal | 4.866 | 4.769 | 17.443 |
| existing synchronous materialization 10k rows / total | 8.339 | 7.953 | 20.841 |
| existing synchronous materialization 10k rows / second traversal | 0.486 | 0.489 | 1.134 |

The first-touch fixture is extracted unchanged from `perf-probe.spec.ts`. Full materialization visits every item and tag in that same 100 by 100 tree. The 5,000-deep fixture traverses 5,001 plain nodes iteratively. The 10,000-row fixture adapts the synchronous traversal from `scripts/benchmark-materialization.mjs`, collecting all `row.detail` nodes with loops instead of its generator driver. It measures the same node exposure, not the original generator or async scheduling overhead.

Full-tree first traversal was 2.39–2.56x slower in all six blocks. The 10,000-row first traversal was 3.32–3.86x slower. Deep-chain first traversal was 1.11–1.27x slower. These large, repeated penalties are sufficient to reject this representation for the stated target; no claim about small differences or Neo-wide statistical significance is made.

Warm full-tree reads improved by roughly 41–49% across blocks, but warm deep-chain and row-collection traversal regressed. Removing a Proxy does not guarantee that accessors win: the facade still resolves managed children and tracks reads, and each materialized object needs its own accessor installation. The experiment does not isolate the cost of each of those operations.

## Retained heap

Six fresh processes per variant, alternating order, after a 1,000-row warmup and two GCs before and after holding 10,000 fully materialized rows plus their detail objects. Median retained heap was 6,974,164 bytes for #103 and 7,636,792 bytes for the facade, a difference of 662,628 bytes, about 0.63 MiB or 66 bytes per row. This is runtime heap, not compressed bundle size. These are simple two-object rows, not measured Neo documents.

## Correctness boundary

`plain-object-parity.mts` verifies fixed-shape scalar and nested writes, child replacement, base identity, view reads, parent lookup, raw purity, `Object.keys`, JSON output, and symbol-key fallback. It also calls the actual query adapter `tryReconcileDocumentsById`: existing-field updates work, but new and removed fields do not reach raw state through the facade. The probe explicitly asserts this limitation rather than passing it off as supported behavior.

Own descriptors become accessors and internal symbols are visible through reflection. Dynamic additions and deletes cannot be trapped by an ordinary object. Thus this is not a compatible replacement for arbitrary Convex result objects even apart from its timing regression. Moving accessors to a shared prototype could lower allocation cost but would lose own-property enumeration; that alternative was not benchmarked or claimed equivalent.

## Decision and scope

Reject this facade for Neo load optimization. Faster warm scalar access does not offset the measured materialization regression for the target workload. This does not prove that compiler-assisted plain-object access is impossible. A different representation or transformed access operations would be a separate experiment.

No Neo load, React, Babel-corpus, or production bundle/build matrix is claimed here. Running the incompatible facade through Neo would not provide a valid application comparison. There is no added compiler transform to measure. Historical stack matrices remain untouched. The only production-path change here is optional handler routing, retained for reproducibility in this draft.

## Reproduce

```sh
npm run benchmark:plain-materialization
RETREE_PLAIN_FACADES=1 npm run benchmark:plain-materialization
node scripts/run-sdk-scaling.mjs benchmarks/plain-object-parity.mts
RETREE_PLAIN_FACADES=1 node scripts/run-sdk-scaling.mjs benchmarks/plain-object-parity.mts
RETREE_PLAIN_FACADES=1 node --expose-gc scripts/run-sdk-scaling.mjs benchmarks/plain-object-heap.mts
```

For the matrix, archive the frozen #103 commit to a temporary directory and provide its dependencies. Copy `plain-materialization.mts`, `plain-object-heap.mts`, `test-fixtures/plain-object-facade.mts`, and the extracted core `test-fixtures/materialization.ts` from this branch into matching paths in that archive. These are benchmark-only additions; keep its SDK source unchanged. Then run `node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON`. The baseline must remain #103; the recorded comparison labels are specific to that commit. Heap runs use the same archive and alternate baseline/facade in six serial blocks.

Raw timing and heap samples: [plain-materialization-sep-7-2026.json](./plain-materialization-sep-7-2026.json).

## Validation

All 1,686 SDK tests passed with one worker. Full repository typecheck, benchmark typecheck, doctor, and architecture checks passed. Baseline and enabled parity probes passed their documented assertions, including the explicit query shape-change failure. The facade is confined to benchmark imports and the extracted fixture is excluded from SDK compilation.
