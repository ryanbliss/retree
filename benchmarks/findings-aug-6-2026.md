# Findings August 6, 2026 — `@select` caching and dependency-comparison work

Context: app feedback reported two landmines — (1) hand-rolled caches thrashing
on context-dependent proxy identity, and (2) eager select-value capture at the
first write inside a transaction permanently poisoning revision-keyed memos.
This pass implements the two library-side proposals from that feedback:
capture select "previous" values from settled pre-transaction state, and a
version-stamped memo cell that evaluates dependency arrays once per flush.

## Changes (packages/retree-core)

1. **Deferred `@select` lifecycle.** `handleReactiveNode` (dependency
   collection + select value capture) no longer runs on every write during a
   transaction. Written ReactiveNodes queue in a pending map; the transaction
   flush drains the queue before each pending emission and once in a `finally`
   after the flush loop, always against settled state. Fixes the torn-memo
   poisoning and collapses N writes' worth of collection into one pass.
2. **Version-stamped dependency collection.** One full collection pass
   (`dependencies` getter + every `@select` getter) per node per global write
   version, cached in a WeakMap. The write version bumps in
   `updateReproxyNode` (the mutation chokepoint), on ignored-key trap writes,
   and once per `Retree.runSilent` block. Validation for N changed
   dependencies in one flush and the lifecycle pass share one collection.
3. **Single getter run.** Trapped `@select` getter values are captured from
   the tracked collection pass (`trackedAccesses.value`) instead of running
   the getter a second time via `getValue`. Explicit-selector getters use
   lazy memoized value cells so unchanged-dependency validation never runs
   the output getter at all (pinned by an existing test).
4. **Baseline preservation.** When a deferred lifecycle pass refreshes
   records for a dependency whose emission is still pending (unvalidated)
   in the current flush, the stored "previous" comparisons/select
   value/access summaries are preserved (or left undefined for new records,
   which validation treats as "assume changed") so pending changes notify
   instead of being absorbed.

## Adversarial review

An adversarial review pass on the initial implementation confirmed six
defects, all fixed and pinned by regression tests in
`select-transaction.spec.ts`:

- Lazy select-value cells resolved outside `runWithoutEmitting` → infinite
  re-trigger for getters that write. Fixed by wrapping lifecycle resolution.
- Deferred pass stored post-write values as the "previous" baseline →
  silently absorbed notifications (change 4 above).
- A subscription landing inside the listener-flush wrapper after the trailing
  drain (React batched-updates commit) was never drained. Fixed by a
  `finally` drain after the flush loop.
- A listener throw mid-flush skipped the trailing drain, leaving stale
  subscriptions. Same `finally` drain fixes it.
- A throwing `dependencies` getter dropped every other queued lifecycle pass.
  Fixed by delete-as-processed draining.
- `@ignore` field writes never bumped the write version → stale cached
  collections. Fixed by bumping in the ignored-key trap paths.

Deliberate behavior notes:

- `ReactiveNode.onChanged` now runs before the node's dependency/select
  refresh instead of after (the refresh is deferred to the flush).
- Impure trapped `@select` getters run fewer times per flush; notification
  counts for such getters can differ from before (they were already
  documented as required-pure).
- A `Retree.on` subscription made mid-transaction now captures its baseline
  at flush (settled state) instead of mid-transaction; a dependency written
  in the same transaction conservatively notifies.

## Measurements

Probe: `select-flush-perf-probe.spec.ts` (run with
`--disable-console-intercept`), M-series, node 22, source via vitest.

| Scenario | main | branch |
| --- | --- | --- |
| Transaction, 50 own-field writes, trapped `@select` scanning 1000 items | 235 ms | **6.9 ms (~34x)** |
| Transaction writing 20 explicit `@select` dependencies in one flush | 0.67 ms | **0.26 ms (~2.6x)** |
| Single own-field write, trapped `@select` scanning 1000 items | ~5.0 ms (2 getter runs) | ~5.0 ms (1 getter run) |

Deterministic counts (pinned in `select-transaction.spec.ts`): a
10-write transaction used to run the trapped getter ~20 times (2 per write),
now ≤2 per flush; 5 changed dependencies used to collect the dependency
array 5+ times per flush, now ≤3.

Single-write wall time is unchanged because it is dominated by the
per-dependency subscription diff in `handleReactiveNode` (~4 ms at 1000
tracked dependencies), which this pass did not touch — that remains the next
lever for single-write latency.

Legacy `perf-probe.spec.ts` scenarios (select subscribe, scalar write with
tracked select active, `@select` related/unrelated writes at 250–2000 items):
parity with main within run noise; unrelated writes stay at ~0.009 ms.

Benchmark CLI (smoke profile, interleaved A/B on a quiet machine):

Interleaved smoke-profile A/B (same machine, quiet, medians in ms): select
paths improved (`@select` 0.038 → 0.033, `@memo` 0.070 → 0.060, `@fnMemo`
0.077 → 0.069, onChanged effect 0.047 → 0.039, subscription churn 0.0054 →
0.0045); listener-emission microbenches read 0.015–0.074 both sides with
±10–20% run-to-run variance and no consistent direction. Legacy
`perf-probe.spec.ts` emission anchors (10k deep writes ~33–36 ms, push-1000
~0.8–1.0 ms, treeChanged push ~3.8 ms) match main. The only consistent
non-select delta is "100 writes w/ 50 edges on one dependency" at ~+7%
(14.2–15.2 → 16.0–16.3 ms) — per-notification cache invalidation forcing a
recollect; an acceptable trade against the transaction-path wins, and a
candidate for a notification-aware version bump later.
