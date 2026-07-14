# Spec: July 2026 full-repo audit — findings and remediation plan

Status: **reviewed — decisions resolved** (2026-07-14). Nothing here is
implemented yet; the open decisions were resolved in review (see §8, Resolved
decisions). Findings marked **(verified)** were reproduced directly (probes
or direct inspection) during the audit; the rest were confirmed against the
cited source locations.

Scope: all packages (`core`, `react`, `convex`, `react-convex`, `create`),
docs/website/samples, release tooling, plus competitive research on the
mid-2026 state-management landscape. Builds on
`benchmarks/findings-jul-10-2026.md` and `specs/retree-raw.md`; nothing
already fixed there is repeated.

---

## 1. Verified bugs (silent-corruption class; fix first)

### B1. Double-unsubscribe removes a *different* listener (verified)

`packages/retree-core/src/Retree.ts:1026` — `buildUnsubscribeCallback` does
`findIndex` then `splice(findIndex, 1)` with no `-1` guard. Calling an
unsubscribe twice (routine in React cleanup / StrictMode) makes
`splice(-1, 1)` remove the **last** listener in the array — someone else's
subscription silently dies. Repro: subscribe A and B, call A's unsubscribe
twice → B never fires again.

Cascades into the React layer: `subscriptionHub.ts:60-70`'s unsubscribe is
also non-idempotent (a second call re-invokes `hub.unsubscribeRetree()` and
deletes map entries a new hub may rely on), and the hub stores listeners in a
`Set`, so the same callback subscribed twice collapses to one entry and the
first unsubscribe kills both.

**Plan:** guard `findIndex !== -1` (the correct pattern already exists in
`TypedEventEmitter.ts:428-430`); make unsubscribe closures idempotent via a
done-flag; ref-count hub listeners. Tests for each.

### B2. Nested `runSilent` loses silence (verified)

`Retree.ts:883-893` sets `Transactions.skipEmit`/`skipReproxy` and the
`finally` restores them to `false` unconditionally. An inner `runSilent`
ending re-enables emission for the rest of the outer body — any helper that
itself uses `runSilent` breaks its callers.

**Plan:** save/restore previous values (the correct pattern exists in
`runWithoutEmitting`, `Retree.ts:1871-1882`) or use a depth counter. Define
and test `runSilent` × `runTransaction` interleaving while there.

### B3. Convex optimistic rollback restores a stale baseline, losing confirmed server data

`packages/retree-convex/src/ConvexQueryNode.ts:486-501` captures
`optimisticRollbackState` once, when the dirty window *opens*. If mutation
A's server confirmation advances `lastEmittedState` while mutation B is still
pending, and B then rejects, the catch handler restores the pre-A snapshot —
wiping A's confirmed change from the UI, which stays wrong until the next
unrelated server emission.

**Plan:** roll back to `cloneState(this.lastEmittedState)` at rejection time,
or refresh the rollback baseline whenever `lastEmittedState` advances inside
a dirty window. Spec test: "older mutation confirmed mid-window, then newest
fails."

### B4. Convex `cloneState`/`stateEquals` use JSON round-trips — throws on bigint, corrupts bytes

`ConvexQueryNode.ts:471-484, 525-530`. Convex values legitimately include
`bigint` (Int64: `JSON.stringify` **throws**) and `ArrayBuffer` (serializes
to `{}`). Any query returning an Int64 field makes every emission throw. Also
O(full result) serialize+parse per emission even with no optimistic activity,
and `stateEquals` is key-order-sensitive.

**Plan:** `structuredClone` + a short-circuiting deep-equal; capture the
rollback baseline lazily only when an optimistic window opens.

### B5. Spurious emissions: delete-of-missing-key and NaN writes (verified)

- `delete node.missing` emits `nodeChanged` — `proxy.ts:706-761` never checks
  the property existed.
- `node.v = NaN` when already `NaN` emits every time — `proxy.ts:502` uses
  `!==`; the Date wrapper already uses `Object.is` (`proxy.ts:1661`).

Each spurious emission is a render. **Plan:** `Reflect.has` check in
`deleteProperty`; `Object.is` in `set`.

### B6. `clearListeners(node, false)` misses descendants inside Map/Set (verified)

`Retree.ts:998` — `clearDescendantListeners` iterates `Object.values(node)`,
which is `[]` for Map/Set. Deep clear leaves listeners on nodes stored in a
Map fully live. **Plan:** branch on Map/Set and iterate `values()` (pattern
exists in `prepareObject`, `ReactiveNode.ts:768-779`).

### B7. Duplicate `_id`s alias one managed object into multiple array slots

`retree-convex/src/internals/reconcile.ts:67-100` — `currentById` collapses
duplicates; if the server result contains the same `_id` twice (unions/joins
can produce this), both slots receive the same managed object: one node at
two tree paths, edits to one row mutate both.

Realism/overhead (resolved in review): Convex `_id`s are unique per document,
so a plain `.collect()` can never produce duplicates — this only occurs when
a user-authored query function constructs a result containing the same doc
twice (manual joins, concatenated overlapping queries). Rare, but the fix is
free: the reconciler already does a `currentById.get(id)` per row; **plan:**
add `currentById.delete(id)` after each match (O(1), no extra pass, no
validation scan) so a second occurrence falls through to the existing insert
path instead of aliasing one managed node into two slots. No throw.

---

## 2. Performance

### P1. `@select` getter dependency collection is still O(N²) — measured 4.1 s per scalar write at 2,000 items (verified)

The July 10 pass de-quadraticized tracked `Retree.select`/`useSelect` but
**missed the ReactiveNode `@select` getter path**. `Retree.ts:1795-1797` in
`getReactiveSelectDependencies`:

```ts
const laterComparisons = getDependencyComparisonValues(
    selectedDependencies.slice(dependencyIndex + 1)
);
```

Per dependency index this slices the suffix and re-normalizes every entry →
O(N²). Runs inside `getReactiveNodeDependencies`, which executes on every
`nodeChanged` of the ReactiveNode, once per dependent group on every write to
any dependency node, and on every subscribe.

Measured (auto-trapped `@select` getter scanning N items, one unrelated
scalar write to one item): 250 items → 36 ms, 500 → 133 ms, 1000 → 605 ms,
**2000 → 4,150 ms**. The documented flagship `@select` pattern is unusable
past ~100 items.

**Plan:** build suffix comparison values in one right-to-left pass (shared
flattened array + per-index offsets), and/or port the tracked-select
validation gate (`canSkipTrackedDependencyChange`, `select.ts:485`) to
`@select` getters so unrelated writes skip collection entirely. Add a
perf-probe regression test.

### P2. Array mutating methods emit and reproxy per element (verified)

`splice(0, 1)` on a 10-element array emits **11** `nodeChanged` events;
`unshift` likewise. Each allocates a `ReproxyHandler` + `Proxy`, does an
O(depth) snapshot-version ancestor walk, and dispatches through the emitter.
One splice on a 1,000-item list ≈ 1,000 full write pipelines **even inside
`runTransaction`** (transactions batch listener emission, not
reproxy/version/emitter work — `proxy.ts:558` only checks `skipReproxy`).
Map and Set mutations are already wrapped to emit exactly once
(`wrapMapMutation`/`wrapSetMutation`, `proxy.ts:1277/1509`); arrays are the
gap — and the busiest collection type.

**Plan:** intercept `push/pop/shift/unshift/splice/sort/reverse/fill/copyWithin`
in the base get trap like Map/Set: run the native op against the raw target
with children-cache maintenance, emit one `nodeChanged` with one coherent
change record. Also fixes payload noise (a splice currently reports every
shifted index as a separate field change), which poisons key-scoped select
validation and any future undo log.

### P3. `useSelect` runs the user selector at least twice per render; with-selector memoization reset every render

`packages/retree-react/src/useSelect.ts:391` runs `getNodeSelection` during
render just to derive `sources`; lines 397-401 pass a freshly created
selector closure and inline `isEqual` to `useSyncExternalStoreWithSelector`,
whose memo is keyed on those identities — so it's discarded every render and
the selector re-runs on **every render including unrelated parent
re-renders**. Same shape in `useTrackedSelect` (lines 412, 419-426), where
each run also pays full dependency-tracking proxy overhead.

Related fragility: the equality callbacks mutate `next` to smuggle reference
stabilization through the shim (`useSelect.ts:222-224, 240, 253-254`) —
undocumented shim internals; a shim version bump breaks reference stability
silently.

**Plan:** own a small custom selection-memoization layer over
`useSyncExternalStore` (stable per-instance selector/isEqual wrappers via
refs reading the latest user closure; derive `sources` from the selection
result). Fixes both the re-run cost and the shim dependence.

### P4. One `treeChanged` listener anywhere makes every write in every tree walk its full ancestor chain

`Retree.ts:1334` — `this.treeChangedListeners.size > 0` is a *global* gate;
after it passes, `handleNotifyTreeChanged` walks the changed node's entire
ancestor path (allocating a Map + arrays per write, `Retree.ts:1114-1118`)
even when no ancestor is listening. One `useTree` on a sidebar taxes every
write in the app by O(depth). **Plan:** per-root or per-path listener counts
maintained at subscribe time so unrelated writes skip the walk.

### P5. Per-write O(depth) snapshot-version walk with per-level allocation

`snapshot-version.ts:63-95` — every reproxying write walks every ancestor
doing WeakMap get+set and allocating a `{node, tree}` record per level, even
with zero subscribers. **Plan:** mutate the version record in place, store it
on the handler, gate the walk on external-store subscriptions existing.

### P6. Convex `reconcileObject` is shallow — nested docs re-render every row on every emission

`reconcile.ts:148-167` compares `raw[key] !== value` by reference; server
emissions always produce fresh nested objects, so any doc with an
object/array field gets a write (→ row re-render) on every emission even when
deep-equal. Defeats the identity-stability pitch exactly where it matters
(large live lists). The reconcile specs only test flat docs. **Plan:** recurse
into plain objects/arrays in `reconcileObject` (or deep-equal before
writing); add nested-doc reconcile specs.

### P7. Paginated query node: no reconciliation, no optimistic updates

`ConvexPaginatedQueryNode.ts:252-258` assigns `this.state = result` wholesale
— every loaded row loses identity whenever any page updates or `loadMore`
lands. No `optimisticUpdate` on the paginated node at all. **Plan:** reconcile
`state.results` by `_id` (reuse `tryReconcileConvexDocuments`); port — or
better, extract (§6.2) — the optimistic machinery.

### P8. Smaller constant costs

- Listener registries are strong `Map`s keyed by raw nodes
  (`Retree.ts:164-169`) — forgotten unsubscribes pin nodes+subtrees+closures
  forever; the maps are never iterated, so `WeakMap` + a live-listener
  counter for the `stopListening` gate works. Optionally auto-clear a node's
  listeners on `nodeRemoved`.
- Children cache is a prototype-ful plain record (`proxy.ts:899`) —
  `Object.create(null)`, then delete the reproxy `constructor` special-case
  (`reproxy.ts:231`).
- `getSnapshot` allocates a fresh array per call (`externalStore.ts:125`).
- Every getter read on any ReactiveNode pays `pushMemoGetter`/`popMemoGetter`
  frames (`proxy.ts:395-400`) even for classes that never use keyless memo —
  candidate for a per-prototype fast path after P1 lands.
- `useNodeInternalCore` builds per-hook source objects while
  `useRaw`/`useSelect` use the shared `getRetreeExternalStoreSource` cache —
  unify on the cache.

---

## 3. Packaging & release (first-hour blockers)

### R1. Published packages fail to load in plain Node (verified)

`import()` of `packages/retree-core/bin/index.js` fails:
`Cannot find module '.../bin/Retree'`. tsc emits ESM with extensionless
relative imports; no `"type": "module"`, no CJS fallback, single-condition
`exports`. Breaks Node scripts, Jest/Vitest node resolution,
`serverExternalPackages`, unbundled SSR — the worst first-five-minutes
failure, with an unhelpful error.

**Plan (resolved: ESM-only).** Ship ESM-only: `"type": "module"`, extensioned
relative imports (or a bundled single-file output), proper `exports`
conditions with `types`, and gate releases on `publint` +
`@arethetypeswrong/cli`. No CJS build — dual publishing invites the exact
compatibility headaches review flagged, and the CJS-consumer story is covered
anyway: Node ≥ 20.17 / 22.12 supports `require(esm)` natively, and all
bundlers consume ESM. What we knowingly give up: legacy Jest configs without
ESM support and very old Node — acceptable; document in the compatibility
matrix (§7).

### R2. Exact-pinned peerDependencies (verified; resolved: keep the pins)

`@retreejs/react` and `@retreejs/convex` pin `"@retreejs/core": "0.6.0"`
exactly. **Resolved in review: exact pins are deliberate and stay** —
lockstep family upgrades prevent mismatched-version bugs, which in practice
cause more support pain than range flexibility saves. The audit's real risk
is therefore the *half-published family*: `publish-packages.mjs` publishes
sequentially and can stop mid-family, and with exact pins a partial publish
leaves npm in an unresolvable state. **Plan:** make the publish atomic —
verify all tarballs/pins locally, then publish all packages in one CI job
with failure handling (retry/deprecate-and-republish guidance), and have the
release script assert every intra-family pin matches the release version
before anything is pushed.

### R3. `"use client"` missing on every hook file except `useRoot.ts` (verified)

`useNode.ts`, `useSelect.ts`, `useRaw.ts` (and the internals) carry only
`"use no memo"`. Importing them in a Next.js server component fails deep
inside `use-sync-external-store` instead of at the module boundary with a
clear error. tsc preserves directives (verified in `bin/useRoot.js`).
**Plan:** add `"use client"` to every file exporting a hook.

### R4. No CI, no changelog, stale tags, manual release

`.github/workflows/` has only `docs.yml`. No test/typecheck workflow, no
CONTRIBUTING.md, no CHANGELOG.md; git tags stop at 0.1.3 while packages are
0.6.0; `scripts/publish-packages.mjs` publishes sequentially from a local
`.env` token (can half-publish the family, which R2 makes fatal).
**Plan:** `ci.yml` running typecheck+test+doctor on PRs (React 18/19 matrix);
adopt Changesets (changelog + version sync + tags + GitHub Releases); publish
from CI with `--provenance`; CONTRIBUTING.md pointing at existing scripts and
`specs/`.

### R5. Samples and website playgrounds pin 0.4.x while the library is 0.6.0

Samples 01–03 pin `@retreejs/*@0.4.16`; the website Sandpack template pins
`0.4.17`; `app/why/page.tsx` says "Retree is v0.6.x". Flagship 0.5/0.6
features (`useRaw`, `useSelect` inference, `@select` trapping, raw purity)
can't resolve in the samples. **Plan:** workspace links (like sample 04) or
release-script bumps + a grep check for hardcoded versions in `samples/`,
`website/`, `AUTHORING.md`.

### R6. Decorators: optional in fact, but the docs never say so — positioning + conflict detection

**Confirmed during audit review: decorators are opt-in.** Specifics:

- The published packages ship compiled JS; no consumer toolchain support is
  needed to *use* Retree. `Retree.root`, all hooks, `ReactiveNode` with the
  `dependencies` getter, `this.memo(...)`/`this.dependency(...)`, and
  `Retree.link(...)` all work with zero decorator config.
- Decorator support is only needed when a consumer **authors**
  `@memo`/`@fnMemo`/`@select`/`@ignore`/`@link` in their own classes. On
  TypeScript 5+ with `experimentalDecorators` **absent**, standard (2023-11)
  decorators compile out of the box — no config at all. The two real failure
  modes: (a) `experimentalDecorators: true` in the consumer's tsconfig
  (legacy semantics), (b) Babel-transformed toolchains without
  `@babel/plugin-proposal-decorators` `{ version: "2023-11" }`.
- **The runtime guard already exists** (audit originally proposed adding it):
  every decorator checks `isLegacyDecoratorPropertyKey(context)` and throws a
  pinpoint error naming the decorator, the cause, and both fixes
  (`decorators.ts:58, 112, 192, 235`, …). Failure mode (a) is therefore
  already loud and self-diagnosing at runtime; (b) fails at build time with
  the toolchain's own error.

Remaining plan (docs + installer, no runtime work):

1. **Docs positioning.** Every npm-facing surface (root README, package
   READMEs, `llms.txt`, `skills/retree/SKILL.md`) gets a short "Decorators
   are optional" note: zero setup to use Retree; authoring decorators needs
   TS 5+ standard decorators (i.e. just don't set `experimentalDecorators`)
   or the Babel plugin in `2023-11` mode; link to
   retree.dev/docs/setup-and-decorators. Each decorator's docs name its
   non-decorator equivalent (`this.memo(...)` for `@memo`/`@fnMemo`, the
   `dependencies` getter + `this.dependency(...)` for `@select`,
   `Retree.link(...)` for `@link`) so readers know the escape hatch exists.
2. **Installer conflict detection, framed as optional-feature setup.**
   `@retreejs/create` reads the target `tsconfig.json` and babel config; it
   does **not** require decorator setup, but when it detects
   `experimentalDecorators: true`, TS < 5, or a Babel config without the
   plugin, it prints a note: "Retree works without decorators; to use
   `@memo`/`@select`/`@ignore`/`@link`, make this change." Optionally offer
   the tsconfig fix interactively.
3. **Website `setup-and-decorators` page** — verified: it already leads with
   "Decorators are **opt-in**" and correct TS/Babel guidance. No change
   needed; the READMEs/llms.txt/SKILL.md notes in item 1 should link to it
   and mirror its framing.

### R7. Installer (`@retreejs/create`) — remaining gaps

- **Non-TTY is a hard error with no flags** (`cli.ts:48-55`) — no
  `--react/--convex/--skill/--yes`. The marquee checkbox installs an AI skill
  for coding agents, who are exactly the non-TTY callers. Add
  non-interactive flags.
- **Monorepo detection misses workspace roots** (`detect.ts:90-108`):
  lockfiles only checked in `cwd`; `hasDependency` ignores
  peerDeps/workspace-root deps. Walk up to the git/workspace root for
  lockfiles; check `peerDependencies`; use
  `require.resolve("react/package.json", { paths: [cwd] })` as ground truth.
- **Skill install hardcodes `npx`** (`plan.ts:30-33`) — use
  `pnpm dlx`/`bunx`/`yarn dlx` per detected manager; consider pinning the
  `skills` CLI version.
- Distinguish "packages installed, only the skill failed" in the exit path
  (`cli.ts:113-119`).

### R8. Metadata nits

`retree-react/package.json` `repository.directory` says
`packages/retree-core`; `homepage` on all packages points to studiobliss.io
instead of retree.dev. `react-dom` is a hard peer of retree-react but nothing
imports it (blocks React Native / react-three-fiber). `bin/` as build output
dir is unconventional (`dist/`; rename before 1.0). "lighting-fast" typo in
website H1 + metadata title (`website/app/page.tsx:32,407`). No OG image
despite `twitter.card: summary_large_image`. `/compare` index is a stub.
Verify `sideEffects: ["./bin/Retree.js"]` is truly needed.

---

## 4. Correctness & semantics (beyond §1)

- **C1. Multi-node transactions batch into one render only on React 18+** —
  `transactions.ts:93-104` emits once per changed node; React 16/17 (which
  the peer range claims) gets N renders. **Resolved: keep 16/17 support** —
  wrap the flush in `unstable_batchedUpdates` when available.
  Also document that uSES store updates inside `startTransition` de-opt to
  sync renders (the JSDoc suggestion at `Retree.ts:900` doesn't help).
- **C2. Dependency tracking misses `in`, `Object.keys`, and iteration-shape
  reads** — only get/set feed tracking; record-of-entities state
  (`{ [id]: entity }`) never invalidates on key add/remove (arrays are saved
  only because `length` is a get). MobX/Valtio trap `has`/`ownKeys`. Add a
  keys pseudo-dependency invalidated by set-of-new-key/deleteProperty.
- **C3. `useSelect` overload dispatch is a latent hook-order violation**
  (`useSelect.ts:360-378`) — node form vs selector form have different hook
  counts; a call site flipping between them throws a confusing React error.
  Dev-mode ref + precise Retree error ("useSelect switched between
  selector-only and node form").
- **C4. NodeFactory inline-lambda footgun** — `useMemo(() => getNode(node),
  [node])` re-runs on every prop identity change;
  `useNode(() => Retree.root({...}))` silently resets state every render.
  Dev-mode detection (resolved base proxy differs repeatedly for the same
  hook) + docs.
- **C5. `runSilent(fn, true)` vs `(fn, false)` differ on whether `onChanged`
  and dependency refresh run** (`proxy.ts:558` vs `Retree.ts:1343-1345`) —
  should be one documented decision, not an accident of the reproxy flag.
- **C6. Change records carry no node identity** (`types.ts:40-44`);
  ReactiveNode dependents receive foreign records (`Retree.ts:2008-2013`) —
  `select.ts:497-500` must exclude ReactiveNodes from key-scoping because of
  this. Adding the source raw node (+ ideally a path segment) to records is
  also the enabling primitive for undo/redo (§6.1).
- **C7. Convex query nodes: no self-cleanup** — `ConvexQueryNode`/
  `ConvexPaginatedQueryNode` have no `onUnobserved`; standalone usage (shown
  in the class doc example, `ConvexQueryNode.ts:126-130`) leaks a live
  websocket query forever after the last unmount. `ConvexConnectionStateNode`
  already self-cleans (`ConvexConnectionStateNode.ts:70-72`). Add
  `onUnobserved() { this.dispose(); }` with resubscribe-on-reobserve (which
  already works), and drop parent-driven disposal.
- **C8. Convex misc:** `dispose()` not sticky — any `onChanged` resurrects
  the subscription (`ConvexQueryNode.ts:157-159, 451-459`); shallow arg
  comparison causes resubscribe churn + pending flash for object args
  (Convex's own `useQuery` compares structurally); `updateArgs` drops data
  with no `keepPreviousData` option; error state clobbered to "pending" on
  `updateArgs` when the new watch's cached value is an error
  (`retree-react-convex/src/index.ts:139-146` + `ConvexQueryNode.ts:222-239`);
  no `retry()` affordance after `status: "error"`; `transform.apply` runs
  outside a transaction (`ConvexQueryNode.ts:297-299`); `liveChildren` only
  grows (`ConvexNode.ts:196-201`); dev-mode warning when `optimisticUpdate`
  no-ops because state is undefined; Map object keys stringify to
  `"[object Object]"` in change payloads (`proxy.ts:80-86`).
- **C9. Ref writes during render** (`externalStore.ts:158-164`,
  `useRaw.ts:109-110`) — rules-of-React violation; consequence is only an
  extra resubscribe after a discarded concurrent render, but clean up.
  Related: `toManaged`'s materialize-on-miss behaves differently inside vs
  outside render (`useRaw.ts:112-126`) — key retries on version, not render.
- **C10. Test coverage gaps:** every verified bug in §1 lacks a test; no
  `Set.spec.ts` (Map has 519 lines); `transactions.spec` has no
  exception-mid-transaction, nested-transaction, or
  runSilent-inside-runTransaction cases; sample 04 has zero tests and no
  `status === "error"` branch.
- **Low/polish:** dead unreachable throw in `clone` (`Retree.ts:1537-1543`);
  `clone` mangles RegExp/typed arrays/ArrayBuffer — support or throw a
  pinpointed error; `TreeNode<T extends object = object> = T` is an identity
  alias adding zero checking; missing dev warnings (writes during tracked
  selectors, mutating `Retree.raw` results, `nodeChanged` select reading
  descendants).

---

## 5. Competitive positioning (mid-2026 landscape)

Market facts (State of React 2025 + ecosystem research; sources in §8):

- Zustand is the default (~22.6M weekly downloads); the standard stack is
  "TanStack Query for server state + tiny client store." Top pain points
  industry-wide: complexity (20%) and boilerplate (15%) — not raw perf.
- **React Compiler went stable (Oct 2025)** and breaks observer-HOC tracking
  (MobX, Preact Signals transform). `useSyncExternalStore`-based libraries
  are the safe path — Retree already is one, but nobody knows.
- MobX/MST is the aging incumbent for rich object graphs and is actively
  bleeding compiler-worried users; Valtio is compiler-safe but shallow on
  classes/transactions/sync; the sync-engine newcomers (TanStack DB, Zero,
  LiveStore, Legend State v3) abandoned the mutable-object-graph model
  entirely. **Retree sits exactly in the gap.**
- TC39 signals: still Stage 1; React explicitly opted out. Don't wait for it.
- TanStack DB set a public bar: sub-ms incremental live-query updates over
  100K-row collections, transactional optimistic mutations with automatic
  rollback.

Table stakes Retree currently misses: a verified React Compiler compatibility
statement, devtools (even a Redux DevTools bridge), a documented SSR/Next.js
recipe, persistence middleware, migration guides, a testing story, an honest
bundle-size number (core measured ~17.4 KB min+gzip — MobX-class, not
Zustand-class; fine but unstated).

---

## 6. Strategic capabilities (proposed, in leverage order)

1. **Undo/redo + persistence via change records.** The plumbing is ~80%
   built: raw-value previous/new on every record, transaction batching, raw
   purity making records serializable. Missing: node identity/path per
   record (C6) and an `applyInverse(changes)`. Neither Valtio nor Zustand
   offer this natively; mobx-keystone does but is aging. Falls out of fixing
   C6 + P2's coherent array change records.
2. **Own the sync/optimistic story via Convex.** "State library + first-party
   sync" is the winning 2026 pitch (Legend State v3, TanStack DB). Requires
   §1's Convex fixes first, then: extract a backend-agnostic
   `AsyncQueryNode` from `ConvexQueryNode` (~80% — status/result machinery,
   optimistic generations, reconciler protocol, args lifecycle — is not
   Convex-specific → free fetch/WebSocket/TanStack Query adapters, and
   paginated nodes inherit optimistic updates); an SSR
   preload → `initialState` hydration helper for Next.js RSC; an offline
   mutation queue on top of the optimistic-generation machinery +
   `ConvexConnectionStateNode`; a reactive auth-state node (`useConvexAuth`
   equivalent).
3. **Devtools.** Everything funnels through one static `TreeChangeEmitter`
   (`Retree.ts:170`) — a named-root registry + debug tap is cheap. Minimum:
   Redux DevTools bridge (time travel + inspection for free). Differentiator:
   a jotai-devtools/Pinia-class panel showing the reactive tree, which
   components subscribe to which nodes, `@memo`/`@select` invalidations, and
   components re-rendering with no observed field change. The
   `INodeFieldChanges[]` already flow through every emit and are dropped
   (`subscriptionHub.ts:45-49`).
4. **`Retree.effect(fn)`** — auto-tracked reaction (run, re-run on dependency
   change, no value+compare shape); ~30-line wrapper over the existing
   tracked observer. The missing third primitive next to `on` and `select`.
5. **`Retree.snapshot` — PINNED (deferred per review).** Not pursuing:
   snapshots produce object copies that can go stale in unexpected ways, and
   `specs/retree-raw.md` already deliberately chose `Retree.raw` + raw purity
   over a snapshot concept. Revisit only if a concrete need emerges that
   `raw`/`peekInto`/`useRaw` can't serve (the known candidates are memo-safe
   identity for `useRaw` and true concurrent-rendering `getSnapshot` data —
   today safe only because uSES de-opts to sync renders; note them here so
   the pin has context).
6. **React Compiler compatibility, proven and documented** — benchmark with
   compiler on/off, state it loudly. Cheap; exploits MobX churn. Validate and
   explain the `"use no memo"` directives currently in the hooks as part of
   this.
7. **Context provider + hydration** — `<RetreeProvider>`/`useRootContext()`
   for per-request server roots and test isolation; a `dehydrate`/`hydrate`
   protocol (today `structuredClone(Retree.raw(node))` is a snapshot with no
   sanctioned rehydration path).
8. **Testing utilities** — `createTestRoot` (auto-`clearListeners` on
   teardown), documented recipes for unit-testing ReactiveNodes and faking
   Convex.

Deprioritize: TC39 signals alignment, CRDT bindings beyond an experiment,
framework-agnostic adapters before React is nailed.

---

## 7. Docs & API-shape notes

- Root README is a 1,233-line monolith competing with retree.dev; cut to
  hero + quick start + glossary + links into the site.
- `abstract get dependencies()` (`ReactiveNode.ts:477`) forces
  `get dependencies() { return []; }` ceremony on every subclass — the most
  repeated line in the docs corpus. Default it to `[]`.
- Three "select"s with different semantics (`useSelect`/`Retree.select`
  observational — dependency changes notify subscribers but never reproxy the
  node — vs `@select` emitting `nodeChanged` on the owner) + four memo forms.
  **Resolved: keep the names.** Instead, write one canonical "select
  semantics" doc section that every mention of `useSelect`/`Retree.select`/
  `@select` links to, replacing the scattered warning boxes. Document the
  memo forms as one API with escape hatches rather than four siblings.
  Consider the `runSilent` `skipReproxy` double-negative separately (additive
  option rename is possible without breakage).
- No migration guides (Redux/Zustand/MobX — the MobX one is nearly free given
  `website/lib/comparison-data.ts`), no recipes (forms, undo, websockets,
  optimistic-outside-Convex), **no testing guidance anywhere**.
- Sample READMEs are boilerplate/TODO; no sample covers `useRaw`,
  `move/link/clone` as APIs, virtualized large lists, or undo. One
  "hard-parts" sample (virtualized 10k list + `useRaw` + undo via
  transactions) doubles as a benchmark showcase. Sample 04 hand-rolls
  per-row reactivity (`page.tsx:147-155`) — if `useNode(task)` on reconciled
  docs is the idiomatic path, the flagship sample should show it.
- Compatibility matrix undocumented: Node (broken today per R1), React
  Native/Hermes, the React floor actually tested (specs run React 19 only;
  peers claim ^16.8), Map/Set/Date semantics in one place.
- Strengths to preserve: the useNode-per-child footgun teaching (4 places,
  excellent), the AI-agent surface (llms.txt in tarballs, skill, /raw/docs
  routes) ahead of the field, Pagefind search + Sandpack playgrounds on every
  hook page, `specs/` quality.

---

## 8. Suggested execution order

1. **Correctness sweep, one PR each with tests:** B1+B2+B5+B6 (core),
   B3+B4+B7 (convex). Small, verified, silent-corruption class.
2. **P1** (`@select` quadratic — flagship API broken at scale), then **P2**
   (array batching; unlocks coherent change records).
3. **Packaging/release wave:** R1 (Node-loadable output) + R2 (peer ranges) +
   R3 (`"use client"`) + R4 (CI + changesets) + R5 (stale pins) + R6
   (decorator docs positioning + installer detection). Everything here hits a
   developer in their first hour.
4. **P3** (own the useSelect selection layer) + C1 (batching claim) + C7/C8
   (Convex lifecycle).
5. **Strategy wave (§6), in leverage order:** change-record identity (C6) →
   undo/redo; AsyncQueryNode extraction + SSR hydration; devtools tap;
   `Retree.effect`; React Compiler statement; provider + testing utilities;
   migration guides + recipes. (`Retree.snapshot` pinned per review.)

### Resolved decisions (2026-07-14 review)

1. **R1 — ESM-only.** No CJS build; `require(esm)` on modern Node covers CJS
   consumers. Confirm nothing else regresses via `publint` + `attw` +
   documented compatibility matrix.
2. **R2 — keep exact intra-family peer pins.** Deliberate lockstep policy;
   mitigate the real risk (half-published family) with an atomic, verified
   publish instead of ranges.
3. **§7 — keep the `@select` name.** Canonical "select semantics" doc section
   instead of a rename.
4. **C1 — keep React 16/17 support**; use `unstable_batchedUpdates` when
   available.
5. **§6.5 (snapshot) — pinned.** Not pursuing; stale-copy concerns +
   retree-raw.md's existing stance. Context recorded inline for a future
   revisit.
6. **B7 — dedupe-and-insert via map-consume.** Zero-overhead (`delete` after
   the existing `get`); duplicates are only possible from user-constructed
   query results, never plain `.collect()`. No throw, no validation pass.

---

## Appendix — competitive research sources

State of React 2025 (state-management section) ·
saschb2b.com/blog/react-state-management-2026 · Announcing Valtio v2
(pmnd.rs) · Valtio gotchas · zundo · Zustand Next.js guide · jotai-devtools ·
Jotai async guide · mobx-keystone · MST snapshots docs · MST + React Compiler
demo (coolsoftwaretyler) · MobX 6 proposal (#2325) · RTK Query roadmap
discussion (#4107) · XState/Stately Studio · Legend State v3 · TanStack DB
overview + 0.6 blog + InfoQ coverage · TanStack Query v5 · preactjs/signals
#652 + signals-react README · tc39/proposal-signals · effector.dev · Pinia
(devtools + HMR cookbook) · valtio-yjs · PkgPulse sync-engines guide 2026 ·
Zero (Rocicorp) · react.dev useSyncExternalStore
