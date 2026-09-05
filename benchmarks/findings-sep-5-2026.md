# Findings September 5, 2026 — write-path and subscription audit

Context: a follow-up audit after the August `@select` caching work, looking
for quadratic scaling first and linear waste second, and measuring paths the
existing probes did not cover. The branch was started from a stale main and
rebased onto 0.9.0 (`c8cbaef`), which had independently fixed part of what
the audit found (#56 linear transaction records, #60 snapshot propagation by
root, #62 lazy ancestor views, #63 retained dependency records). Where the
two overlapped, the version below keeps whichever design measured better and
folds the other's invariants in; everything else here is on top of 0.9.0.

Profiles were taken with `node --cpu-prof` against source bundles of three
scenarios: a trapped `@select` getter over 1000 items under related writes, a
tracked `Retree.select` over 1000 items under related writes, and plain leaf
writes at depth 20 with and without a root `treeChanged` listener.

## Quadratic paths

1. **Transaction change-record accumulation.** Main's #56 already made this
   linear by collecting one copied sub-array per write and flattening at
   emission. The branch keeps a flat list instead: copied once off the first
   write (callers still hold their own records) and grown in place, with
   each list detached before delivery so a listener that queues more changes
   cannot mutate records already handed out. Same guarantees, one array per
   node per flush instead of one per write plus a flatten.
2. **Deferred lifecycle drain.** `drainPendingReactiveLifecycles` took a
   fresh `entries().next()` per queued node while deleting as it went. On
   V8 a fresh Map iterator re-skips every deleted slot, so N queued
   ReactiveNodes cost O(N²) iterator steps (186 ms at 40k nodes in
   isolation vs 3 ms). One live `for...of` keeps the delete-as-processed
   semantics and still visits nodes queued mid-drain.

## Linear waste removed

3. **Double dependency collection per related write.** Notifying a
   dependent `@select` owner reproxies it, which bumps the global write
   version and evicted the collection validation had just built; the
   deferred lifecycle pass then re-ran the `dependencies` getter and every
   `@select` getter a second time. The notification reproxy only changes
   the owner's own proxy identity, which its own collection cannot observe,
   so the collection is re-stamped to the new version and reused.
4. **Proxy identity lookups.** `getBaseProxy` walked proxy targets
   recursively (3–5 sentinel traps) and `getUnproxiedNode` paid two.
   Handlers now expose `baseProxy`, so both are one trap, and the snapshot
   version walk resolves a reproxy's base handler the same way. This
   removed the `proxyTargetKey` metadata and `registerCustomProxyMetadata`.
5. **Tracked-selection subscription bookkeeping.** Every tracked
   `Retree.select`/`Retree.effect`/`useSelect` evaluation re-normalized each
   dependency entry (`normalizeDependencyEntry` + `getBaseProxy` +
   `getUnproxiedNode`, ~8 traps and several allocations per read) in three
   near-identical `updateDependencySubscriptions` copies, plus again in
   `getTrackedDependencyComparisonValues`. `collectTrackedSelectionAccesses`
   now emits `sources` (deduped raw node + base proxy, from handlers the
   tracking frame already held) and `comparisonValues` in its single pass;
   one shared `createDependencySubscriptionSet` replaces the three copies
   and the unused per-node `indices` bookkeeping in the tracked forms.
6. **`treeChanged` ancestor walk.** Main's walk resolved each ancestor
   through `getParentInternal` (three traps and a result object per level),
   spread a path record per level, and only then invalidated ancestor views
   (#62). The branch walks handler metadata directly (one trap per level, no
   per-level objects), snapshots listener arrays only for listened nodes,
   invalidates ancestors by raw node without re-resolving their handler, and
   materializes a view only for ancestors whose emission hands one out.
   Main's cached listener-path precheck (#60) is kept in front of it.
7. **Lifecycle pass allocations.** Main's #63 retains the active record per
   dependency across passes; the branch keeps that identity guarantee and
   additionally shares the one record between the dependents registry and
   the owner's own list (main allocated a second record per dependency per
   pass), stores the owner's list as a keyed `Map` (main rebuilt a by-key
   `Map` from the array every pass), and interns positional key strings
   (`select:<getter>:<i>`) instead of re-allocating them per collection.
8. **Write-path trims.** Scalar writes skip `handleNodeRemoved`'s proxied
   read when the previous value is a primitive; `runWithIsolatedDependencyTracking`
   returns directly when no tracking frame is active (two `splice`
   allocations per write before); `handleNodeChanged` allocates one closure
   instead of three per write; `hasReactiveChangedListeners` no longer
   allocates fallback arrays.

## Measurements

M-series laptop, node 22, both columns on the same machine in the same
session. "main" is 0.9.0 (`c8cbaef`). Probe specs run serially with
`--no-file-parallelism --disable-console-intercept`:
`transaction-scaling-perf-probe.spec.ts` (new), `select-flush-perf-probe.spec.ts`,
`perf-probe.spec.ts`.

CPU-profile scenarios (single process, source bundles):

| Scenario | main | branch |
| --- | --- | --- |
| Trapped `@select` over 1000 items, per related write | 7.84 ms | **3.94 ms** |
| Tracked `Retree.select` over 1000 items, subscribe | 21.1 ms | **11.3 ms** |
| Tracked `Retree.select` over 1000 items, per related write | 7.05 ms | **4.00 ms** |
| 100k leaf writes at depth 20, root `treeChanged` + leaf `nodeChanged` | 672 ms | **261 ms** |
| 100k leaf writes at depth 20, leaf `nodeChanged` only | 93.0 ms | 86.1 ms |
| 100k flat writes, `nodeChanged` | 93.7 ms | 87.9 ms |

Probe specs:

| Scenario | main | branch |
| --- | --- | --- |
| 10k leaf writes at depth 20, root `treeChanged` + leaf `nodeChanged` | 116 ms | **59 ms** |
| 20 related writes, tracked select over 500 / 2000 items | 52 / 164 ms | **30 / 81 ms** |
| Scalar write with tracked select active (first / second) | 21.0 / 14.1 ms | 11.9 / 12.0 ms |
| `@select` related write, 1000 / 2000 items | 12.1 / 27.7 ms | **5.6 / 10.7 ms** |
| `@select` related-write scaling, 4x items | 3.5x | 1.8x |
| 100 writes with 50 dependency edges on one node | 27.4 ms | 18.8 ms |
| Transaction, 50 own-field writes, `@select` scanning 1000 items | 10.1 ms | 7.0 ms |
| Transaction changing 20 `@select` dependencies in one flush | 0.38 ms | 0.23 ms |
| Transaction writing 8000 listened ReactiveNodes | 61 ms | 53 ms |
| 10k deep writes with an unrelated `treeChanged` listener | 18.2 ms | 13.9 ms |
| Transaction, 8000 writes to one listened node | 14.6 ms | 15.7 ms |
| Transaction, 8000 pushes under a root `treeChanged` listener | 22.9 ms | 21.5 ms |

The last two rows are the paths #56 already fixed on main; the new probe
pins them linear (8x size → 4.2–4.9x time) either way. Read-path steady
state (proxied scan of 30k nodes) is unchanged: it is trap-dispatch bound
and was not in scope.

Benchmark CLI, `--profile smoke --workers 4`, three interleaved main/branch
pairs with idle gaps between runs. Δ is the median of per-case median deltas
(branch vs main) for each pair; the noise column is the widest main-vs-main
delta seen for that scenario across the same runs. Pairs run without gaps
or with the default 17 workers were not reproducible (whole runs shifted
2x) and are not reported.

| Scenario | Pair 1 Δ | Pair 2 Δ | Pair 3 Δ | Noise |
| --- | --- | --- | --- | --- |
| Auto-trapped `@select` | -9.3% | -16.6% | -9.7% | ±9.0% |
| Auto-trapped `@memo` | -4.2% | -12.6% | -6.7% | ±3.4% |
| Auto-trapped `@fnMemo` | -7.7% | -13.2% | -6.1% | ±1.7% |
| Direct `nodeChanged` | -5.5% | -15.2% | -5.3% | ±4.8% |
| Root `treeChanged` | **-13.7%** | **-19.7%** | **-12.3%** | ±4.4% |
| Listener fan-out `nodeChanged` | +1.7% | -7.9% | -3.1% | ±3.8% |
| Distinct node listeners | -4.8% | -6.6% | -3.7% | ±1.6% |
| Ancestor `treeChanged` fan-out | -6.2% | -8.3% | -5.6% | ±2.5% |
| Reactive dependency `nodeChanged` | **-11.5%** | **-19.2%** | **-8.4%** | ±7.2% |
| Reactive dependency fan-out | -3.5% | -5.5% | -3.1% | ±1.6% |
| Reactive dependency update fan-out | -1.2% | -3.0% | +6.7% | ±3.4% |
| React `useNode` | -0.6% | -3.8% | -1.6% | ±2.4% |
| React `useTree` | +3.1% | -6.5% | -1.6% | ±1.6% |
| `onChanged` effect | -2.9% | -10.7% | -13.1% | ±3.9% |
| Subscription churn | -6.9% | -7.7% | -9.0% | ±3.1% |
| `runTransaction` overhead | 0.0% | 0.0% | 0.0% | 0.0% |
| Reactive select vs tree traversal | **-20.2%** | **-13.5%** | -4.2% | ±6.3% |

Consistent beyond noise in every pair: root `treeChanged`, reactive
dependency `nodeChanged`, auto-trapped `@select`/`@memo`/`@fnMemo`, ancestor
`treeChanged` fan-out, subscription churn, and `onChanged` effect. Reactive
dependency update fan-out, React `useNode`/`useTree`, and `runTransaction`
overhead are within noise (the last has 0 ms per-case medians at smoke
frequencies).

## Follow-ups

- The `treeChanged` path still pays one sentinel trap per ancestor level in
  the notification walk and the snapshot version walk (the listener
  precheck is cached). Storing the parent handler on the parent edge would
  make both walks plain property reads.
- Tracked selection re-evaluation is now dominated by the tracked read
  itself (one entry, one comparison accessor, one closure per property
  read). Lazily built accessors would be the next lever for large selectors.
