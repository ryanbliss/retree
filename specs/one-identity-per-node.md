# Spec: One identity per node version, and a public node version

Status: **implemented** (2026-09-05, `perf/one-identity-version`). Item 7 of the
Sep 2026 platform work (`benchmarks/findings-sep-5-2026-platform.md`).
Stacked on item 6 (#79).

## 1. Problem

A managed node has two proxies: the base proxy, whose identity never
changes, and the view (reproxy), rebuilt when the node changes. Which one a
read returns depends on the receiver, not on the node:

| Read                                                            | Returns                |
| --------------------------------------------------------------- | ---------------------- |
| `root.tasks` where `root` is a base proxy                       | base proxy of `tasks`  |
| `root.tasks` where `root` is a view                             | latest view of `tasks` |
| `this.tasks` in a getter reached via base                       | base proxy             |
| `this.tasks` in a getter reached via view                       | latest view            |
| `@ignore` / `@link` field, any receiver                         | latest view            |
| `Retree.parent`, `Retree.managed`, `peekInto`, `Retree.on` args | latest view            |

React hands components views, so a getter's `this` is a view during render
and a base proxy when another view model calls it. A hand-rolled cache that
compares `Object.is(previousCell, this.tasks)` therefore misses on every
alternation. Neo wrote `retreeRevisionCell` (`Retree.peekInto(v, raw => raw)`)
to force one identity and calls it in 54 places. It also has no number to
key a cache on: the only version signal is the view identity itself, so
"has this node changed since I looked" costs a proxy allocation to answer.

## 2. Design

### 2.1 Reads return the latest identity, whatever the receiver

Every read of a managed child returns that child's latest identity: its
view when it has one, its base proxy until its first change. The base proxy
trap and the view trap resolve children the same way, so the receiver no
longer decides the result.

Identity becomes a statement about the node: two reads of the same node are
`===` exactly when no change to that node happened between them (with the
existing `treeChanged` exception in §3). This is the model the README
already describes ("stable base proxies and fresh reproxy identities after
changes"); today only view holders get it.

The children cache stores each child's base handler instead of its base
proxy. Resolving the latest identity is then two field reads
(`viewDirty`, `view`) with no proxy trap. The view trap today pays a
sentinel trap per child read to recover the handler from the cached proxy,
so view reads get cheaper; base reads pay two field loads instead of a
`typeof` check.

`Retree.parent` and the chaining mutators (`sort`, `reverse`, `fill`,
`copyWithin`, `Map.set`, `Set.add`) return the latest identity too; the
view trap's separate "reproxy-aware" array mutator wrappers go away, so a
mutator method has one identity from either receiver.

Base proxies remain reachable and stable where a stable handle matters:
the `Retree.root()` return value and `this` inside a method or getter
invoked through the base proxy. Nothing about writes, raw purity, or
change emission changes.

### 2.2 `Retree.version(node)` and `Retree.treeVersion(node)`

```ts
Retree.version(node): number; // advances when the node's own fields change
Retree.treeVersion(node): number; // advances when the node or any descendant changes
```

Both accept a managed node or the raw object behind one and throw a precise
error for anything else. `Retree.version` is the node's identity as a
number: it advances exactly when the node gets a fresh identity for a
change of its own fields, so `Object.is(a, b)` on latest identities and
`Retree.version(a) === Retree.version(b)` agree. `Retree.treeVersion`
matches `treeChanged`: any write in the subtree advances it, and it does
not depend on whether anyone is listening.

Both are the counters React's external store already uses
(`snapshotVersionsRecord.node` / `.tree`); this exposes them. A tree
version read settles pending ancestor stamps for the node's root first,
which is the same lazy walk `useSelect` pays.

### 2.3 `runSilent`

`Retree.runSilent(fn)` skips reproxying and therefore skips both versions,
matching its contract that "old and new object identities remain equal for
comparison checks". `Retree.runSilent(fn, false)` refreshes identities and
advances both versions.

## 3. Semantics preserved and changed

-   Preserved: views for React. A node that changed is `!==` its previous
    identity; `useSelect` and `memo` boundaries work as today.
-   Preserved: `Retree.root()` returns the base proxy; `this` is the
    receiver the caller used.
-   Preserved: raw purity. A view assigned into the tree unwraps to raw
    exactly like a base proxy did.
-   Preserved: ancestors on a `treeChanged`-listened path still refresh
    their identity on descendant writes. `Retree.version` of such an
    ancestor does not advance; `Retree.treeVersion` does.
-   Changed: a child read through a base proxy returns a fresh identity
    after the child changes. Code that kept a base child in a `Map` keyed
    by identity and expected hits across writes now misses, which is the
    behavior view holders always had. Key such maps on `Retree.raw(node)`
    (the README already says raw references are the stable identity).

## 4. Verification

-   `npm run test`: 992 passed. New `node-identity.spec.ts` covers one
    identity per receiver, stability across unrelated writes and freshness
    after a write, the stable root handle and method receiver, latest
    identity from `Retree.parent` and mutators, and `Retree.version` /
    `Retree.treeVersion` (own vs descendant writes, raw input, agreement
    with identity, both `runSilent` modes, precise errors). Fifteen
    existing tests that asserted the receiver-dependent identity (a base
    read `!==` its view, `Retree.parent(child) === root` after a root
    write, reconciled rows keeping identity through an in-place edit) now
    assert the raw node or the latest identity instead.
-   Probes against the item 6 bundle, serial alternating rounds:

| Probe                                              | Item 6          | Item 7          |
| -------------------------------------------------- | --------------- | --------------- |
| A3 first scan, 150k nodes materialized             | 53 to 55 ms     | 54 to 56 ms     |
| A4 second scan through base                        | 15.5 to 15.7 ms | 14.0 to 14.8 ms |
| A5 first scan through view                         | 14.8 to 15.2 ms | 13.7 to 14.0 ms |
| s6 steady 50k-row scan via base / via view         | 14.1 / 14.1 ms  | 14.1 / 13.8 ms  |
| s8 200k child reads via VM base / via VM view      | 12.1 / 16.7 ms  | 11.8 / 11.4 ms  |
| s8 200k x 9 scalar reads via VM base / via VM view | 133 / 128 ms    | 110 / 100 ms    |
| s9 200k `Retree.version(node)` / `(raw)`           |                 | 4.1 / 2.1 ms    |
| s9 200k `Retree.treeVersion(root)`, write per 100  |                 | 6.4 / 8.0 ms    |
| s9 200k `Retree.peekInto(v, raw => raw)` (Neo)     | 10.3 ms         | 10.3 ms         |

## 5. Notes from implementation

-   The first cut wrapped the first-touch path in `latestIdentity(...)`,
    which paid a sentinel trap plus a registry lookup per materialized node
    and cost 8% on A3. `buildProxy` now has a handler-returning form and
    `resolveStoredObject` serves the latest identity from the handler it
    already holds, so materialization is back to parity.
-   `Retree.parent` returned the base proxy, which made
    `Retree.parent(item) === root.list` false the moment `list` had a view.
    It now returns the latest identity. The one comparison that changes is
    against the `Retree.root()` handle after the root itself was written;
    compare `Retree.raw` or `Retree.managed(root)` there.
-   Map.set and Set.add returned the base proxy even to view holders (a
    documented trade-off); they return the latest identity now.
-   The constructor loop cached `null` and `@ignore` values in the children
    cache. Nothing read them (the get trap checks ignored keys first and
    `null` was falsy), so the typed cache simply skips them.
