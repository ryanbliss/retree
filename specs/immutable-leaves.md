# Spec: Frozen objects are immutable leaves

Status: **implemented** (2026-09-05, `perf/immutable-leaves`). Item 9 of the
Sep 2026 platform work (`benchmarks/findings-sep-5-2026-platform.md`).
Stacked on item 8 (#81).

## 1. Problem

Every object stored in a tree becomes a node: a handler, a proxy, a parent
edge, a children cache, and a proxy trap on every read. That is the right
price for state that changes in place. It is pure overhead for data that
cannot change: a server snapshot the app replaces wholesale, a shared empty
sentinel, a config constant. Neo freezes such values already (`Object.freeze`
on sentinel collections so a memo keyed on "no constructors" sees one
identity), and its biggest trees are read-only documents that are read once
on mount, where materialization is the dominant cost.

Today a frozen object is proxied like any other, so `root.cfg !== frozen`,
50k frozen rows cost 43 ms to read through the tree, and each carries a
handler (about 190 bytes). Its own properties already come back raw: the
proxy invariant for non-writable, non-configurable properties forces the get
trap to return the stored value, so nothing beneath a frozen object was ever
reactive. Only the frozen object itself was.

## 2. Design

A frozen object (`Object.isFrozen(value)`) stored anywhere in a tree is an
immutable leaf: it is stored and returned as-is, never proxied, never given
a parent edge, and never materialized. Replacing it is the change signal,
exactly as for a primitive. This holds for plain objects, arrays, class
instances, Map and Set values, and array elements alike.

-   **Reads** return the stored object by identity from a base proxy, a
    view, `Map.get`, Set iteration, and array indexing.
-   **Tracked reads** record the leaf as the value of the field that holds
    it, so a `Retree.select`, `Retree.effect`, `useSelect`, `@select` or
    `@memo` that read `root.cfg.a` re-runs when `root.cfg` is replaced and
    skips when a sibling field changes.
-   **Writes** store the frozen object raw with an ordinary change record
    whose `previous` and `new` are the objects themselves.
-   **`Retree.root(frozen)`** throws: a root must be a node.
-   **Node APIs** (`Retree.on`, `Retree.parent`, `Retree.version`,
    `Retree.managed`) treat a frozen object as any other non-node value.

The check runs once per first touch of a stored object (`Object.isFrozen`
is 8 ns on an extensible object) and on every read of a frozen leaf (17 ns
for a 10-property object), which is still far below the trap it replaces.

## 3. Semantics preserved and changed

-   Preserved: unfrozen objects, `@ignore`, `@link`, raw purity, and the
    proxy-invariant handling for individual locked properties.
-   Preserved: nothing beneath a frozen object was reactive before, and
    nothing beneath one is reactive now. `Object.freeze` is shallow; a
    mutable object nested inside a frozen leaf is opaque to Retree, as its
    contents were before.
-   Changed: a frozen object read through a tree is the object itself, not a
    proxy. `Retree.on(root.cfg, ...)` on a frozen child now throws the usual
    non-node error instead of subscribing to a node that could never emit.
    Freeze values before storing them; freezing a node that is already
    materialized leaves its handler in place and is not a supported way to
    turn it into a leaf.

## 4. Verification

-   `frozen-leaves.spec.ts`: identity from base and view reads, nested reads,
    array elements and Map/Set values, tracked reader re-runs on replacement
    and skips on sibling writes, change records carry the objects,
    `Retree.root(frozen)` error.
-   `npm run test`: 1009 passed. `npm run doctor` clean.
-   Probes (item 8 bundle vs this branch, serial alternating rounds):

| Probe                                                  | Item 8          | Item 9          |
| ------------------------------------------------------ | --------------- | --------------- |
| s11 50k frozen rows, `rows[i].meta.x` through the tree | 44 ms           | 22 ms           |
| s5 A3 first scan, 150k unfrozen nodes materialized     | 53.4 to 54.7 ms | 55.6 to 56.7 ms |
| s5 A4 second scan, cached                              | 14.6 to 14.8 ms | 14.4 to 14.7 ms |

The frozen-row scan is now three proxy traps per element (`rows`,
`length`, `rows[i]`) plus the raw reads; item 8 paid those plus one handler,
proxy and parent edge per row (about 190 bytes each). Unfrozen first-touch
materialization pays one `Object.isFrozen` per node (8 ns, about 1.5 ms per
150k nodes); cached reads are unchanged.

## 5. Notes from implementation

-   Six materialization sites needed the check: the get trap's stored-object
    resolution, the constructor's eager loop, the set trap's eager branch,
    `preparePropertyValue` (defineProperty), `prepareInsertedArrayValue`,
    and the Map/Set value read helpers. Map.set and Set.add already resolve
    unmanaged values lazily, so they needed nothing.
-   `Retree.raw(frozenLeaf)` throws the usual non-node error, as for any
    plain value; `Retree.isNode` is the guard.
