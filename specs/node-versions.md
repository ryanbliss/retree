# Spec: Handler-backed children cache and public node versions

Status: **implemented** (2026-09-05, `perf/one-identity-version`). Item 7 of
the Sep 2026 platform work (`benchmarks/findings-sep-5-2026-platform.md`).
Stacked on item 6 (#79). A first cut also changed what a read returns (§5);
that part was reverted before merge and the branch name predates the revert.

## 1. Problem

A managed node has two proxies: the base proxy, whose identity never
changes, and the view (reproxy), rebuilt when the node changes. The view
trap resolved a cached child by reading the child proxy out of the
children cache and paying a sentinel trap on it to recover the child's
handler, so every child read through a view (the common React path) cost
one trap more than the same read through a base proxy.

Separately, there was no number to key a cache on. The only version signal
was the view identity itself, so "has this node changed since I looked"
cost holding a node and comparing proxies, and Neo's `retreeRevisionCell`
exists to normalize identities across read contexts for exactly that.

## 2. Design

### 2.1 The children cache stores handlers

The children cache maps each property to the child's base handler instead
of its base proxy. The base trap serves `handler.baseProxy`; the view trap
serves `handler.view` when it exists and the base proxy until the child's
first change. Both are field reads with no trap. `buildProxy` gains a
handler-returning form so materialization stores the handler it just built
without a lookup, and the array reorder paths (`sort`, `reverse`, `fill`,
`copyWithin`, `splice`) re-key handlers instead of proxies.

### 2.2 `Retree.version(node)` and `Retree.treeVersion(node)`

```ts
Retree.version(node): number; // advances when the node's own fields change
Retree.treeVersion(node): number; // advances when the node or any descendant changes
```

Both accept a managed node or the raw object behind one and throw a precise
error for anything else. `Retree.version` advances exactly when the node
gets a fresh view for a change of its own fields, so two views of a node
are `===` while `Retree.version` is unchanged. `Retree.treeVersion` matches
`treeChanged`: any write in the subtree advances it, and it does not depend
on whether anyone is listening. Both are the counters React's external
store already uses (`snapshotVersionsRecord.node` / `.tree`); this exposes
them. A tree version read settles pending ancestor stamps for the node's
root first, the same lazy walk `useSelect` pays.

`Retree.runSilent(fn)` skips reproxying and therefore skips both versions,
matching its contract that "old and new object identities remain equal for
comparison checks". `Retree.runSilent(fn, false)` refreshes identities and
advances both versions.

## 3. Semantics

Unchanged. Reads through a base proxy return base children, reads through a
view return the latest views, `Retree.parent` returns the base proxy, array
mutators return the receiver's identity through the view-aware wrappers,
and `Map.set` / `Set.add` return the base proxy (the documented trade-off).

## 4. Verification

-   `npm run test`: passes. `node-version.spec.ts` covers own vs descendant
    writes, agreement with the view identity, raw input, both `runSilent`
    modes, and the precise errors.
-   Probes against the item 6 bundle, serial alternating rounds:

| Probe                                              | Item 6          | Item 7          |
| -------------------------------------------------- | --------------- | --------------- |
| A3 first scan, 150k nodes materialized             | 53 to 55 ms     | 54 to 56 ms     |
| A4 second scan through base                        | 15.5 to 15.7 ms | 14.0 to 14.8 ms |
| A5 first scan through view                         | 14.8 to 15.2 ms | 13.7 to 14.0 ms |
| s8 200k child reads via VM base / via VM view      | 12.1 / 16.7 ms  | 11.8 / 11.4 ms  |
| s8 200k x 9 scalar reads via VM base / via VM view | 133 / 128 ms    | 110 / 100 ms    |
| s9 200k `Retree.version(node)` / `(raw)`           |                 | 4.1 / 2.1 ms    |
| s9 200k `Retree.treeVersion(root)`, write per 100  |                 | 6.4 / 8.0 ms    |
| s9 200k `Retree.peekInto(v, raw => raw)` (Neo)     | 10.3 ms         | 10.3 ms         |

The view-read gain is the removed sentinel trap; the scalar-read gain is the
smaller base get trap (the children branch no longer type-checks a cached
value). Neither depends on what identity the trap returns.

## 5. Tried and reverted: one identity per node

The first cut made every read return the node's latest identity whatever
the receiver, so a child read through a base proxy came back as the child's
view once the child had changed, and `Retree.parent` and the chaining
mutators did the same. The motivation was Neo's hand-rolled caches, which
compare identities read from alternating contexts.

It was reverted for the React path. A component whose parent node is never
written (a container view model holding sub-VMs) received base children as
props, so a `React.memo` child rendered only when its own node changed.
Under the one-identity rule, any re-render of that parent for an unrelated
reason would pass a fresh identity for every child that had changed since,
and each of those memoized components would render again. The measured
gains in §4 come from the handler cache and do not need the semantic, and
`Retree.version` gives caches a number to compare instead.
