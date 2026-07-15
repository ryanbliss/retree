# Spec: Full React Compiler support (remove `"use no memo"` where it isn't needed)

Status: **draft — for review** (2026-07-14). Not implemented. Proposes
removing the `"use no memo"` directive from `useNode`/`useTree`'s source path,
keeping it (narrowed) for `useSelect`, and leaving `useRaw` unchanged by
design.

Context: `packages/retree-react/src/react-compiler.spec.tsx` (the existing
proof), `packages/retree-react/src/internals/{useNodeInternalCore,externalStore}.ts`,
`packages/retree-react/src/{useSelect,useRaw}.ts`. Builds on the audit's §6.6
work (`specs/audit-jul-14-2026.md`) and the `useSyncExternalStore`
architecture in `specs/use-sync-external-store.md`.

## 1. Problem

Retree's React hooks carry a file-level `"use no memo"` directive so the
React Compiler skips them. The audit added `react-compiler.spec.tsx`, which
proves two things:

1. **Consumers are already compiler-safe.** Components that _call_ Retree
   hooks compile and memoize correctly — published packages ship uncompiled
   `bin/` output, which compilers skip in `node_modules`, and the hooks are
   `useSyncExternalStore`-based (no observer HOC, no Babel transform).
2. **The directive is currently load-bearing** when the hook _source_ is
   compiled (monorepo source-inclusion, this repo's vitest aliases,
   playground templates that inline `src`).

So the directive costs nothing for the common consumer, but it does forfeit
in-library compiler optimization for source-inclusion setups, and it is a
blunt file-level tool where the real constraint is narrower.

### 1.1 Why the directive is load-bearing today (useNode/useTree)

`useNodeInternalCore` ([useNodeInternalCore.ts:63](../packages/retree-react/src/internals/useNodeInternalCore.ts:63))
does two separable things:

-   Subscribes via `useRetreeExternalStore([source])`, whose
    `useSyncExternalStore` returns a `RetreeCompositeSnapshot` carrying
    `{ sources, versions }` — **not** the node the caller wants.
-   Then derives the return value _outside_ the store read:
    `operations.getRenderReproxyNode(listenerType, baseProxy)` — the latest
    reproxy for a `baseProxy` whose identity is **intentionally stable** across
    writes.

The data dependency is real (that derivation is only correct because a
version bump re-ran render), but it is expressed through _render timing_, not
through a value the compiler can see. Compiled, `getRenderReproxyNode(baseProxy)`
is memoized on the stable `baseProxy` and never refreshes: after a write the
hook re-renders (uSES fires) but hands back the pre-write reproxy. Field reads
still pass through to the raw target, so plain text survives — what breaks is
the **identity contract** ("a changed node is a new reference") that
`React.memo`, `useMemo` deps, and compiler-memoized consumer derivations rely
on.

The reproxy is not the problem. `useNode`/`useTree` _work_ with reproxies —
the bug is that the reproxy is derived from a stable input instead of flowing
through the changing one.

### 1.2 Why `useSelect` bails (independent reason)

`useSelect` reads committed-selection refs during render (reference
stabilization: "selection is equal → return the previously committed
container") and its overload trampoline dispatches to hooks conditionally.
The compiler's own validation rejects those functions regardless of the
directive. This is _internal mechanics_, not semantics — and it is not the
same failure as §1.1.

## 2. Goals / non-goals

**Goals**

-   Remove `"use no memo"` from the `useNode`/`useTree` source path so the
    React Compiler can optimize those hooks in source-inclusion setups, with no
    change to their observable behavior or identity contract.
-   Keep `useSelect`'s exact current semantics: run the selector, return the
    latest managed node if a node was returned (else the plain value), re-render
    when the returned selection differs. Narrow its directive from file-level to
    the specific functions that legitimately need it.
-   Flip `react-compiler.spec.tsx` from "directive is load-bearing" to
    "directive removed, reactivity + identity hold under compilation" for the
    hooks that lose it, and state the final decision per hook on the
    react-compiler docs page.

**Non-goals**

-   **`useRaw` stays exactly as-is.** Raw identity is _intentionally_ stable —
    that is its contract, and `toManaged` is the sanctioned way to get a managed
    node from a raw value. We do not want raw wrapped in a per-version tuple;
    callers are already told never to use raw as a memo/equality token, which is
    the same rule a compiled consumer needs. Its directive remains, documented
    as deliberate.
-   No Valtio-style `useSnapshot`/`useTree`-everywhere behavior. Selection and
    node semantics are unchanged; this is purely about _how_ the return value
    reaches React, not _what_ it is.
-   No `Retree.snapshot` (pinned in `specs/audit-jul-14-2026.md` §8).

## 3. Design

### 3.1 useNode / useTree — reproxy flows through the snapshot

Make the value the caller receives a function of the uSES snapshot, whose
identity already changes exactly when versions change
([externalStore.ts:134](../packages/retree-react/src/internals/externalStore.ts:134)
allocates a fresh frozen snapshot on version change and returns the previous
one by reference otherwise). Two viable shapes; prefer whichever measures
cleaner:

-   **(A) Reproxy in the snapshot.** Extend the source/snapshot so the
    per-source current reproxy is captured when the snapshot is (re)built, and
    `useNodeInternalCore` returns `snapshot`'s reproxy for its single source.
    The returned node then has the same identity lifetime as the snapshot: new
    on change, stable otherwise. Compiler memoization keyed on the snapshot is
    _correct_.
-   **(B) Derive from the snapshot, not the base proxy.** Keep the snapshot as
    `{ sources, versions }` but compute the return value as
    `getRenderReproxyNode(...)` inside a step keyed on the snapshot object, so
    the compiler sees the changing snapshot as the input rather than the stable
    base proxy.

Either way the invariant becomes: **the returned node identity is derived
from a value that changes iff the node changed.** That is what makes
compilation safe. Reproxy semantics, subscription setup, the swappable-store
machinery, and the single-render bootstrap (`snapshot-version.ts` pending
flush) are all unchanged.

Constraints to preserve (regression surface — these were hardened over
several audit review rounds, so the spec's acceptance gate must re-assert
them):

-   One render per relevant write; zero re-render on unrelated writes.
-   Bootstrap renders exactly once (populate-then-mount).
-   StrictMode double-invoke safety; `getServerSnapshot` parity.
-   `useNodeFactoryResetWarning` still fires on unstable factories.

### 3.2 useSelect — keep semantics, narrow the directive

Semantics stay verbatim. The realistic end state is a **function-scoped**
`"use no memo"` on exactly the selection-cache functions that read committed
refs during render (and the overload trampoline), rather than a file-level
directive. That is invisible to consumers (published output is uncompiled) and
lets any pure helpers in the file be compiled.

Investigate as part of implementation whether the render-phase ref reads can
be restructured into pure derivation + commit-in-`useEffect` (mirroring the
C9 fix already applied in `externalStore.ts`) cleanly enough to drop even the
function-scoped directive. If that restructure risks the reference-stabilization
or stranded-store guarantees, stop and keep the narrowed directive — it costs
consumers nothing, and correctness of the layer we just hardened outranks
in-library optimization of a rarely-source-compiled hook.

### 3.3 useRaw — unchanged

Leave the directive and the stable-identity contract in place. Document on the
react-compiler docs page _why_ it is exempt (stable-by-design; use
`toManaged`), so the asymmetry with `useNode`/`useTree` is intentional and
legible.

## 4. Acceptance gate

`react-compiler.spec.tsx` is the ready-made harness. Update it to encode the
new per-hook decisions:

-   **useNode/useTree:** compile the real hook source _with the directive
    removed_ and assert (a) components re-render on relevant writes, skip
    unrelated writes; (b) the **identity contract holds** — a changed node is a
    new reference, so a compiler-memoized derived value / `React.memo` child
    updates, and an unchanged node keeps its reference. The current
    "directive-is-load-bearing / stale-UI-when-stripped" tests for these hooks
    are _replaced_ by "reactive-and-identity-correct-when-compiled."
-   **useSelect:** assert the narrowed directive is present on the functions
    that need it (or, if the restructure lands, assert compiled selection stays
    correct); assert consumer-side compilation of components _calling_
    `useSelect` still works (unchanged from today).
-   **useRaw:** keep the existing "directive respected / stable identity"
    assertion; add a one-line note that this is deliberate.

Plus the full existing suite green (`npm run test`), typecheck, and
`npm run lint:packages`.

## 5. Risks

-   The change concentrates in the uSES snapshot contract — the exact machinery
    behind the audit's stranded-store and double-initial-render fixes. Any
    reshaping of the snapshot must re-run those regression tests
    (`snapshot-version.spec.ts`, `useSelect.spec.tsx`, `externalStore.spec.ts`).
-   Putting the reproxy in the snapshot (shape A) means the snapshot holds a
    node reference; verify it does not extend node lifetime in a way that defeats
    the WeakMap-based teardown, and that `getServerSnapshot` still returns a
    serializable-enough shape for SSR.
-   Compiler-version drift: the spec's assertions are pinned against a specific
    `babel-plugin-react-compiler`; note the version in the test so a future
    compiler that changes memoization heuristics re-triggers review (the
    existing spec already does this for the opposite direction).

## 6. Rollout

1. Land §3.1 behind the flipped compiler spec; measure a compiled
   source-inclusion render to confirm the optimization actually engages.
2. Land §3.2 (narrowed directive; attempt the restructure, keep the narrowed
   directive if it doesn't come cleanly).
3. Update `website/content/docs/react-compiler.mdx` with the final per-hook
   decisions and the `useRaw` exemption rationale; update the directive
   comments in source to point at this spec.

## 7. Open questions

1. Snapshot shape A vs B in §3.1 — decide by measuring which the compiler
   optimizes more cleanly and which keeps `getServerSnapshot` simplest.
2. Whether §3.2's restructure is worth attempting now or deferred behind the
   narrowed directive (default: narrow now, restructure later only if a
   concrete need appears).
