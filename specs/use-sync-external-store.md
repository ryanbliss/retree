# `useSyncExternalStore` integration

Status: implementation specification

## 1. Goal

Integrate React's external-store protocol into `@retreejs/react` without
changing the public values returned by Retree's hooks.

After this work:

-   `useNode(node)` and `useTree(node)` still return the latest writable,
    Retree-managed reproxy with the caller's original TypeScript type.
-   `useRaw(node)` still returns the same live raw object identity and the same
    `toManaged` function contract.
-   both `useSelect(node, selector)` and `useSelect(selector)` retain their
    current selection, dependency, equality, and identity-stabilization
    semantics.
-   React receives a cached immutable snapshot token whose identity changes
    whenever the data relevant to that hook changes.
-   changes between render and subscription, interrupted renders, Strict Mode
    remounts, and server rendering use React's supported external-store
    consistency protocol.

This is hardening work. It does not make Retree mutations into transition
updates and it does not turn Retree's live proxies into immutable historical
snapshots.

## 2. React contract

Every external store used by the React package must provide:

```ts
interface ExternalStore<TSnapshot> {
    subscribe(onStoreChange: () => void): () => void;
    getSnapshot(): TSnapshot;
    getServerSnapshot(): TSnapshot;
}
```

The following invariants are required:

1. Repeated `getSnapshot()` calls return the same value while every relevant
   Retree version is unchanged.
2. A relevant Retree change produces a different snapshot under `Object.is`.
3. Snapshot reads work before the first listener is installed. Subscription
   state must never determine the current snapshot version.
4. `subscribe` and `getSnapshot` do not create Retree roots, mutate user data,
   or expose snapshot tokens as public API.
5. `getServerSnapshot` reads the same current Retree state as `getSnapshot` so
   SSR does not throw. Hydrating applications remain responsible for creating
   equivalent server and client Retree data.
6. The React 16.8 through React 19 peer range remains supported through
   `use-sync-external-store/shim`.

## 3. Core versions

`@retreejs/core/internal` exposes two listener-independent version readers:

```ts
function getNodeSnapshotVersion(node: TreeNode): number;
function getTreeSnapshotVersion(node: TreeNode): number;
```

Versions are stored by raw node in weak maps and begin at `0`.

Every logical `nodeChanged` operation that installs a fresh reproxy advances a
process-local monotonic version before Retree emits change notifications:

-   the changed node receives the new node version;
-   the changed node and every structural ancestor receive the new tree
    version.

The ancestor walk updates only version metadata. It must not reproxy ancestors,
emit events, materialize children, or change `useNode` notification
granularity. Existing `treeChanged` listener logic may still reproxy ancestors
when required by Retree's identity contract; those listener-induced reproxies
do not advance the ancestor's direct node version.

`Retree.runSilent(fn, true)` does not reproxy and therefore does not advance
versions. `Retree.runSilent(fn, false)` advances versions but continues to
suppress listener callbacks, matching its existing identity-refresh contract.

Transactions may advance internal versions more than once while writes occur,
but their listener notifications and resulting React render batching retain
the current transaction behavior.

## 4. React source adapters

The existing subscription hub continues to share one `Retree.on` listener for
each `(baseProxy, listenerType)` pair. On top of it, the React package defines
stable source descriptors:

```ts
interface RetreeExternalStoreSource {
    baseProxy: TreeNode;
    listenerType: "nodeChanged" | "treeChanged";
    getVersion(): number;
    subscribe(onStoreChange: () => void): () => void;
}
```

Descriptors are cached weakly by base proxy and listener type.

A hook composes one or more descriptors into an external store. Its
`getSnapshot` reads the ordered version vector and returns a cached frozen token.
A new token is allocated only if the source list or one of its versions changes.
Duplicate descriptors are removed before subscribing.

## 5. `useNode` and `useTree`

`useNodeInternal` resolves a node factory, obtains its base proxy, and chooses
one source:

-   `useNode`: `nodeChanged` plus `getNodeSnapshotVersion`;
-   `useTree`: `treeChanged` plus `getTreeSnapshotVersion`.

It passes the composite store to `useSyncExternalStore`, discards the internal
snapshot token, and returns `getReproxyNode(baseProxy)`.

Consequently:

-   public return types and writability are unchanged;
-   stable state returns the same proxy identity;
-   a relevant mutation returns the same fresh reproxy Retree already creates;
-   switching the node argument takes effect during that render;
-   a mutation between render and subscription is visible because the core
    version has already advanced.

## 6. `useRaw`

`useRaw` subscribes to the same node/tree source as `useNodeInternal`, but
continues to return `getUnproxiedNode(baseProxy)`.

The raw object must never be passed to React as the external-store snapshot:
its stable identity cannot signal changes and its live mutable contents do not
satisfy React's immutable snapshot contract. Only the internal version token is
passed to React.

`toManaged`, direct-child materialization, and tuple identity remain unchanged.

## 7. `useSelect`

Selections use plain `useSyncExternalStore` from `use-sync-external-store/shim`
plus a selection-memoization layer owned by `@retreejs/react`. Each hook
instance caches the last computed selection, the composite store built from
its discovered sources, and the store snapshot the selection was computed
against. The external-store snapshot passed to React is an opaque container
whose identity changes exactly when the component should re-render.

### 7.1 Recompute contract

The cached selection recomputes when, and only when:

1. the composite snapshot changes (a subscribed source's version advanced);
2. the observed node or listener type changes (node form);
3. the user selector's function identity changes between renders.

Rule 3 is the contract for prop-capturing selectors: an inline selector
receives a fresh identity every render, so a selector that closes over
render-scoped values (such as an index prop) recomputes during that render —
without any Retree write — and can never render a stale selection. Hoisted or
`useCallback`-stable selectors skip recomputation on unrelated parent
re-renders entirely. In the tracked form the identity-change recompute runs
under dependency tracking and resubscribes when the discovered sources moved.

Changing only the `equals` function identity does not trigger a recompute:
`equals` is consulted when a recompute happens, to stabilize outputs.

### 7.2 Concurrent-rendering safety

The hooks write no refs during render. The per-instance memoization closure is
created by `useMemo` keyed on the recompute inputs; the last committed state
(used to stabilize container and store identities across selector-identity
changes) and the latest `equals` are committed from a `useEffect`. A discarded
concurrent render therefore cannot leave its closures or selections behind for
the committed tree's store-change path. Selector-identity recomputes build a
new state object rather than mutating committed state; snapshot-driven
refreshes mutate the instance cache in place, which is safe because everything
cached is derived from global Retree versions plus the instance's fixed
selector.

### 7.3 Node form

`useSelect(node, selector, options)` evaluates the selector to discover its
current dependency entries. Its composite source contains:

1. the selected root with the requested listener type;
2. every distinct Retree-managed dependency entry with `nodeChanged`.

Recomputes run the selector against the latest root reproxy. Equality remains:

-   the supplied `equals` function when present;
-   otherwise `defaultSelectShouldNotify` restricted to the dependency indices
    whose source versions changed, falling back to the whole-selection
    comparison when no subscribed version changed (including
    selector-identity recomputes).

This preserves Retree's raw-to-raw managed-node comparisons and explicit
dependency comparison cells, and matches the previous selection semantics for
prop-capturing selectors.

### 7.4 Tracked form

`useSelect(selector, options)` performs a tracked evaluation to discover its
current Retree node dependencies. Every distinct dependency is a
`nodeChanged` source.

The instance cache stores both the public selected value and the tracked
dependency comparison values. Equality preserves the existing rules:

-   equivalent Retree-managed selected references are stabilized;
-   custom `equals` controls selected-value equality;
-   otherwise selected values use `Object.is` after stabilization;
-   a change to the ordered tracked dependency comparison values invalidates
    the selection even when the selected primitive is equal.

Dependency source identity is part of the comparison. If a selector switches
branches or nodes without changing its displayed value, React still commits
the new source list and resubscribes.

Store and source-array identities are reused whenever the discovered source
set is unchanged, so inline selectors do not cause subscription churn.

## 8. Concurrency and transitions

This integration guarantees React-supported external-store consistency, not
multi-version state:

-   React may restart interrupted work if a Retree version changes before
    commit.
-   Retree mutations remain synchronous external-store updates even when the
    caller wraps them in `startTransition`.
-   expensive UI can defer primitive or immutable selected projections, but an
    older Retree reproxy still reads live data and is not a historical snapshot.
-   true concurrent rendering of old and new Retree states would require a
    separate immutable, version-cached snapshot API.

## 9. Verification gates

Tests must prove:

1. node and tree versions are cached, listener-independent, and respect silent
   writes;
2. `useNode` return type, writability, stable identity, fresh reproxy identity,
   node-factory behavior, and shared-listener behavior are unchanged;
3. `useTree` detects a descendant mutation between render and subscription;
4. `useRaw` keeps raw identity while relevant versions render fresh data;
5. both selector forms preserve custom equality, tuple comparison, managed
   reference stabilization, dynamic dependencies, and shared listeners;
6. Strict Mode leaves no stale subscriptions;
7. server rendering succeeds through `getServerSnapshot`;
8. an interrupted render cannot commit two observed Retree versions;
9. transactions retain their single-render behavior;
10. the full test suite, typecheck, and `npm run doctor` pass.

The website comparison row may be upgraded only after these gates pass. The
claim should be "React external-store consistency protocol across all hooks",
not that Retree mutations become concurrent or transition-scheduled.
