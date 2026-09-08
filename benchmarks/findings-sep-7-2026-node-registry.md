# Private-field node registry, September 7, 2026

Every managed node used to be recorded in one module-level `WeakMap` from raw object to base handler. That map is now gone: the base handler lives in a private field that Retree stamps onto the raw object itself. This report measures the change on top of #104 (`experiment/plain-object-materialization` at `52a6dcf`), for shallow and deep plain-object trees, eager preparation, a churning live tree, and real Neowyn data, with the compiler off and on.

## The cost was never the `WeakMap.set`

A `WeakMap.set` is about 52 ns in isolation, and the first-traversal profiles spread the per-node cost across many small operations. The expensive part only shows up over time. V8 stores a `WeakMap` as an ephemeron hash table. When a garbage collection clears dead keys, the next mutation of that table rehashes it, and the rehash is proportional to the size of the table, which is every node ever managed that is still alive. In the existing benchmark that landed on `Retree.root`, the first registration after the forced collection: 2 to 8.6 ms for a call that creates one handler. In an application it lands on whatever materializes first after a collection.

Under natural garbage collection with a 200,000-entry live table, a micro-benchmark registering fresh objects amortized to 190 to 290 ns per registration with 15 to 27 ms worst batches of 2,000; the same work through a private field was 45 ns with worst batches under 2 ms.

## Why a private field

A class whose base constructor returns its argument installs its private fields on that argument:

```ts
class HandlerHost {
    constructor(raw: TreeNode) {
        return raw;
    }
}
class HandlerStamp extends HandlerHost {
    #handler: BaseProxyHandler<TreeNode>;
    constructor(raw: TreeNode, handler: BaseProxyHandler<TreeNode>) {
        super(raw);
        this.#handler = handler;
    }
    static read(raw: TreeNode): BaseProxyHandler<TreeNode> | undefined {
        return #handler in raw ? raw.#handler : undefined;
    }
}
```

Registering is 26 ns; a hit reads in about 6 ns and a miss brand-checks in about 5 ns. Private fields are invisible to `Reflect.ownKeys`, `Object.getOwnPropertySymbols`, spread, `Object.assign`, `JSON.stringify`, `structuredClone`, and Vitest equality, so `Retree.raw` output is unchanged. They can be added to non-extensible and frozen objects, so no fallback map is needed. Registering the same raw twice throws, which pins an invariant the old map silently overwrote.

Two alternatives were built and rejected on measurement. A non-enumerable own symbol property costs about 95 ns to define plus an out-of-object property store, made first traversal 20 to 50% slower, and leaked into every `Reflect.ownKeys` walk (the `ownKeys` trap, `Retree.clone`, `prepareTree`, dependency key records). An enumerable symbol assigns in 13 ns but Vitest's `toEqual` counts enumerable symbols, which would break user tests comparing raw values to literals.

The core package now compiles with `target: es2022` and `useDefineForClassFields: false`, so the private field is emitted natively and class fields keep their assignment semantics. Bundlers that lower private fields below ES2022 fall back to WeakMap helpers, which is correct but keeps the old cost. The three samples were built to check: Vite 8 (samples 02 and 03) emits the minified brand check `#e in e` with no `__privateAdd` helper, and Next 16 (sample 04) keeps `#handler` in its chunks.

## Repeated materialization results

Apple M3 Max, macOS 26.6.2, Node 22.13.1. Eight serial blocks, one process per variant per block, five measured fresh graphs after two warmups, order reversed each block. Benchmark processes ran without concurrent tests, typechecks, or other benchmark workers. Every sample validates traversal output. No samples were filtered out. Tables show medians of the eight process medians.

The `root` phase is `Retree.root` alone, measured right after a forced collection. `First traversal` exhaustively exposes the requested plain nodes. `Total` is their sum, which is what an application pays: the WeakMap rehash lands in whichever phase follows a collection.

| Root plus first traversal, ms | #104 off | Registry off | #104 on | Registry on |
| --- | ---: | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 13.288 | 8.492 | 13.973 | 9.153 |
| full materialization 100x100 | 24.881 | 16.694 | 25.065 | 17.304 |
| 5000-deep full traversal | 1.829 | 1.245 | 1.917 | 1.280 |
| existing synchronous materialization 10k rows | 7.881 | 4.621 | 8.010 | 4.711 |
| plain forest depth 16, 16371 nodes | 6.998 | 4.448 | 7.205 | 4.686 |
| plain forest depth 64, 16380 nodes | 6.945 | 4.302 | 7.310 | 4.508 |
| plain forest depth 256, 16191 nodes | 6.794 | 4.177 | 7.064 | 4.486 |
| plain forest depth 1024, 15375 nodes | 6.351 | 3.995 | 6.460 | 4.346 |
| explicit prepareTree, 16191 plain nodes | 27.044 | 22.825 | 25.760 | 23.151 |
| churn: 30 rounds of 1k fresh rows into a 40k-node live tree | 60.971 | 32.674 | 58.490 | 32.845 |
| Neowyn fixture exhaustive plain traversal | 70.410 | 59.335 | 64.718 | 59.485 |

| Root phase, ms | #104 off | Registry off | #104 on | Registry on |
| --- | ---: | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 4.257 | 0.011 | 4.555 | 0.015 |
| full materialization 100x100 | 8.499 | 0.011 | 8.639 | 0.012 |
| 5000-deep full traversal | 0.556 | 0.004 | 0.608 | 0.008 |
| existing synchronous materialization 10k rows | 3.206 | 0.010 | 3.219 | 0.012 |
| plain forest depth 16, 16371 nodes | 2.385 | 0.007 | 2.555 | 0.010 |
| plain forest depth 64, 16380 nodes | 2.259 | 0.007 | 2.557 | 0.009 |
| plain forest depth 256, 16191 nodes | 2.304 | 0.007 | 2.327 | 0.009 |
| plain forest depth 1024, 15375 nodes | 2.050 | 0.007 | 2.293 | 0.010 |
| explicit prepareTree, 16191 plain nodes | 2.363 | 0.013 | 2.318 | 0.025 |
| churn (live tree build and first read) | 21.500 | 12.364 | 21.392 | 12.323 |
| Neowyn fixture exhaustive plain traversal | 0.015 | 0.015 | 0.016 | 0.015 |

The Neowyn root phase is small in both variants because that scenario runs last, after the fixture clone has already triggered collections. Its rehash shows up inside the first traversal instead.

| First traversal, ms | #104 off | Registry off | #104 on | Registry on |
| --- | ---: | ---: | ---: | ---: |
| existing first-touch scan 100x100 | 8.710 | 8.478 | 9.530 | 9.129 |
| full materialization 100x100 | 16.103 | 16.686 | 16.234 | 17.294 |
| 5000-deep full traversal | 1.252 | 1.239 | 1.322 | 1.275 |
| existing synchronous materialization 10k rows | 4.729 | 4.609 | 4.791 | 4.703 |
| plain forest depth 16, 16371 nodes | 4.664 | 4.442 | 4.860 | 4.674 |
| plain forest depth 64, 16380 nodes | 4.533 | 4.296 | 4.704 | 4.499 |
| plain forest depth 256, 16191 nodes | 4.442 | 4.169 | 4.511 | 4.479 |
| plain forest depth 1024, 15375 nodes | 4.195 | 3.987 | 4.194 | 4.338 |
| explicit prepareTree, 16191 plain nodes | 24.451 | 22.779 | 23.365 | 23.108 |
| churn: 30 rounds of 1k fresh rows | 27.012 | 20.286 | 25.504 | 20.610 |
| Neowyn fixture exhaustive plain traversal | 67.964 | 59.324 | 63.318 | 59.470 |

| Forest depth | #104 ns per plain node, root plus first traversal | Registry ns per plain node | #104 first traversal only | Registry first traversal only |
| --- | ---: | ---: | ---: | ---: |
| 16 | 427.5 | 271.7 | 284.9 | 271.3 |
| 64 | 424.0 | 262.6 | 276.7 | 262.3 |
| 256 | 419.6 | 258.0 | 274.4 | 257.5 |
| 1024 | 413.1 | 259.8 | 272.8 | 259.3 |

Amortized nanoseconds per plain chain node with the compiler off, including traversal and container overhead. The first-traversal-only columns show the per-node registration itself got slightly cheaper; the total columns show what removing the rehash is worth.

## Churn

The new scenario keeps a 40,400-node tree mounted (200 sections of 100 rows, each row holding a detail object), then runs 30 rounds that each replace the rows of 10 sections with 1,000 fresh raw rows and read them, the way server updates arrive. Garbage from replaced rows is collected on the engine's schedule; nothing is forced between rounds.

| Churn, compiler off | #104 | Registry |
| --- | ---: | ---: |
| 30 rounds total, ms | 27.012 | 20.286 |
| worst single round, ms | 5.610 | 2.495 |
| live tree build and first read, ms | 21.500 | 12.364 |
| warm re-read of all 20,000 rows, ms | 1.842 | 1.642 |

With the compiler on: 25.504 to 20.610 ms total, 5.527 to 2.797 ms worst round. The worst round is the one that follows a collection.

## Effects and uncertainty

Effects use the geometric mean of paired process-median ratios within each block. Intervals are nominal 95% percentile bootstrap intervals from 20,000 resamples of the eight blocks, seed 10407. The five samples within a process are not treated as independent runs. These intervals do not correct for multiple comparisons and do not establish cross-machine or Neo-wide gains. Positive percentages mean less time.

| Workload, root plus first traversal | Compiler off reduction, nominal 95% interval | Compiler on reduction, nominal 95% interval |
| --- | ---: | ---: |
| existing first-touch scan 100x100 | 37.5% [34.7%, 40.3%] | 33.6% [28.9%, 37.9%] |
| full materialization 100x100 | 31.9% [27.4%, 35.6%] | 32.0% [28.5%, 35.6%] |
| 5000-deep full traversal | 33.1% [31.4%, 34.8%] | 33.3% [30.8%, 35.7%] |
| existing synchronous materialization 10k rows | 41.5% [39.6%, 43.0%] | 40.8% [38.2%, 43.2%] |
| plain forest depth 16, 16371 nodes | 36.7% [34.5%, 38.7%] | 36.0% [33.2%, 38.5%] |
| plain forest depth 64, 16380 nodes | 38.5% [35.4%, 41.7%] | 38.1% [35.5%, 40.6%] |
| plain forest depth 256, 16191 nodes | 38.9% [37.2%, 40.6%] | 35.8% [32.1%, 39.2%] |
| plain forest depth 1024, 15375 nodes | 36.8% [34.5%, 38.9%] | 32.9% [31.2%, 35.0%] |
| explicit prepareTree, 16191 plain nodes | 15.4% [9.1%, 21.2%] | 12.7% [7.6%, 17.6%] |
| churn: 30 rounds of 1k fresh rows into a 40k-node live tree | 46.9% [43.8%, 50.0%] | 45.3% [41.9%, 49.2%] |
| Neowyn fixture exhaustive plain traversal | 12.1% [5.4%, 17.6%] | 6.2% [0.4%, 11.1%] |

| Workload, first traversal only | Compiler off reduction, nominal 95% interval | Compiler on reduction, nominal 95% interval |
| --- | ---: | ---: |
| existing first-touch scan 100x100 | 7.2% [1.8%, 13.0%] | 2.1% [-5.0%, 9.1%] |
| full materialization 100x100 | -2.9% [-9.7%, 3.1%] | -3.8% [-10.2%, 2.9%] |
| 5000-deep full traversal | 2.1% [0.0%, 3.9%] | 2.5% [-0.4%, 5.0%] |
| existing synchronous materialization 10k rows | 2.9% [-0.8%, 6.0%] | 1.9% [-4.1%, 7.9%] |
| plain forest depth 16, 16371 nodes | 5.2% [0.4%, 9.4%] | 3.9% [-0.5%, 8.1%] |
| plain forest depth 64, 16380 nodes | 6.9% [1.3%, 12.8%] | 6.2% [1.8%, 10.9%] |
| plain forest depth 256, 16191 nodes | 5.9% [2.7%, 9.1%] | 1.2% [-4.4%, 6.7%] |
| plain forest depth 1024, 15375 nodes | 4.4% [0.9%, 7.5%] | -2.0% [-5.7%, 2.3%] |
| explicit prepareTree, 16191 plain nodes | 7.2% [-0.2%, 14.3%] | 3.9% [-2.0%, 9.6%] |
| churn: 30 rounds of 1k fresh rows into a 40k-node live tree | 25.2% [18.0%, 32.0%] | 21.8% [15.0%, 28.8%] |
| worst churn round | 56.6% [50.2%, 62.3%] | 51.3% [45.2%, 57.7%] |
| Neowyn fixture exhaustive plain traversal | 10.3% [4.2%, 15.4%] | 4.8% [-0.4%, 9.3%] |

First traversal alone is a small gain or a wash for fresh trees: the stamp is cheaper than a `WeakMap.set`, but the brand-check miss on each fresh child is a little dearer than a `WeakMap.get` miss. The total and churn rows carry the result. Warm traversal is unchanged within noise for most workloads; the 10,000-row warm re-read is 9.1% [4.9%, 13.6%] slower (0.49 to 0.54 ms) with the compiler off and inside noise with it on, and the full 100x100 warm re-read is 30.9% [28.0%, 33.9%] faster. Both warm effects come from views resolving their base handler through the field instead of the map and from raw objects changing hidden class when stamped; neither was targeted.

## Real Neowyn data

The exhaustive fixture probe uses `neo-compose/scripts/fixtures/neowyn-character-body-runtime-state.json.gz`, the same checked-in data used by the world-animation frame test. It clones the raw JSON outside timing, roots it, and iteratively reads every enumerable property. It does not construct Neo view models or render React. The fixture is not copied into this repository.

First traversal moved from about 68 ms to 59 ms with the compiler off, 12.1% less for root plus traversal, and 6.2% [0.4%, 11.1%] with it on. This is one large real tree materialized once in a fresh process. The churn scenario is the closer model of a mounted Neo document receiving updates, and it is where the registry change is worth the most.

## Memory, bundle, and build check

Retained heap after fully materializing 100,000 rows (200,400 managed plain nodes) in a fresh process, measured three times each after two forced collections: 278.6 bytes per node on #104 and 277.1 bytes on the registry branch. The private field costs what the map entry cost.

A minified browser ESM consumer of `Retree.root({ rows: [] })`, target ES2022, grew from 99,301 to 99,404 bytes; gzip from 27,871 to 27,930 bytes; Brotli from 24,503 to 24,575 bytes. The consumer bundle keeps the private-field brand check natively. Eight serial reversed-order esbuild pairs after warmup measured medians of 9.22 ms for #104 and 7.97 ms for the registry consumer; this is a small local bundle probe, not evidence of faster application builds.

## Reproduce

Check out the #104 commit into a temporary baseline directory with dependencies, and copy the current `benchmarks/plain-materialization.mts` into it so both variants run the same scenarios, including churn.

```sh
node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON
RETREE_PLAIN_FIXTURE=/path/to/neowyn-character-body-runtime-state.json.gz node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON
RETREE_MATERIALIZATION_SCENARIO=churn npm run benchmark:plain-materialization
```

Raw observations for all four variants, every warmup and sample, and every phase: [node-registry-sep-7-2026.json](./node-registry-sep-7-2026.json). The `worstRoundMs` field is present on churn samples only.

## Validation

All 1,688 SDK tests passed. Full typecheck, benchmark typecheck, core and compiler builds, doctor, and architecture checks passed. A new test covers a non-extensible raw child: it is managed, `Retree.managed` resolves it from its raw object, and its own keys stay clean. The three samples build with the private field intact.

Neo's unit lane (1,014 files, 12,484 tests) ran in the `retree-0-10-4` worktree with this runtime and the matching compiler build installed and `RETREE_COMPILER=1`: 1,013 files and 12,479 tests passed, 4 skipped. The one failing file is `scripts/vercel-build-dry-run.test.ts`, a deploy-command count assertion that fails in that worktree without Retree changes as well. Neo's installed packages were restored afterwards. This lane validates behavior and is not a timing comparison.
