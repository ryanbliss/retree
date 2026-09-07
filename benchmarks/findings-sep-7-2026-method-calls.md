# Compiled direct method calls experiment

Stacked on #101 at `6949e34`. This is a benchmark-only compiler prototype, not a supported compiler option. Normal compiler output is unchanged. The SDK change extracts base/view receiver selection into a helper used by existing method binding and by the experiment. It adds no handler fields, bound-function caches, or second mutation implementation.

## Result and limits

The inline prototype lowers time for the selected managed-call microbenchmarks by approximately 14–47% relative to #101. Unlike the prior collection experiment, it demonstrably executes in the Neo frame workload. However, it converts only about 211 calls per frame, so nanosecond-scale per-call savings imply microseconds of benefit in that particular workload, not a demonstrated millisecond-scale frame improvement.

The prototype-disabled control still regresses the immediate view getter by roughly 2 ns, about 8%. This is a measured cost of the shared-runtime refactor and is not hidden in the inline comparison. The raw getter also changes from about 0.71 to 0.85 ns with the inline guard. These results are reasons to keep this experimental.

The inline probe bypasses managed prototype descriptors and does not preserve arbitrary reflective replacement of those descriptors or all dynamically invalid method shapes. Ordinary method overrides, raw instances, base/view receivers, argument evaluation order, async suspension, spread, lexical this, and extracted methods are covered by the parity probe. Production guards could consume some of the measured savings. No general-purpose compiler rewrite is enabled by this PR.

## Mechanism

The existing compiler emits a getter for each method. Even an immediate `this.read()` goes through that getter and a bound-function cache. The prototype rewrites immediate `this.method()` calls to plain, nondecorated methods declared in the same eligible class. It excludes raw-receiver special methods using the existing runtime classification. It skips constructors, static methods, computed calls, and dynamic-this nested functions.

Conceptually, the inline form is:

```ts
this[H]
    ? applyMethod(this[R].read, resolveFunctionReceiver(this[H], this[V]), [])
    : this.read();
```

Function lookup and receiver selection occur before argument evaluation. `applyMethod` is the captured `Reflect.apply`; the shared receiver helper selects the stable base or current view. This does not eliminate field tracking or value resolution inside the method body. Extracted callbacks retain the existing binding behavior.

The first prototype passed a prepared `{ fn, receiver }` object between helpers. Its smoke measurements were slower than #101, so it is retained only as an explicit `prepared` benchmark alternative. The inline form avoids that object and allows the engine to optimize the fixed argument array. Transient allocation/GC effects were not independently profiled.

## Runtime comparison

Twelve sequential blocks contain #101, the shared-runtime refactor with the prototype off, and the inline prototype. All six orders occur twice, shuffled before execution with seed 8102. Each process uses five warmup batches and nine measured batches of 200,000 operations, with checksums and GC outside timing. One process runs at a time.

Cells show medians of process medians in ns per outer operation. Paired effects use the geometric mean ratio within blocks. The 95% intervals are nominal percentile bootstrap intervals over the twelve blocks, with 20,000 resamples and seed 90102. They are not simultaneous intervals or cross-machine guarantees. The nine samples inside a process are not counted as independent runs. All twelve scenarios and both control comparisons are in the raw artifact.

| Scenario | #101 | Refactor, prototype off | Inline | Inline paired change | Nominal 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: |
| immediate getter:raw | 0.71 | 0.71 | 0.85 | +20.5% | +17.0% to +23.5% |
| argument:raw | 4.39 | 4.38 | 4.36 | -0.9% | -1.8% to -0.2% |
| two internal calls:raw | 4.35 | 4.36 | 4.33 | +0.2% | -0.5% to +0.8% |
| extracted control:raw | 4.22 | 4.22 | 4.20 | -0.6% | -1.9% to +0.3% |
| immediate getter:base | 18.66 | 18.81 | 13.26 | -30.2% | -31.9% to -28.5% |
| argument:base | 30.69 | 32.32 | 18.45 | -39.4% | -41.3% to -37.3% |
| two internal calls:base | 49.28 | 47.71 | 26.67 | -47.2% | -49.4% to -44.8% |
| extracted control:base | 5.20 | 5.19 | 5.20 | +0.7% | -0.3% to +1.9% |
| immediate getter:view | 21.94 | 23.80 | 19.00 | -14.2% | -16.9% to -11.6% |
| argument:view | 34.85 | 34.34 | 22.71 | -34.8% | -36.6% to -33.0% |
| two internal calls:view | 55.75 | 57.85 | 33.57 | -41.0% | -43.1% to -38.9% |
| extracted control:view | 5.25 | 5.20 | 5.20 | -0.8% | -1.5% to -0.0% |

The immediate-getter scenario contains one internal call; the argument scenario calls a method that makes one internal call; the two-call scenario contains two internal calls. Thus the last two still include an outer, ordinarily bound method access. These are small methods with stable inputs, not general application speedup estimates.

## Neo exposure and correctness

Instrumentation in #101 counted 43,275 compiled bound-method reads across the 72 frame changes. The prototype separately counted 15,223 direct calls across the same 72-frame workload. These are separate diagnostic runs, not a subtraction of identical execution traces. Leading converted methods were:

| Method | Direct calls |
| --- | ---: |
| ProjectDraftModeVM.stagesAnything | 8,718 |
| AnimationFrameValueBacking.read | 4,464 |
| WorldGridAnimationVM.selectedAssetForCells | 578 |
| WorldGridVariantVM.lookupFolderKey | 576 |
| ProjectDatabaseVM.baseRecordById | 146 |
| ProjectDatabaseVM.rowIndex | 146 |
| ProjectDatabaseVM.rowIndexKey | 146 |
| WorldGridAnimationVM.constructorPreviewVMForAsset | 72 |

The real frame test and the original ten heavy files passed with the prototype enabled, including all 30 heavy tests. These diagnostics use one Vitest worker with file parallelism disabled. Diagnostic frame timings are excluded from speed claims. Heavy-suite timing from one run is correctness evidence only. The selected prototype call sites account for about 211 calls per frame; applying a hypothetical 10 ns saving to each would yield about 0.0021 ms per frame. This is a scale illustration, not an app timing result.

## Retained heap

Five fresh GC-enabled processes per lane, alternating order, retain 10,000 individually rooted compiled nodes after reading an immediate getter. Module loading and a 1,000-node warmup are excluded. Each getter internally calls one method. These are runtime bytes after GC, not bundle bytes.

| Variant | Retained bytes, median | All five samples |
| --- | ---: | --- |
| base | 12,362,816 | 12366184 / 12362816 / 12357376 / 12358400 / 12366192 |
| refactor | 12,368,144 | 12368144 / 12360112 / 12368160 / 12368184 / 12359360 |
| inline | 8,985,072 | 8987368 / 8980920 / 8985072 / 8985216 / 8983136 |

The inline workload retains 3,377,744 fewer bytes than #101, approximately 338 bytes per node. The nodes do not retain a binding for this internal call. This is specific to the getter-only workload; methods already extracted elsewhere may already have bindings.

## Compiler time and emitted size

The same 1,338 Neo files and 13 cross-file bases as #101. Four adjacent pairs in AB/BA/BA/AB order, each process running one full warmup before its measured pass. Both lanes use the #101 compiler; inline additionally runs the benchmark plugin. This measures a separate-plugin prototype, not an integrated production compiler implementation.

| Variant | Babel median, ms | All four passes, ms | Emitted UTF-8 bytes | Rewritten calls |
| --- | ---: | --- | ---: | ---: |
| off | 10966.59 | 10776.96 / 10937.61 / 11176.37 / 10995.57 | 12,783,375 | 0 |
| inline | 11221.06 | 11256.99 / 11185.13 / 11310.26 / 11013.04 | 13,115,030 | 1,975 |

The medians differ by about 2.3% in transform time; emitted source grows about 2.6%. Emitted source size covers the entire corpus and is not a minified/gzipped browser bundle. Both lanes compile 130 classes.

## Clean sample builds

Three complete clean builds per lane for both samples, serially, in AB/BA/AB order. Both use the compiler. Baseline installs #101's compiled core; inline installs the experimental core and prepends the benchmark plugin. Next uses the same offline placeholder Convex URL as #101. Each cell contains all three wall-clock milliseconds. These small samples are build compatibility controls and do not establish representative application runtime exposure.

| Sample | #101 | Inline |
| --- | --- | --- |
| vite | 631.04 / 641.30 / 625.59 | 623.56 / 651.27 / 634.79 |
| next | 4537.90 / 4510.89 / 4535.46 | 4575.61 / 4592.44 / 4489.09 |

Three preliminary build-harness attempts were discarded: one left the experimental helper in the baseline Next typecheck, one assumed the wrong Vite plugin configuration shape, and one supplied the TypeScript helper directly to the Vite Babel adapter. The helper is now lowered to ordinary ESM before sample builds. The harness issues were corrected; the reported matrix contains all twelve successful builds. No timing outliers were removed. This stage does not repeat the full #101 browser/HMR, scalar/list, plain-object heap, or precompiler matrix. It is a narrow compiler prototype with known semantic and default-path limitations, not a shipping validation matrix.

## Reproduce and validation

```sh
npm run build:packages
npm run benchmark:method-calls
RETREE_DIRECT_CALLS=inline npm run benchmark:method-calls
RETREE_COMPILER=1 RETREE_DIRECT_CALLS=inline node scripts/run-sdk-scaling.mjs benchmarks/method-call-parity.mts
RETREE_COMPILER=1 RETREE_DIRECT_CALLS=inline node --expose-gc scripts/run-sdk-scaling.mjs benchmarks/method-call-heap.mts
```

`RETREE_DIRECT_CALLS=prepared` selects the earlier helper-object probe. The environment switch belongs only to the benchmark runner; the published compiler has no such option. The recorded matrix uses frozen source copies to distinguish #101 from the runtime refactor.

All 1,686 SDK tests, typecheck including the new benchmark files, doctor, architecture lint, and the standalone parity probes passed. The final core build and both sample builds passed. Temporary Neo dependencies, sample package bins, source/configuration edits, and Next build output were restored. No deployment or live backend was used.

[Raw samples, counters, scripts, and source snapshots](method-calls-experiment-sep-7-2026.json) preserve the final matrix separately from the exploratory smoke runs.
