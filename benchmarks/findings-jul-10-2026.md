# Findings July 10, 2026 — Proxy trap & materialization costs for query-heavy workloads

Focus: performance of algorithms that query large collections of deeply nested lists through Retree proxies, with emphasis on materialization (first-touch lazy proxying) and dependency-tracked reads.

## Measurements

Probe: a tree of 100 groups × 100 items (10k items, each with a nested `tags` array of 2 objects → ~30k+ object nodes). `scan()` iterates every group/item/tag and reads ~5 fields per item. Run against source via vitest on this machine (M-series, node). One-off probe, deleted after measurement; numbers are directional, not tracked benchmarks.

| Scenario | Time |
| --- | --- |
| Raw object scan (steady) | **0.28 ms** |
| `Retree.root()` (lazy, no touch) | 2.2 ms |
| Proxied scan, **first touch** (materialization) | **58.7 ms** (~200× raw) |
| Proxied scan, steady-state (children cached) | **5.6 ms** (~20× raw) |
| Scan via `getUnproxiedNode(tree)` | 0.32 ms (≈ raw) |
| Dependency-tracked scan, 250 items | 7.7 ms |
| Dependency-tracked scan, 500 items | 25.0 ms |
| Dependency-tracked scan, 1000 items | 94.4 ms |
| Dependency-tracked scan, 2000 items | **400.4 ms** |
| `Retree.select(tracked)` subscribe, 1k items | 91.9 ms |
| Single scalar write with tracked select active | **88.8 ms** (every write) |
| Push 1000 items, no listeners | 3.9 ms |
| Push 1000 items, `treeChanged` on root | 11.3 ms |
| Push 1000 items in `runTransaction` | 1.8 ms |

Three separate problems compound for the "algorithm queries a big tree" case:

1. Dependency tracking is **O(N²)** in the number of tracked reads (8× items → 52× time).
2. First-touch materialization costs ~2 µs/node — 10× the already-proxied steady-state scan and ~200× raw.
3. A tracked selector re-runs **in full, under tracking, on every write** to any dependency — so one scalar write costs the full quadratic scan (88 ms above).

## 1. Dependency tracking is quadratic — highest-leverage algorithmic fix

Every tracked property read runs
[dependency-tracking.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/dependency-tracking.ts:182) `trackDependencyPropertyAccess`, which calls:

- `removePendingManagedValueAccess(currentFrame, ownerUnproxiedNode)` — a reverse **linear scan of every entry recorded so far**, with `splice` (itself O(n)) on match.
- In `comparisons` mode additionally `removePendingPropertyValueAccess(...)` — a second full linear scan per read.

So a selector that reads N properties does N scans over a frame that grows to N entries → O(N²) with two constant factors. This is exactly the "query a large collection of deeply nested lists inside `@select` / trapped `memo` / tracked `Retree.select`" path.

**Fix shape** (keeps semantics, changes bookkeeping):

- Give `DependencyAccessFrame` side indexes: `managedValueEntries: Map<TreeNode, number[]>` and `propertyValueEntries: Map<TreeNode, number[]>` mapping unproxied node → entry indices.
- Replace `splice` with tombstoning (`entries[i] = undefined` or a `dead` flag) and filter dead entries once in `collectDependencyAccesses` / `collectDependencyComparisonAccesses`. Removal becomes amortized O(1); collection totals O(N).
- Same for `isWrittenPropertyEntry`: build a `Set` of `owner→keys` from `frame.writes` once at collection time instead of scanning `writes` per entry.

Expected effect: the 2000-item tracked scan drops from ~400 ms to roughly the steady-state trap cost (~a few ms) plus O(N) bookkeeping.

Secondary constant-factor cost in the same path: each tracked read allocates an entry object, an `IReactiveDependency`, a comparison-accessor object, and a closure ([dependency-tracking.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/dependency-tracking.ts:223)). Four allocations per read is a lot at 100k reads; consider pooling or flattening into parallel arrays after the quadratic fix lands.

## 2. Tracked selectors re-run fully on every dependency write

Two multiplication effects:

- `createRetreeTrackedSelectionObserver.evaluate()` ([select.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/select.ts:392)) re-runs the whole selector under `collectDependencyAccesses` on **every** `nodeChanged` from **any** dependency. With a selector that scans 1k items, each write costs ~90 ms today.
- For `ReactiveNode`, `hasReactiveDependencyChanged` ([Retree.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/Retree.ts:1765)) calls `getReactiveNodeDependencies(dependent.reactiveNode, false)`, which re-runs `dependencies` **and every `@select` getter** — per dependent, per notification. Multiple dependents on one node re-run the same getters repeatedly within a single flush.

**Fix shapes:**

- **Cheap validation before recompute.** `runTrappedMemo` already has the right pattern: keep the comparison accessors from the last run and call `getValues()` (one targeted `Reflect.get` per accessor) to decide whether anything relevant changed before re-running the selector. Tracked `Retree.select` should adopt the same validation pass instead of unconditional re-run.
- **Field-scoped invalidation.** The emitter now carries `INodeFieldChanges[]` (#26), and comparison accessors know their `(ownerUnproxiedNode, propertyKey)`. When a `nodeChanged` arrives with `changes` for keys that no accessor on that owner reads, skip validation entirely. This turns "any write to a watched node" into "writes to watched fields."
- **Per-flush dependency cache.** Cache the result of `getReactiveNodeDependencies` keyed by (node, reproxy identity or a version counter) for the duration of one notification flush so N dependents don't re-run all select getters N times.

## 3. Materialization (first-touch) is ~10× steady-state reads

Lazy proxying moved the cost out of `Retree.root()` (2 ms — good), but the first full traversal pays ~2 µs per node. Per uncached object-valued read, the `get` trap does:

- `Reflect.getOwnPropertyDescriptor` — allocates a descriptor object per read until the child is cached ([proxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/proxy.ts:366)).
- `shouldLazilyProxyProperty` → `isCustomProxy` (WeakMap get), `instanceof` ×4, `getPrototypeOf`; then `shouldKeepRawPropertyValue` repeats `isProxyableObject` + `isCustomProxy` on the same value.
- `getOrCreateProxiedChild` → `getManagedProxyForUnproxiedNode` (2 more WeakMap gets) → `buildProxy`, which allocates the handler + closures + Proxy, registers two WeakMap entries, and then **eagerly walks `Object.entries(object)`** doing a descriptor lookup per object-valued field just to decide "defer this" ([proxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/proxy.ts:728)).

**Fix shapes:**

- **Skip descriptor lookups on the common shape.** Non-writable / non-configurable own data props are rare. Check `Object.isFrozen(target) || Object.isSealed(target)` once (per node, cacheable) and skip per-prop descriptor allocation when false and the prototype is `Array.prototype`/`Object.prototype`. Keep the slow path for exotic nodes.
- **Trim redundant lookups.** One `isCustomProxy` per value per get is enough; thread the result through instead of re-checking in `shouldKeepRawPropertyValue` / `createStructuralProxyForValue` / `getOrCreateProxiedChild` (each does its own metadata WeakMap get).
- **Defer the `buildProxy` constructor walk.** For plain objects/arrays every child is deferred anyway; the `Object.entries` loop mostly confirms that at descriptor-lookup cost. Restrict the eager walk to shapes that need it (ReactiveNode collected/linked keys, existing custom-proxy children needing reparent) and let everything else resolve through the lazy read path.
- **Direct batch materializer.** `ReactiveNode.prepareTree` currently materializes by reading through the get traps, paying the full per-read overhead. An internal recursive materializer that walks raw targets and populates `proxiedChildrenKey` directly (no trap dispatch, no tracking checks) would make explicit preparation several times cheaper than trap-driven touch.

## 4. Steady-state trap overhead (~20× raw)

Acceptable for UI reads; painful for algorithms. Worthwhile constant-factor cuts:

- `FUNCTION_NAMES_BIND_TO_RAW.includes(prop)` — linear array scan on **every function-valued get** (every `map`/`filter`/`push` access). Make it a `Set`.
- `String(prop)` allocation per get on ReactiveNode instances ([proxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/proxy.ts:256)) — only needed for the `RETREE_` prefix check; check `typeof prop === "string"` first and avoid symbol coercion.
- `proxyHandler[proxiedChildrenKey]` is a plain object mutated with `Reflect.deleteProperty` — deletes push V8 objects into dictionary mode, and array nodes fill it with thousands of numeric-string keys. A `Map` is more predictable for both.
- **Array read-method fast paths.** Arrays already bind methods to the base proxy, so `arr.map(...)` pays full trap dispatch per element (`length` + `has` + `get` per index). The Map/Set wrappers show the pattern: intercept hot read-only methods (`forEach`, `map`, `filter`, `find`, `some`, `every`, `reduce`, `slice`) with wrappers that iterate the **raw target** and serve children from the `proxiedChildrenKey` cache (materializing on demand), skipping generic trap logic per element.
- `reproxy.get` reads object-valued props **twice** — once from the raw target, then again through the base proxy to get the custom-proxy value ([reproxy.ts](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/packages/retree-core/src/internals/reproxy.ts:222)). Consulting `handler[proxiedChildrenKey]` first (it's shared with the base handler) would skip the second dispatch for cached children.

## 5. Give algorithms a sanctioned raw-read escape hatch

`scan via getUnproxiedNode` ran at raw speed (0.32 ms vs 5.6 ms proxied). There is no public API for this today.

- **`Retree.peek(node)`** (or `Retree.raw`): documented public accessor for the unproxied target, positioned as "query on peek, mutate through the proxy." Caveat to document/handle: raw targets can contain base proxies for children that were assigned as existing proxies (the `set` trap stores the reparented proxy into the target), so a raw-tree walk is not guaranteed 100% proxy-free — fine for reads, but identity-sensitive code should normalize with `getUnproxiedNode` per node.
- **`Retree.untracked(fn)`**: public wrapper over the existing `runWithoutDependencyTracking`, so selector/memo authors can exclude a bulk scan from dependency collection deliberately (subscribe to the collection node coarsely instead).
- **Longer-term: version-cached snapshots (Valtio-style).** Every mutation already refreshes reproxy identity; a per-node version counter enables `Retree.snapshot(node)` returning an immutable plain-object snapshot with structural sharing, cached until the subtree version changes. Queries then run at native speed on plain data and get stable identities for React. This is the cleanest long-term answer for query-heavy workloads.

## 6. Write path notes

- Each `set` builds a fresh reproxy (`updateReproxyNode` → handler + closures + `new Proxy`) even when nothing will observe it. A dirty-flag scheme — mark the reproxy stale on write, build lazily on the next `getReproxyNode` — would remove per-write proxy allocation for unobserved/batched writes. Care needed: listeners receive the reproxy in the emit payload, so laziness must materialize before listener dispatch (or only when a listener exists for that node).
- `runTransaction` already halves un-listened bulk-push cost (1.8 ms vs 3.9 ms per 1000 pushes); worth recommending loudly in docs for algorithmic writes.
- `setValuesIterator` / `setEntriesIterator` do `Array.from(...)` per iteration call — O(n) allocation per loop over a Set.

## Results — implementation pass (same day)

Fixes 1–6 from the recommended order below were implemented and measured with
the targeted probe in `packages/retree-core/src/perf-probe.spec.ts`
(`npx vitest run packages/retree-core/src/perf-probe.spec.ts --project core --disable-console-intercept`).
All 298 tests pass. Benchmark artifacts: `retree-benchmark-BASELINE-JUL10`,
`-FIX1-TRACKING`, `-FIX2-SELECT`, `-FIX3-REACTIVE`, `-FINAL-JUL10`. Note the
stable/medium CLI profile has high run-to-run variance on sub-ms scenario
averages (same-code runs flipped ±60%); medians and the targeted probe are the
trustworthy signals at this sample count.

| Probe measurement | Baseline | After | Change |
| --- | --- | --- | --- |
| Tracked scan, 2000 items | 383 ms | 5.8 ms | **66× faster, quadratic → linear** (8× items now 4.5× time, was 53.5×) |
| Tiny tracked frame (3 reads) | 0.70 µs | 0.68 µs | unchanged (lazy index allocation) |
| Unrelated write with 1k-item tracked `select` active | ~87 ms | ~5 µs amortized | **~16,000×** (field-scoped skip; first skip pays ~0.5 ms lazy summary build) |
| Related write with tracked `select` active | ~85 ms | ~9–14 ms | ~7×; remaining cost is the legitimate selector re-run + O(N) resubscription |
| 100 writes, ReactiveNode with 50 dependency edges on one node | 92.7 ms | 15.0 ms | 6.2× (dependencies getter runs once per group, not per edge) |
| First-touch materialization, 10k items | ~55 ms | ~38 ms | ~30% (descriptor-lookup elimination, flattened lazy path, metadata record removal) |
| `Retree.raw` scan, 10k items | n/a | 0.21–0.25 ms | ≈ raw speed (proxied steady-state scan is ~5.3 ms) |
| Steady-state proxied scan | 5.6 ms | 5.3 ms | inherent trap dispatch; `peek` is the designed escape |

**What changed:**

1. `dependency-tracking.ts`: tombstoned entries + lazily-allocated side indexes
   (`managedValueIndices`, `propertyValueIndices`, `writtenKeys` Set) replace the
   per-read reverse scans and splices. Writes-during-tracking keep a linear scan
   (rare path) so reads pay no index maintenance for them.
2. Tracked `Retree.select` / `useSelect(() => ...)`: a validation gate
   (`canSkipTrackedDependencyChange`) runs before selector re-runs. Plain-object
   dependencies skip outright when emitted change keys miss the selector's read
   set; otherwise per-node comparison accessors re-read just the values the
   selector read from the changed node. Arrays are excluded from key scoping
   (index writes imply `length` changes that emissions don't record) and
   ReactiveNodes are excluded (dependency-driven emissions forward foreign
   change records); both still get accessor validation. The React subscription
   hub now forwards `changes` to hub listeners.
3. `handleReactiveDependentNodeChanged` computes the dependent group's current
   dependency list at most once per group (lazy, key-indexed) instead of once
   per dependency edge.
4. Materialization: `buildProxy`'s constructor walk checks lazy-deferral before
   descriptor lookups (and skips its always-no-op child-record deletes);
   `Object.keys` replaces `Object.entries`; `getOrCreateProxiedChild` builds
   fresh children directly; proxy metadata stores the handler itself instead of
   allocating a `{handler, target}` record per proxy (reproxy handlers carry a
   `proxyTargetKey`).
5. New public APIs: `Retree.raw(node)` (raw read escape hatch),
   `Retree.untracked(fn)` (pause dependency collection), and
   `Retree.peekInto(node, fn)` (run a read-only query against the raw object,
   then resolve the result to its managed node — latest reproxy or base proxy
   — when one exists). `ReactiveNode` exposes instance conveniences `raw()`,
   `untracked(fn)`, and `peekInto(fn)` that delegate to the static APIs via
   the existing implementation-injection pattern. (`query` was considered as
   the name for `peekInto` but is reserved by `ConvexNode.query`.) All
   documented with read-only / caveat guidance and covered by tests. Caveat:
   `peekInto` resolves only the returned value itself (not container
   elements), and children never read through the managed tree have no proxy
   yet, so they resolve raw — traverse once or `prepareTree` when a managed
   result is required.
6. Hygiene: `FUNCTION_NAMES_BIND_TO_RAW` is a `Set`; ReactiveNode get-trap key
   checks avoid `String(prop)` allocation for symbols.

**Follow-ups identified by CPU profile, not done in this pass** (materialization
profile after fix: GC 37%, `registerCustomProxyMetadata` 14.6%,
`buildProxy` 11.5%, get trap 9.2%, `registerBaseProxy` 7.3%):

- The two per-node `WeakMap.set` registrations are ~22% of materialization.
  Eliminating them requires symbol-keyed metadata on raw nodes plus get-trap
  interception — feasible but touches `clone`/`prepareTree`/ownKeys semantics;
  design carefully before attempting.
- Handler-class refactor: `buildProxy` allocates 4 trap closures + helper
  closures per node; moving traps to a prototype with per-node state on the
  handler instance would cut most of the GC share. Large mechanical change.
- Reproxy read path still double-dispatches uncached object-valued reads.
- Array read-method fast paths and a `Map`-based children cache were evaluated
  and deferred: `for..of` index reads can't be intercepted by method wrappers,
  and the plain-record children cache stays in fast mode for the common
  (delete-free) case.
- Lazy reproxy-on-write (dirty flag) remains unimplemented.

## Recommended order

1. De-quadratic dependency tracking (side indexes + tombstones) — biggest algorithmic win, no semantic change.
2. Validation-before-recompute + field-scoped invalidation for tracked `select` and `@select` getters — turns "88 ms per write" into "µs per unrelated write."
3. Per-flush cache for `getReactiveNodeDependencies`.
4. Materialization constant factors (descriptor skip, redundant `isCustomProxy` threading, deferred constructor walk) + direct `prepareTree` materializer.
5. Public `Retree.peek` / `Retree.untracked` + docs guidance for query-heavy algorithms.
6. Array read-method fast paths; `Set` for `FUNCTION_NAMES_BIND_TO_RAW`; `Map` for `proxiedChildrenKey`.
7. Lazy reproxy on write (dirty flag).
8. Evaluate version-counter snapshots (`Retree.snapshot`) as the long-term architecture for algorithmic reads.
