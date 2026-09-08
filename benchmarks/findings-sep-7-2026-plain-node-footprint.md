# Plain node footprint, September 7, 2026

The private-field registry (#105, `experiment/private-field-node-registry` at `412c83c`) removed the hidden materialization cost. What remained was spread across the per-node path itself: the allocations each managed node retains and the checks a fresh node's field walk repeats. This report measures five small changes on top of #105 for shallow and deep plain-object trees, eager preparation, a churning live tree, and real Neowyn data, with the compiler off and on.

## What changed

Each change was screened alone with four interleaved blocks before it stayed; two other probes were dropped on measurement (below).

1. **Parent edge as two handler fields.** Every handler held an `IProxyParent` record (`{ handler, propName }`) allocated per node and shared with its reproxy. The two values now live on the handler as `parentHandler` and `parentProp`; the reproxy forwards both. One retained allocation and one type gone, and the "reproxy shares the record, mutate it in place" comments with it. Retained heap per node drops 32 bytes.
2. **Plain children are never looked up during the field walk.** When a fresh object or array materializes, its walk checked each object-valued field for a stored proxy, frozen state, lazy shape, and then whether the raw was already managed elsewhere. That last registry lookup is a private-field brand-check miss on nearly every plain child, twice the cost of the old WeakMap miss. The walk now stops at the lazy-shape check for raw plain objects and arrays. A plain raw that is already managed elsewhere attaches on its first read through the same path, with the same structural-cycle check. Class instances and collections still attach eagerly.
3. **Fresh arrays are walked by index.** `Object.keys` on an array builds an index string per element; the walk now loops `0..length` and only stringifies the index for the rare element that attaches eagerly (a stored proxy or a class instance).
4. **Digit-led keys skip the array method tables.** Both get traps checked `isArrayMutatingMethod` and `isNativeArrayReadAccess` (two `hasOwnProperty` calls) before serving an element. A key whose first character is a digit cannot be a method name, so element reads skip both.
5. **The children-cache prototype is no longer frozen.** Every materialized node's children cache is `Object.create(childrenCachePrototype)`. Freezing that prototype made V8 take the slow path for index-keyed stores on any object beneath it: 34 ns per store against 7.6 ns unfrozen, measured over 100-element caches. Array children are cached by index, so every array child paid it. The prototype is internal and still has no members, which is all the phantom-key guard needs.

Dropped on measurement: resolving iterated array elements by numeric index instead of `String(index)` (rows 3% slower, Neowyn and churn flat), and a prototype short-circuit in `getNodeKind` ahead of the `instanceof` chain (forest 4% slower, rows and Neowyn flat).

## Repeated materialization results

Apple M3 Max, macOS 26.6.2, Node 22.13.1. Eight serial blocks, one process per variant per block, five measured fresh graphs after two warmups, order reversed each block. Benchmark processes ran without concurrent tests, typechecks, or other benchmark workers. Every sample validates traversal output. No samples were filtered out. Tables show medians of the eight process medians.

All times are milliseconds; lower is better. `Before` is #105 at `412c83c`, `After` is this branch. `Faster by` is the paired effect over the eight blocks with its 95% bootstrap interval (method below); a negative number means slower. The compiler flag only changes how `ReactiveNode` classes are handled, so for these plain-data scenarios both variants run identical code with it off and on. The compiler-off run is the main table; the compiler-on run is a second full replicate, and where the two disagree the disagreement is the noise floor between two runs of the same code, up to 10% on the first-touch scan and about 5% on the forests.

| Root plus first traversal, compiler off | Before | After | Faster by |
| --- | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 8.457 | 7.166 | 14.1% [11.7%, 16.1%] |
| full materialization 100x100 | 16.702 | 15.060 | 10.5% [8.5%, 12.4%] |
| 5000-deep full traversal | 1.248 | 1.191 | 5.4% [3.8%, 7.1%] |
| existing synchronous materialization 10k rows | 4.581 | 3.875 | 16.0% [14.7%, 17.6%] |
| plain forest depth 16, 16371 nodes | 4.463 | 4.177 | 6.9% [5.5%, 8.2%] |
| plain forest depth 64, 16380 nodes | 4.293 | 4.071 | 5.1% [2.9%, 7.4%] |
| plain forest depth 256, 16191 nodes | 4.211 | 3.991 | 6.1% [3.6%, 8.6%] |
| plain forest depth 1024, 15375 nodes | 3.975 | 3.785 | 5.2% [3.1%, 7.2%] |
| explicit prepareTree, 16191 plain nodes | 22.467 | 23.108 | -4.6% [-9.1%, -0.8%] |
| churn: 30 rounds of 1k fresh rows into a 40k-node live tree | 32.247 | 28.548 | 12.5% [9.4%, 15.5%] |
| Neowyn fixture exhaustive plain traversal | 59.924 | 58.852 | 1.9% [-0.2%, 3.7%] |

| Root plus first traversal, compiler on (replicate) | Before | After | Faster by |
| --- | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 9.356 | 7.310 | 22.1% [19.7%, 24.4%] |
| full materialization 100x100 | 17.374 | 15.187 | 11.9% [10.2%, 13.5%] |
| 5000-deep full traversal | 1.289 | 1.196 | 8.3% [5.9%, 11.1%] |
| existing synchronous materialization 10k rows | 4.717 | 3.834 | 19.2% [18.0%, 20.4%] |
| plain forest depth 16, 16371 nodes | 4.705 | 4.206 | 11.2% [9.7%, 12.7%] |
| plain forest depth 64, 16380 nodes | 4.599 | 4.068 | 11.5% [10.0%, 12.9%] |
| plain forest depth 256, 16191 nodes | 4.616 | 3.941 | 14.5% [12.6%, 16.7%] |
| plain forest depth 1024, 15375 nodes | 4.311 | 3.726 | 13.7% [11.9%, 15.6%] |
| explicit prepareTree, 16191 plain nodes | 23.576 | 23.081 | 4.8% [-1.8%, 11.2%] |
| churn: 30 rounds of 1k fresh rows into a 40k-node live tree | 32.858 | 27.653 | 15.9% [13.5%, 18.8%] |
| Neowyn fixture exhaustive plain traversal | 60.468 | 57.197 | 4.3% [1.5%, 7.0%] |

The `root` phase is `Retree.root` alone and is under 0.03 ms everywhere except churn, where it is the live tree build and first read: 12.135 to 10.771 ms, 13.0% [11.1%, 14.7%] faster (compiler on: 12.516 to 10.738, 14.3% [12.4%, 16.5%]). The first-traversal-only numbers are the same picture and are in the JSON.

| Warm re-read, compiler off | Before | After | Faster by |
| --- | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 2.429 | 2.472 | -0.3% [-2.7%, 2.5%] |
| full materialization 100x100 | 4.662 | 4.773 | -1.9% [-4.6%, 0.7%] |
| 5000-deep full traversal | 0.338 | 0.340 | -1.1% [-3.8%, 1.6%] |
| existing synchronous materialization 10k rows | 0.540 | 0.511 | 6.0% [1.0%, 10.5%] |
| plain forest depth 16, 16371 nodes | 1.141 | 1.141 | -0.1% [-3.8%, 3.3%] |
| plain forest depth 64, 16380 nodes | 1.108 | 1.117 | -1.1% [-3.5%, 1.1%] |
| plain forest depth 256, 16191 nodes | 1.093 | 1.137 | -5.2% [-8.3%, -1.9%] |
| plain forest depth 1024, 15375 nodes | 1.032 | 1.038 | -0.5% [-1.3%, 0.4%] |
| explicit prepareTree, 16191 plain nodes | 17.475 | 18.185 | -5.8% [-10.6%, -1.9%] |
| churn: warm re-read of all 20,000 rows | 1.581 | 1.675 | -4.7% [-10.0%, 1.0%] |
| Neowyn fixture exhaustive plain traversal | 45.720 | 46.903 | -1.2% [-3.8%, 1.1%] |

With the compiler on, the warm re-reads are 10k rows 4.5% [1.0%, 7.6%] faster, Neowyn 3.7% [1.3%, 6.5%] faster, and every other interval covers zero. Nothing in the change touches the warm path except the digit-led key check, which the iterator-based warm reads do not hit, so the warm rows in both directions are read as noise.

## Churn

Same scenario as the registry report: a 40,400-node tree stays mounted, then 30 rounds each replace the rows of 10 sections with 1,000 fresh raw rows and read them. Garbage is collected on the engine's schedule.

| Churn, compiler off | Before | After | Faster by |
| --- | ---: | ---: | ---: |
| live tree build and first read, ms | 12.135 | 10.771 | 13.0% [11.1%, 14.7%] |
| 30 rounds total, ms | 20.012 | 17.754 | 11.6% [7.9%, 14.8%] |
| worst single round, ms | 2.403 | 2.317 | 5.3% [-0.9%, 10.2%] |
| warm re-read of all 20,000 rows, ms | 1.581 | 1.675 | -4.7% [-10.0%, 1.0%] |

Compiler on: build and first read 12.516 to 10.738 ms (14.3% [12.4%, 16.5%]), 30 rounds 20.441 to 17.182 ms (16.3% [13.4%, 19.7%]), worst round 2.624 to 2.317 ms (13.4% [6.6%, 20.7%]), warm re-read 1.608 to 1.597 ms (2.8% [-0.8%, 7.9%]).

## Effects and uncertainty

`Faster by` uses the geometric mean of paired process-median ratios within each block. Intervals are nominal 95% percentile bootstrap intervals from 20,000 resamples of the eight blocks, seed 10407. The five samples within a process are not treated as independent runs. These intervals do not correct for multiple comparisons and do not establish cross-machine or Neo-wide gains.

Explicit `prepareTree` is the one scenario that moved against the change in one configuration and for it in the other, on identical code paths. Its walk reads each field through the proxy but also records every object in a `WeakSet`, which is most of its 22 ms for 16k nodes (a plain traversal of the same forest is 4 ms), so the per-node change is a small fraction of it and both intervals sit inside the noise the identical-code pairs show. It is reported as no measurable change.

The screening runs that chose each change (four blocks each, first traversal, against the #105 head): deferred plain adoption alone, forest 16 10.0% less, rows 3.2%; with digit-led keys, rows 5.3%; with the index walk, churn 9.1%, first-touch 9.2%; with the parent-field merge, forest 16 17.8%, churn 9.2%, worst round 2.39 to 2.15 ms; with the unfrozen prototype, rows 15.6%, churn 14.2%. Those single-run numbers are higher than the eight-block matrix for the forests; the matrix is the number to quote.

## Real Neowyn data

Same fixture probe as the registry report: `neo-compose/scripts/fixtures/neowyn-character-body-runtime-state.json.gz`, cloned outside timing, rooted, every enumerable property read iteratively. First traversal moved from 59.9 to 58.9 ms with the compiler off, 1.9% [-0.2%, 3.7%], and from 60.5 to 57.2 ms with it on, 4.3% [1.5%, 7.0%]. The warm exhaustive re-read is 3.7% [1.3%, 6.5%] faster with the compiler on and unchanged with it off. This fixture is one wide tree of small arrays read once; the churn scenario remains the closer model of a mounted Neo document receiving updates.

## Memory, bundle, and build check

Retained heap after materializing 15,408 plain nodes (the depth-16 forest) in a fresh process, measured three times each after two forced collections: 303.7 bytes per node on #105 and 271.5 bytes on this branch. The 32-byte difference is the 40-byte parent record minus the one extra handler field.

A minified browser ESM consumer of `Retree.root({ rows: [] })`, target ES2022, went from 99,404 to 99,347 bytes; gzip from 27,930 to 27,908; Brotli from 24,575 to 24,540. Eight serial reversed-order esbuild pairs after warmup measured medians of 9.26 ms for #105 and 7.79 ms for this branch; a small local bundle probe, not evidence of faster application builds.

## Reproduce

Check out the #105 commit into a temporary baseline directory with dependencies. The benchmark file is unchanged from #105.

```sh
node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON
RETREE_PLAIN_FIXTURE=/path/to/neowyn-character-body-runtime-state.json.gz node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON
RETREE_MATERIALIZATION_SCENARIO=churn npm run benchmark:plain-materialization
```

Raw observations for all four variants, every warmup and sample, and every phase: [plain-node-footprint-sep-7-2026.json](./plain-node-footprint-sep-7-2026.json). The `worstRoundMs` field is present on churn samples only.

## Validation

All 1,690 SDK tests passed. Full typecheck, benchmark typecheck, doctor, and architecture checks passed. Two structural-cycle tests moved to the new attach point: a plain self-reference is rejected on the first read of the closing edge instead of at `Retree.root`, and a deeper plain cycle on the first read of the closing edge instead of its holder. The `snapshot-version` spy test reads `parentHandler` instead of the removed record.
