# Findings May 27, 2026 Tasks

This task plan turns [findings-may-27-2026.md](/Users/ryanbliss/Documents/Development-Personal/Libraries/Retree/benchmarks/findings-may-27-2026.md) into implementation phases. Phases are ordered by expected app impact, while keeping risky architectural changes behind benchmark coverage and compatibility tests.

## Phase 0: Benchmark Guardrails

Goal: make sure each optimization has a benchmark that can show whether it helped, hurt, or simply moved cost elsewhere.

-   [x] Add targeted benchmark cases for assigning fresh broad values:
    -   [x] Fresh `Set` with primitive values.
    -   [x] Fresh `Set` with object / `ReactiveNode` values.
    -   [x] Fresh `Map` with primitive values.
    -   [x] Fresh `Map` with object / `ReactiveNode` values.
    -   [x] Fresh array and plain object replacement.
-   [x] Split "new collection assignment setup/proxy cost" from listener emission timing in the JSON and Markdown output.
-   [x] Add a benchmark dimension or scenario for repeated `ReactiveNode.dependencies` updates where many dependents share the same dependency node.
-   [x] Add a benchmark that distinguishes:
    -   [x] many `useNode`-style listeners attached to one node,
    -   [x] many `ReactiveNode` dependency edges attached to one dependency node,
    -   [x] many distinct nodes each with one listener.
-   [x] Add regression assertions around current behavior for:
    -   [x] parent tracking after collection replacement,
    -   [x] `nodeRemoved` on replaced collection children,
    -   [x] `Retree.parent(...)` after map/set/array replacement,
    -   [x] reproxy identity changes after collection replacement.
-   [x] Split benchmark Markdown artifacts into concise and verbose reports:
    -   [x] Rename the current full-detail Markdown report to a verbose artifact, such as `retree-benchmark-latest.verbose.md`.
    -   [x] Generate a new concise Markdown report as the default `retree-benchmark-latest.md`.
    -   [x] Keep the concise report focused on the minimum information needed to infer trends without post-processing raw JSON.
    -   [x] Include scenario-level summaries, slowest cases, setup hotspots, mutation warnings, and major dimension trends in the concise report.
    -   [x] Exclude giant all-case tables from the concise report unless a section has very few rows.
    -   [x] Keep raw per-commit measures and full case detail in JSON and the verbose Markdown report.

Acceptance:

-   [x] Benchmark Markdown has a visible section for fresh collection/object assignment costs.
-   [x] Benchmark JSON captures setup/proxy time for those assignments separately from listener emission.
-   [x] Benchmark output includes concise `.md`, verbose `.verbose.md`, and raw `.json` artifacts.
-   [x] The concise Markdown report can be reviewed directly without writing a separate compaction script from raw JSON.
-   [x] `npm run test` and `npm run doctor` pass.

## Phase 1: Reactive Dependency Listener Sharing

Goal: prevent many `ReactiveNode`s that depend on the same node from registering duplicate Retree listeners that each scan the same dependent list.

-   [x] Add an internal dependency subscription registry keyed by unproxied dependency node.
-   [x] Store one Retree `nodeChanged` listener per dependency node, with a reference count for active dependent edges.
-   [x] Make reactive dependency cleanup decrement the shared subscription ref count and unsubscribe only when the last edge is removed.
-   [x] Avoid rebinding `handleReactiveDependentNodeChanged` for every dependency edge.
-   [x] Preserve current `ReactiveNode.dependencies` behavior:
    -   [x] fixed dependency length/order requirement,
    -   [x] comparison array behavior,
    -   [x] `onObserved` / `onUnobserved`,
    -   [x] `onChanged`,
    -   [x] transaction batching.
-   [x] Add tests proving many dependents on the same dependency node trigger one dependency listener fan-out, not repeated fan-out scans.
-   [x] Add tests proving dependency cleanup removes shared listeners after the final dependent unsubscribes.

Acceptance:

-   [x] Dependency fan-out benchmark improves for shared dependency nodes.
-   [x] Existing `ReactiveNode` tests pass without public API changes.
-   [x] New tests cover shared listener lifecycle and cleanup.

## Phase 2: Reactive Dependency Diffing

Goal: stop fully tearing down and rebuilding dependency subscriptions when the dependency nodes did not change.

-   [x] Read `proxiedDependentNode.dependencies` exactly once per `handleReactiveNode(...)` call.
-   [x] Diff current dependencies against previous active dependencies by index.
-   [x] Reuse existing subscriptions when the dependency node is unchanged.
-   [x] Update stored comparison values without resubscribing when only comparisons changed.
-   [x] Unsubscribe removed/replaced dependencies only when the dependency node actually changes.
-   [x] Keep distinct errors for:
    -   [x] changed dependency length,
    -   [x] missing unproxied previous dependency node,
    -   [x] missing unproxied current dependency node,
    -   [x] inconsistent comparison length/order.
-   [x] Add tests for stable dependencies that update comparisons repeatedly without resubscription.
-   [x] Add tests for dependency node replacement that correctly unsubscribes the old node and subscribes the new node.

Acceptance:

-   [x] Dependency update benchmark improves when dependency nodes stay stable.
-   [x] Dependency fan-out benchmark remains correct after Phase 1.
-   [x] `ReactiveNode.dependencies` getter read count is reduced in tests.

## Phase 3: Lazy Proxying for Plain Objects and Arrays

Goal: reduce initial `Retree.root(...)` cost and fresh object/array assignment cost without changing public semantics.

-   [ ] Change `buildProxy(...)` so plain object and array children are proxied lazily on first access instead of recursively during root creation.
-   [ ] Preserve parent metadata when a lazy child proxy is created.
-   [ ] Preserve current behavior for:
    -   [ ] `Retree.parent(child)`,
    -   [ ] `nodeChanged`,
    -   [ ] `nodeRemoved`,
    -   [ ] reproxy identity,
    -   [ ] ignored `ReactiveNode` fields,
    -   [ ] non-configurable / non-writable descriptors.
-   [ ] Ensure assigning a fresh object/array stores enough metadata to proxy lazily while still emitting the correct change for the parent node.
-   [ ] Add tests for nested object and array access after lazy proxying.
-   [ ] Add tests for replacing an object/array and then mutating a nested child.
-   [ ] Add tests for removing a lazily proxied child and verifying `nodeRemoved` / parent cleanup.
-   [ ] Run benchmark comparison for:
    -   [ ] root setup,
    -   [ ] fresh object assignment,
    -   [ ] fresh array assignment,
    -   [ ] direct node mutation,
    -   [ ] `ReactiveNode.dependencies`.

Acceptance:

-   [ ] Root setup and fresh object/array assignment benchmarks improve.
-   [ ] Existing proxy/reproxy tests pass.
-   [ ] No change to public API.

## Phase 4: Collection Proxying Strategy for Map and Set

Goal: address expensive fresh `Map` / `Set` assignment and root setup while preserving collection identity semantics.

-   [ ] Design Map lazy value proxying:
    -   [ ] `get`,
    -   [ ] `set`,
    -   [ ] `delete`,
    -   [ ] `clear`,
    -   [ ] `entries`,
    -   [ ] `values`,
    -   [ ] `forEach`,
    -   [ ] iteration.
-   [ ] Design Set lazy value proxying carefully because Set values are also keys.
-   [ ] Decide whether Set object values should:
    -   [ ] stay raw until read,
    -   [ ] be proxied on iteration only,
    -   [ ] maintain raw-to-proxy and proxy-to-raw lookup maps,
    -   [ ] or remain eager for correctness until a safer design is proven.
-   [ ] Add behavior tests for Map and Set identity:
    -   [ ] `has(rawValue)`,
    -   [ ] `has(proxyValue)`,
    -   [ ] `delete(rawValue)`,
    -   [ ] `delete(proxyValue)`,
    -   [ ] iteration values,
    -   [ ] `Retree.parent(value)`.
-   [ ] Add tests for replacing broad `Set` / `Map` values and then mutating values inside them.
-   [ ] Implement Map laziness first if Set identity semantics need more design time.
-   [ ] Implement Set laziness only if identity behavior can remain intuitive and backward-compatible.

Acceptance:

-   [ ] Fresh Map assignment benchmark improves.
-   [ ] Fresh Set assignment benchmark improves or the doc records why Set must remain eager for now.
-   [ ] Map/Set tests prove collection lookup semantics did not regress.

## Phase 5: Skip treeChanged Work When Unused

Goal: remove unnecessary ancestor walking from pure `nodeChanged` / `useNode` workloads.

-   [ ] Short-circuit `handleNotifyTreeChanged(...)` when there are no active `treeChanged` listeners.
-   [ ] Ensure `nodeChanged`, `nodeRemoved`, and `ReactiveNode.onChanged` still run exactly as before.
-   [ ] Add tests showing a deep child mutation does not call parent traversal logic when no `treeChanged` listeners exist.
-   [ ] Add tests showing `treeChanged` behavior remains unchanged when listeners do exist.

Acceptance:

-   [ ] Direct `nodeChanged` and `useNode`-style benchmarks improve or remain flat.
-   [ ] `treeChanged` benchmarks remain behaviorally correct.

## Phase 6: React useNode Subscription Hub

Goal: reduce Retree-level duplicate listener registration when many React components subscribe to the same node.

-   [ ] Add an internal React subscription hub keyed by base proxy and listener type.
-   [ ] Register one Retree listener for each `(baseProxy, listenerType)` pair.
-   [ ] Fan out from the hub to React subscribers.
-   [ ] Use `useSyncExternalStore` or equivalent semantics if needed for concurrent React correctness.
-   [ ] Preserve `useNode` and `useTree` public APIs.
-   [ ] Add tests for:
    -   [ ] multiple components subscribing to the same node,
    -   [ ] cleanup when some subscribers unmount,
    -   [ ] cleanup when the final subscriber unmounts,
    -   [ ] no stale updates after unmount,
    -   [ ] Strict Mode behavior.

Acceptance:

-   [ ] Listener fan-out benchmark or a new React-specific benchmark shows fewer Retree listener registrations.
-   [ ] Existing React tests pass.
-   [ ] No public API change.

## Phase 7: Retree.select and useSelect

Goal: provide a narrower subscription primitive for derived values without requiring a custom `ReactiveNode` dependency edge.

-   [ ] Design core API:
    -   [ ] `Retree.select(node, selector, callback, options?)`.
    -   [ ] Accept any Retree-managed node, not only roots.
    -   [ ] Default equality: `Object.is`.
    -   [ ] Optional custom `equals(previous, next)`.
    -   [ ] Return unsubscribe function.
-   [ ] Decide dependency tracking model:
    -   [ ] explicit dependency declaration,
    -   [ ] automatic tracking via proxy reads,
    -   [ ] initial implementation using `nodeChanged` on the selected node only,
    -   [ ] or a staged combination.
-   [ ] Add React API:
    -   [ ] `useSelect(node, selector, options?)`.
    -   [ ] Return the selected value.
    -   [ ] Integrate with React subscription semantics.
-   [ ] Document how `select` differs from `memo`, `fnMemo`, and `ReactiveNode.dependencies`.
-   [ ] Add tests for:
    -   [ ] selecting from root,
    -   [ ] selecting from child node,
    -   [ ] custom equality,
    -   [ ] unsubscribe,
    -   [ ] React `useSelect` re-render behavior.

Acceptance:

-   [ ] Users can subscribe to derived values from any Retree node.
-   [ ] `useSelect` offers `useNode`-like ergonomics for derived values.
-   [ ] Documentation clearly positions `select` as a complement to memoization.

## Phase 8: Transaction and Mutation Bookkeeping Follow-Up

Goal: revisit transaction and collection mutation overhead after the larger architecture fixes land.

-   [ ] Re-run stable and exhaustive benchmarks after Phases 1-7.
-   [ ] Inspect whether `runTransaction` still scales poorly with large mutation counts.
-   [ ] Profile array and map mutation paths after lazy proxying changes.
-   [ ] Consider batching reproxy updates inside `runTransaction` more aggressively if benchmarks still show a problem.
-   [ ] Add targeted tests before changing transaction flush behavior.

Acceptance:

-   [ ] Remaining transaction/mutation bottlenecks are either addressed or documented as inherent work.
-   [ ] Any transaction changes preserve listener emission counts and ordering.

## Phase 9: Documentation and Migration Guidance

Goal: make the performance model clear to users.

-   [ ] Update docs with guidance for:
    -   [ ] avoiding `treeChanged` in hot paths,
    -   [ ] using `useNode` on narrow child nodes,
    -   [ ] using `ReactiveNode.dependencies` responsibly,
    -   [ ] using `useSelect` for derived values,
    -   [ ] avoiding repeated construction/proxying during React render.
-   [ ] Add a performance guide section explaining:
    -   [ ] initial proxy cost,
    -   [ ] collection assignment cost,
    -   [ ] dependency fan-out,
    -   [ ] listener fan-out,
    -   [ ] when `runTransaction` helps.
-   [ ] Include before/after benchmark summaries from the completed phases.

Acceptance:

-   [ ] README and package docs reflect the new architecture and APIs.
-   [ ] Benchmark results are linked or summarized in human-readable guidance.

## Suggested Approval Boundaries

Approve and implement one phase at a time. Phase 0 should be done first unless we intentionally accept weaker before/after measurement. After Phase 0, the highest expected app impact is:

1. Phase 1: Reactive dependency listener sharing.
2. Phase 2: Reactive dependency diffing.
3. Phase 3: Lazy proxying for plain objects and arrays.
4. Phase 4: Collection proxying strategy for Map and Set.

Phases 5-9 are still useful, but they should follow once the dependency and proxy construction costs are under control.
