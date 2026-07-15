# Spec: `@retreejs/query` — the backend-agnostic async-query layer

Status: **implemented** (2026-07-14), first tranche of the §6.2 extraction
from `specs/audit-jul-14-2026.md`. The generic node is enforced by
`packages/retree-query/src/QueryNode.spec.ts` and
`packages/retree-query/src/fetchQueryNode.spec.ts`; the compatibility
contract for the Convex refactor is the pre-existing
`packages/retree-convex/src/ConvexQueryNode.spec.ts` and
`packages/retree-react-convex/src/index.spec.ts`, which pass unmodified.

Context: audit §6.2 ("Own the sync/optimistic story via Convex") observed
that ~80% of `ConvexQueryNode` — the status/result machinery, optimistic
generations, reconciler protocol, and args lifecycle — was not
Convex-specific, and that the paginated node's missing `optimisticUpdate`
(the TODO formerly at `ConvexPaginatedQueryNode.ts:306`) was blocked on
exactly that extraction.

## 1. Problem

### 1.1 The async-query machinery was trapped inside the Convex adapter

`ConvexQueryNode` accumulated a genuinely hard state machine through the
July 14 correctness pass: pending/success/error/skipped statuses,
`keepPreviousData`/`isStale`, sticky disposal with resubscribe-on-reobserve,
`retry()`, deep-compared args, generation-tracked optimistic updates with
rejection-time baseline rollback (audit B3), `structuredClone`-based
baselines (B4), and the read-raw/write-managed reconciler protocol (P6/B7).
None of that logic touched a Convex API except through two calls:
`client.onUpdate(...)` and the emitted values. Every future backend (fetch
polling, WebSocket topics, TanStack Query) would have had to re-implement or
fork it.

### 1.2 Paginated nodes could not inherit optimistic updates

The optimistic machinery lived as private members of `ConvexQueryNode`, and
its baselines used `structuredClone`, which throws on the `loadMore`
function stored inside paginated state. Porting by duplication would have
forked the exact code the B3/B4 fixes just hardened.

## 2. Design

### 2.1 Package shape

`@retreejs/query` (version 0.6.0, lockstep; exact peer pin on
`@retreejs/core` per family policy) sits between `core` and the backend
adapters:

```
@retreejs/core  ←  @retreejs/query  ←  @retreejs/convex  ←  @retreejs/react-convex
```

Publish order: core, query, react, convex, react-convex, create.

### 2.2 `QueryNode<TArgs, TState>` and the source protocol

The generic node is a `ReactiveNode` owning the full state machine. The
backend surface it consumes is deliberately minimal:

```ts
interface IQuerySubscriptionSource<TArgs, TValue> {
    subscribe(
        args: TArgs,
        onValue: (value: TValue) => void,
        onError: (error: Error) => void
    ): { unsubscribe(): void; getCurrentValue(): TValue | undefined };
}
```

distilled from `IConvexQueryClient`/`IConvexQuerySubscription`.
`getCurrentValue()` covers backends with synchronous caches (Convex watch
results); a source may surface a cached _error_ by calling `onError` from
inside `getCurrentValue()`, which the node keeps visible instead of
resetting to pending (the C8 fix, now generic).

Everything moved verbatim from `ConvexQueryNode`: subscription lifecycle
(`onObserved`/`onUnobserved` self-cleanup, sticky `isDisposed`, `retry`),
args lifecycle (deep-compare dedup via the moved `deepEquals`),
status/result transitions, and the optimistic machinery (generations, dirty
window, mid-window baseline advance, rejection-time `cloneState` rollback,
`Retree.runTransaction`-wrapped transforms). Error and warning messages are
prefixed by a protected `queryNodeName` getter so subclass failures pinpoint
the concrete class (`ConvexQueryNode.optimisticUpdate: ...`).

Four protected hooks exist for backend-specific state shapes:

-   `tryDefaultReconcile(next)` — backend-convention reconciliation when no
    explicit reconciler is configured (Convex overrides with `_id`-array
    reconciliation; base returns `false`).
-   `restoreState(next)` — how an emission/rollback value is written into
    `state` (paginated override reconciles `results` and diff-writes
    `status`/`loadMore`).
-   `cloneState(state)` — rollback baselines (base: `structuredClone` over
    the raw view; paginated override clones `results` and keeps the
    `loadMore` function by reference, which is what unblocked P7's TODO).
-   `stateEquals(left, right)` — baseline-echo comparison (paginated
    override ignores `loadMore` identity churn, which is fresh per
    emission).

The moved internals (`deepEquals`, `reconcileArray`,
`tryReconcileDocumentsById`, `reconcileArrayById`, `IStateReconciler`) are
public exports of `@retreejs/query`; `@retreejs/convex` re-exports them from
its historical paths (`internals/equality`, `internals/reconcile`,
`reconcile.ts`, `types.ts`) as compatibility shims.

### 2.3 The Convex adapter after the refactor

`ConvexQueryNode` keeps its exact public and protected surface. The
inheritance chain changed from `BaseConvexNode` to a new exported
`BaseConvexQueryNode<TArgs, TState> extends QueryNode<TArgs, TState>`,
which re-provides the protected Convex helpers (`client`, `mutation`,
`action`, `queryOnce`) with the same signatures, so subclassers keep every
member they had. The constructor binds the client through a ~5-line
`IQuerySubscriptionSource` wrapper around `client.onUpdate`; overrides of
`updateArgs`/`retry`/`optimisticUpdate`/`dispose` delegate to `super` and
exist to preserve the Convex-typed signatures and TSDoc (plus
`notifyNodeDisposed` for `ConvexNode` live-child tracking). The one
observable type-level change: `ConvexQueryNode instanceof BaseConvexNode` is
no longer true — nothing in the repo or docs relied on it, and the specs
(the compatibility contract) pass unmodified.

`ConvexPaginatedQueryNode` gains `optimisticUpdate` for free via the shared
machinery, with the paginated overrides above. Its subscription source drops
malformed emissions via the existing shape guard, preserving the old
"invalid current value counts as no value" behavior. The optimistic suite
(including the B3 mid-window-confirmation rollback case) is mirrored in
`ConvexPaginatedQueryNode.optimistic.spec.ts`.

### 2.4 Proof of generality: `fetchQueryNode`

`createFetchQuerySource` adapts `(args) => Promise<T>` — one-shot per
subscription, or polled with `refetchInterval` — into the same source
protocol; `fetchQueryNode(...)` wraps it in a `QueryNode`. Late resolutions
after unsubscribe are dropped; `retry()` refetches after an error. This is
the demonstration that the extraction is real: zero query-machinery code in
the adapter (~60 lines, all plumbing), tested with fake timers.

### 2.5 Reactive auth state (`ConvexAuthStateNode`)

Convex clients only expose auth changes through the `onChange` callback of
`setAuth(fetchToken, onChange)` — there is no subscribable auth surface. So
observability is modeled where it actually exists: a new standalone
`IConvexAuthClient` interface (`authState()` +
`subscribeToAuthState(cb)` over `{ isLoading, isAuthenticated }`), which
`RetreeConvexReactClient` implements by interposing on `setAuth` (loading
until the server confirms via `onChange`) and `clearAuth`.
`ConvexAuthStateNode` follows the `ConvexConnectionStateNode` pattern:
subscribe on observe, self-dispose on unobserve, resubscribe on reobserve.
`IConvexAuthClient` is deliberately **not** merged into `IConvexClient`:
adding required members there would break every existing `IConvexClient`
implementation (including the frozen spec's fake client).

### 2.6 SSR preload hydration (`preloadedQueryOptions`)

`@retreejs/react-convex` gains the Retree equivalent of `usePreloadedQuery`:
`preloadedQueryOptions(preloaded)` decodes a `convex/nextjs` `preloadQuery`
payload with `jsonToConvex` (the same decoding `usePreloadedQuery` uses —
no JSON round-trip, so bigint/bytes survive) into `{ args, initialState }`
for a `ConvexQueryNode`. First render shows server data as
`status: "success"` with no pending flash; the live subscription then runs
the exact query the server preloaded. Documented as the Next.js RSC recipe
in the package README.

## 3. What deliberately did not move

-   `ConvexConnectionStateNode`, `ConvexNode`'s live-child
    disposal registry, and the mutation/action helpers — Convex-client
    plumbing, not query machinery.
-   The `_id` default-reconciliation _decision_ (the helper moved; choosing
    to apply it by default stayed a `ConvexQueryNode` override).
-   `IConvexQueryNodeOptions`'s conditional required-vs-optional `args`
    typing — Convex-signature sugar; the generic node requires `args`
    (documented: `undefined` args are reserved for "no subscription yet").

## 4. Future work (deferred; out of this tranche)

-   **Offline mutation queue** on top of the optimistic-generation machinery
    plus `ConvexConnectionStateNode` (audit §6.2).
-   **TanStack Query adapter** — an `IQuerySubscriptionSource` over a
    QueryClient/QueryObserver.
-   **WebSocket adapter** — a thin source over a socket topic; the fetch
    adapter is the template.
