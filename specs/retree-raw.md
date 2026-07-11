# Spec: Raw purity and `useRaw`

Status: **implemented** (2026-07-10), including resolved decision §9.1 (raw
change payloads). Measured results are recorded in §6; the purity invariant
is enforced by `packages/retree-core/src/raw-purity.spec.ts` and the `useRaw`
contract by `packages/retree-react/src/useRaw.spec.tsx`.
Supersedes the earlier `Retree.snapshot` draft in this file: there is **no
snapshot concept** in this design. `Retree.raw` is the one native-speed read
view, `useRaw` is its React hook, and the prerequisite making both honest is
**raw purity** — the guarantee that raw storage never contains proxies.

Context: `benchmarks/findings-jul-10-2026.md` (both passes). Measured claims
reference the probe in `packages/retree-core/src/perf-probe.spec.ts` and the
esbuild bundle harness described in the findings doc.

## 1. Problem

### 1.1 Wide reads pay trap dispatch

Components that read _wide_ during render (virtualized tables, canvas layers,
subtree serialization) pay a proxy trap per property read: a 10k-item scan
measures ~5.4 ms through proxies vs ~0.25 ms via `Retree.raw`. `raw` and
`peekInto` cover imperative/algorithmic reads; React rendering has no
equivalent — `useNode`/`useTree` reads are all trapped.

### 1.2 Raw storage is not actually pure today

`Retree.raw`'s promise is "plain data, native reads." Today that holds for
trees built from plain data and mutated in place, but four long-standing
write paths store **proxies inside raw storage** (verified on `a02ebd8`,
predating the 2026-07 perf passes):

| Path                                                                                                           | Raw storage holds a proxy?   |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `list.push({ plain })` / `obj.child = { plain }` (lazy path)                                                   | no                           |
| assigning an **already-managed node** (reparent), `Retree.move`                                                | **yes**                      |
| `map.get(k)` / Set iteration materializing an object **value**                                                 | **yes** (write-back on read) |
| assigning a **fresh non-plain value** post-construction (`Map`, `Set`, `Date`, class instance, `ReactiveNode`) | **yes**                      |

(Construction-time non-plain children stay raw; only the post-construction
set/defineProperty paths and collection read write-backs are impure.)

Consequences: `raw`/`peekInto` performance is probabilistic — consumers must
guess or check whether any given value is a proxy; `cloneValue` must unwrap
at every level; `findSetStoredValue` needs a linear scan; and
`structuredClone(Retree.raw(n))` can throw on a proxy value.

Why Map/Set differ from objects: the handler's children cache is a
`Record<string | symbol>` keyed by property names. Map keys are arbitrary
values and Set members are identity-keyed, so the original implementation
reused the raw collection itself as the proxy cache. A storage convenience,
not a semantic necessity — same for the eager set-trap branch writing built
proxies into targets.

## 2. Design principles

1. **Nodes are the currency; raw is the local read view.** Raw values are
   never the prop-passing medium between subscribed components. A component
   with behavior receives the node (read + write + navigate at any depth);
   raw is what a component reads _inside_ its own render or algorithm.
2. **One read concept, not two.** No snapshots, no clones, no frozen copies:
   `raw` is the live underlying data, read-only by contract. Developers grok
   exactly one thing: proxies are for writing and subscribing; raw is for
   reading fast. Point-in-time copies remain `Retree.clone`'s job — and with
   purity, `structuredClone(Retree.raw(n))` becomes a valid cheap alternative
   for workers/serialization.
3. **Purity is an invariant, not a caveat.** Proxies are reachable only
   _through_ proxies. `Retree.raw(node)` returns a subtree containing zero
   proxies, under every write path, guaranteed by tests. This is what makes
   the performance promise of `raw`/`peekInto`/`useRaw` unconditional.
4. **Invalidation stays explicit and narrow; freshness is per-render.**
   `useRaw` follows the same contract as `useNode`: subscription is
   `nodeChanged` by default — a component re-renders only when data it
   explicitly subscribed to changes, never because an irrelevant part of the
   tree moved. Raw content is live, so any render reads current state.
   Between renders, rendered output may be stale for undeclared deep data —
   the deliberate, explicit trade; `useSelect` / `@select` / `dependencies` /
   `useTree` are the tools for declaring deep invalidation.
5. **Zero migration.** `useNode`/`useTree`/`useSelect`/`Retree.raw`/
   `peekInto` keep their APIs. Raw purity is a storage-representation change
   with no public API change; `useRaw` is additive.

## 3. Priority 1: raw purity

### 3.1 Storage convention

Raw targets and raw collections hold **raw values only**. Proxies live
exclusively in handler-owned caches.

-   **Objects/arrays** (set trap and `defineProperty`): always write the raw
    node into the target (`getUnproxiedNode(valueToSet)`); store the proxy only
    in the children cache. The lazy plain path already does this; the reparent
    and eager (non-plain value) branches change.
-   **Map**: add a handler-owned side cache `Map<mapKey, childProxy>`.
    `getOrCreateMapValueProxy` consults/populates the side cache and **stops
    writing proxies back into the raw map**. Mutating wrappers (`set`,
    `delete`, `clear`) keep raw values in the raw map and maintain the side
    cache. Map keys are never proxied (unchanged).
-   **Set**: side cache `Map<rawValue, childProxy>`; the raw set holds raw
    values. `findSetStoredValue`'s linear scan collapses to
    unwrap-then-`Set.prototype.has`.
-   Side caches follow the children-cache lifecycle (lazy allocation, entries
    dropped on delete/clear/removal), mirroring `deleteProxiedChild`.

### 3.2 The invariant and its tests

After **any** sequence of: plain writes, reparenting assignments,
`Retree.move`, `Retree.link` targets, Map/Set reads and iteration, post-
construction assignment of `Map`/`Set`/`Date`/class/`ReactiveNode` values,
deletes, and `defineProperty` — walking `Retree.raw(root)` (including into
raw Maps/Sets) finds **zero** values with proxy metadata
(`getCustomProxyHandler(value) === undefined` for every reachable value).

Plus behavior-preservation tests: reads through proxies still return managed
children; reproxy identity semantics unchanged; `Retree.parent`/`move`/
`clone` unchanged; `structuredClone(Retree.raw(n))` succeeds on a tree
containing reparented children and read Maps.

### 3.3 Direct-target reader audit (known ripple points)

-   `deleteProperty` / change payloads: `previous` values for reparented/eager
    children become **raw nodes instead of proxies** in `INodeFieldChanges`,
    and `new` is unwrapped at capture. Approved contract per §9.1: payload
    values are consistently raw; payload docs updated.
-   `getLatestLinkedValue` / linked-key reads already normalize raw values via
    `getManagedProxyForUnproxiedNode` — unchanged.
-   `handleNodeRemoved` reads via the base proxy (cache hit) — unchanged.
-   `@retreejs/convex` `reconcile` and query-node internals: audited for
    direct-target reads that assume managed values.
-   `cloneValue`'s per-level unwrap becomes redundant but stays (cheap,
    defensive).

### 3.4 Performance gates

Purity must be ~free: one metadata read per reparent/eager write; side-cache
allocation only for collections with object values (replacing today's
write-back sets). Gates: existing probe suite and bundle harness within
noise; Map/Set-heavy specs unchanged; `findSetStoredValue` micro-case equal
or faster.

## 4. Priority 2: `useRaw` (`@retreejs/react`)

### 4.1 API

```ts
function useRaw<TNode extends TreeNode>(
    node: TNode | NodeFactory<TNode>,
    options?: { listenerType?: TRetreeChangedEvents }
): [TNode, ToManaged];

type ToManaged = <T extends TreeNode>(rawValue: T) => T | undefined;
```

-   Returns a **tuple** `[raw, toManaged]`.
-   `raw` is `Retree.raw(node)` — the live raw subtree, zero-copy, native
    reads, guaranteed proxy-free by §3. Read-only by contract (writes go
    through nodes; writing raw skips emission and is the documented
    corruption hazard).
-   **Default subscription is `"nodeChanged"`, exactly like `useNode`**
    (principle 4). `listenerType: "treeChanged"` is an explicit opt-in.
    Implementation mirrors `useNode`'s listener + state-bump (raw's stable
    identity cannot satisfy `useSyncExternalStore`'s changed-value contract,
    and doesn't need to).
-   **Freshness:** raw is live, so any render — own-node change, new node
    prop, unrelated parent re-render — reads current state. Between renders,
    undeclared deep data may be stale in rendered output; same contract as
    `useNode`. Tearing exposure under concurrent rendering is the same as
    `useNode` today (live reads during render).

### 4.2 `Retree.managed` and `toManaged`

```ts
static source<TNode extends TreeNode>(rawValue: TNode): TNode | undefined;
```

`Retree.managed` is **public API** (resolved): it resolves a raw value back to
its managed node — the latest managed proxy, the same resolution `peekInto`
uses for return values. O(1); returns `undefined` when the value has never
been materialized or is not Retree data (a miss is a normal query outcome,
not an error).

`toManaged` (from the hook) is `Retree.managed` plus a materialization
guarantee scoped to the subscribed node:

-   **Guarantee for the canonical pattern (resolved: applies to collections
    too):** direct children of the hook's subscribed node always resolve —
    object/array children, **Map values, and Set members** alike. On a lookup
    miss, the hook materializes the subscribed node's direct children once
    (memoized per version of the node) and retries — so mapping `raw`
    children and calling `toManaged` per item never returns `undefined` for
    them, even for never-touched children.
-   Deeper raw values resolve iff they have been materialized; in the intended
    composition they belong to child components' own hooks, which materialize
    them by receiving the node prop.

### 4.3 Canonical usage

```tsx
function TaskListView({ list }: { list: TaskList }) {
    // Re-renders only when the array itself changes: add / remove / reorder.
    const [tasksRaw, toManaged] = useRaw(list.tasks);
    return (
        <ul>
            {tasksRaw.map((rawTask) => (
                <TaskRow key={rawTask.id} task={toManaged(rawTask)!} />
            ))}
        </ul>
    );
}

const TaskRow = React.memo(function TaskRow({ task }: { task: Task }) {
    const t = useNode(task); // node prop: own subscription, write surface
    return <li onClick={() => (t.isComplete = !t.isComplete)}>{t.title}</li>;
});
```

Granularity: the list re-renders on structural changes only; rows re-render
on their own content via their own subscription; memo'd rows bail because
`toManaged` returns stable node references. A task's `isComplete` flip
re-renders that row and nothing else.

### 4.4 Opting in to deep invalidation

Deep changes _can_ invalidate a `useRaw` consumer — deliberately, with the
same tools as everywhere else in Retree, in preferred order:

1. **Declare it on the node (idiomatic).** A `ReactiveNode` owner with
   `dependencies` / `@select` emits `nodeChanged` _for itself_ when declared
   deep dependencies change — plain default `useRaw(node)` re-renders, no
   option needed. The invalidation contract lives on the node, visible to
   every consumer:

    ```ts
    class TaskList extends ReactiveNode {
        public tasks: Task[] = [];

        @select()
        get incompleteIds() {
            return this.tasks.filter((t) => !t.isComplete).map((t) => t.id);
        }

        get dependencies() {
            return [];
        }
    }
    ```

2. **Select the derived view.** `useSelect` for membership/order/aggregates;
   raw reads for the rows. Select decides _which_ nodes, raw decides _how to
   read_ them.
3. **`listenerType: "treeChanged"`** — the blunt instrument.

Deliberate consequence, documented loudly: filtering or aggregating raw
content inline under the `nodeChanged` default renders stale membership until
the node itself emits or the component re-renders for another reason. That is
explicit invalidation working as designed.

### 4.5 Convex reconciler integration (resolved)

`ConvexQueryNode.restoreState` invokes reconcilers as
`this.reconciler.reconcile(this.state, next)` — and because methods run with
`this` bound to the base proxy, `current` arrives as the **managed proxy**.
That is half-right by design: reconcilers _write_ in place through the proxy
(that is what emits `nodeChanged` on changed rows and keeps item identity
stable for `useNode` rows), but today they also _read_ through it — and
reconciliation is read-dominated (compare every field of every item; write
only the diffs).

Split the two:

1. **Built-in reconcilers read raw, write proxied** (`reconcileArray`,
   `reconcileObject`, `tryReconcileConvexDocuments`, and the id-map built
   from `item[idKey]`): comparisons run against `Retree.raw(current)` at
   native speed; assignments go through `current` so emission and identity
   semantics are untouched. Zero API change; covers the default path and
   `reconcileArrayById`/`reconcileConvexDocuments` users.
2. **Dev-provided reconcilers get raw handed to them** via a
   backward-compatible third parameter:

    ```ts
    interface IStateReconciler<TState> {
        reconcile(
            current: TState | undefined,
            next: TState,
            rawCurrent?: TState // Retree.raw(current); undefined on first load
        ): TState;
    }
    ```

    Existing two-parameter implementations keep working. The documented
    contract is "**read `rawCurrent`, write `current`**" — the write half
    cannot be hidden because in-place reconciliation _must_ go through the
    managed node to emit; handing devs only raw would trade a performance
    footgun for a correctness one.

### 4.6 What `useRaw` values are not for

-   **Not a prop currency between subscribed components** — pass nodes;
    `toManaged` closes the loop when mapping raw content.
-   **Not identity/memo tokens** — raw references are stable across changes by
    design. Use nodes (reproxy identity) for `React.memo` props, `useMemo`
    deps, and equality checks.
-   **Not for writes** — including in event handlers; use the node.
-   **Not derived-state lockstep** — that is `useSelect` / `@select`.
-   **Not point-in-time values** — raw mutates live. Holding across `await`,
    diffing before/after, or history requires a copy: `Retree.clone(node)` or
    (post-purity) `structuredClone(Retree.raw(node))`.

## 5. Testing plan

Core (purity):

-   §3.2 invariant walk across every impure path in the §1.2 table, plus
    combinations inside `runTransaction`/`runSilent`.
-   Behavior preservation: proxy reads return managed children after the
    storage change; Map/Set wrapper reads/iteration serve proxies from side
    caches; Set `has`/`delete` with proxy and raw arguments; change-payload
    `previous` documented shape.
-   `structuredClone(Retree.raw(root))` succeeds after reparents/moves/map
    reads.

React (`useRaw.spec.tsx`):

-   list/row granularity per §4.3: deep change does **not** re-render the
    list; structural change does; memo'd rows bail; row updates via own
    `useNode`.
-   deliberate deep invalidation (§4.4 mechanism 1): `ReactiveNode` owner with
    `@select` — deep dependency change re-renders the default-`nodeChanged`
    `useRaw` consumer; an undeclared deep change does not.
-   `toManaged` resolves never-materialized direct children (fresh tree, no
    prior traversal); stable node identity across re-renders.
-   freshness-on-render: after a deep change with no re-render, a
    parent-triggered re-render reads current raw data.

## 6. Performance gates (probe + bundle harness, medians)

| Measurement                                         | Gate                               | Measured (2026-07-10)                                                      |
| --------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Existing probe suite after purity change            | within noise                       | ✅ within noise (materialize/steady improved: Map/Set write-backs removed) |
| 20k scalar writes / 10k pushes                      | within noise                       | ✅ ~15.5 ms / ~14 ms (was ~16 / ~14)                                       |
| 10k-item scan via `Retree.raw` post-purity          | ≈ native (~0.25 ms), no proxy hits | ✅ 0.25 ms                                                                 |
| Wide-table render: `useRaw` vs `useNode` (200×40)   | faster                             | ✅ 1.1 ms vs 9.2 ms (~8×) — `useRaw.perf.spec.tsx`                         |
| `useRaw` mount, 2k-row list (`toManaged` every row) | ≤ `useNode` list equivalent        | ✅ 3.0 ms vs 3.0 ms (parity)                                               |

The wide-table measurement lives in
`packages/retree-react/src/useRaw.perf.spec.tsx` (loose sanity bounds so CI
never gates on machine speed); a benchmark-CLI scenario remains an optional
follow-up.

## 7. Implementation slices

1. Raw purity — objects/arrays (unwrap on set/defineProperty), invariant
   tests for those paths, probe gates.
2. Raw purity — Map/Set side caches, `findSetStoredValue` simplification,
   remaining invariant tests, Convex audit.
3. `Retree.managed` (public) + `useRaw`/`toManaged` with the direct-children
   guarantee (object/array/Map/Set), React tests, wide-table benchmark.
4. Convex reconcilers (§4.5): built-ins read raw / write proxied; add the
   backward-compatible `rawCurrent` third parameter to `IStateReconciler`;
   reconcile benchmark on a large document array.
5. Docs: `Retree.raw`/`peekInto` caveat paragraphs replaced by the purity
   guarantee; README section from §4.3/§4.4; reconciler docs updated to the
   "read `rawCurrent`, write `current`" contract.

## 8. Explicitly cut (from the superseded snapshot draft)

`Retree.snapshot`, `Snapshot<T>`, structural sharing, version counters and
bump walks, dev-mode freezing, fragment→node WeakMaps. Rationale: raw purity
delivers the same native-speed reads with zero copies and one concept;
point-in-time needs are served by `Retree.clone` / `structuredClone(raw)`.
If per-change value identity is ever needed (undo history, diffing), a
version/snapshot layer can be revisited on top of a pure raw substrate —
purity is a prerequisite for that design too, so no work here is wasted.

## 9. Resolved decisions

1. **Change payloads are consistently raw (approved).** Today
   `INodeFieldChanges.previous` is inconsistent — raw for lazily-proxied
   plain children, a proxy for reparented/eagerly-proxied children (it echoes
   whatever the raw target held) — and `new` echoes whatever the caller
   assigned. The approved contract: **both `previous` and `new` are raw
   values, always** (`previous` naturally post-purity; `new` unwrapped at
   capture when it is a managed proxy). Change records are descriptions of
   the past — data, not handles; listeners that want a live node opt in with
   `Retree.managed(change.previous)`. Rationale: this is the only option that
   yields a uniform contract (normalize-to-managed still returns raw for
   never-materialized values), it is free on the write path, it avoids
   handing listeners reproxy identities that churn by design, and it matches
   the doctrine everywhere else in this spec: nodes are handles, raw is data,
   records are data. Identity comparisons on payload values are raw-to-raw:
   `change.previous === Retree.raw(candidate)`.
2. `Retree.managed` is public (§4.2).
3. The `toManaged` materialize-on-miss guarantee covers Map values and Set
   members (§4.2).
4. Convex reconcilers read raw and write proxied, with a backward-compatible
   `rawCurrent` parameter for dev-provided reconcilers (§4.5).
