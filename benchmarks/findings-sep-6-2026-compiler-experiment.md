# ReactiveNode compiler experiment (Sep 6, 2026)

Two questions: how much of Neo's `@memo` / `@select` / `@fnMemo` surface a
compiler could resolve statically, and which reads, writes, and
materialization would actually get faster if `ReactiveNode` classes were
compiled to accessors instead of served through Proxy traps.

Tools (this branch):

- `benchmarks/compiler-scan/` — a throwaway ESLint rule built on the same
  typescript-eslint type services as `@retreejs/react-eslint-plugin`. It
  walks every ReactiveNode subclass in a host repo and reports, per
  decorated member, what a compiler would have extracted. Run with
  `node benchmarks/compiler-scan/run.mjs <neo-compose-root> src`.
- `benchmarks/compiled-node-shapes.mts` — a hand-written "compiled" shape
  (prototype accessors over a slot record, a static dependency list turned
  into a version check, a shared forwarding view class for identity)
  measured next to today's proxies. Run with
  `node --expose-gc scripts/run-sdk-scaling.mjs benchmarks/compiled-node-shapes.mts`.

The compiled shape is an upper bound. It keeps tracking hooks, node
versions, listeners, change records, and a fresh identity per change, but
carries no undo history and no transaction batching.

## 1. Static analyzability of Neo (scan of `src`, 31 s)

132 ReactiveNode subclasses, 274 decorated members (242 `@memo`, 22
`@fnMemo`, 10 `@select`), 891 undecorated getters. Every `@memo` in Neo
passes an explicit key function; none rely on automatic trapping.

Key functions (256):

| Verdict | Count |
| --- | --- |
| static (only `self.a.b` paths) | 207 |
| dynamic (calls a method) | 43 |
| static + iteration | 2 |
| constant | 4 |

- Keys are shallow: 375 paths of depth 1, 106 of depth 2, 30 of depth 3, 2 of depth 4.
- Keys mostly name whole values, not primitives: 178 arrays, 108 objects, 21 maps, 10 sets, 172 primitives. A compiler would turn those into version dependencies on the named node.
- Keys read through other getters far more than through fields: 253 roots are plain getters, 161 are `@memo` getters, 37 are primitive fields.
- 39 keys read through an `@ignore` field and 75 through a plain object; those paths are invisible to tracking today and stay invisible to a compiler unless it treats them as constants.
- The 43 dynamic keys call a handful of revision helpers: `corpus()` 32, `exactRevision()` 15, `revision()` 14, `findNSGetterParent()` 5. These are hand-rolled versions, which is what a compiler would emit anyway.
- 13 keys have a literal `??` / `||` fallback; 2 read a `@fnMemo` argument.

Getter and method bodies (274):

| Verdict | Count |
| --- | --- |
| static | 136 |
| static + iteration over a `self` collection | 39 |
| dynamic | 96 |
| constant | 3 |

- Dynamic reasons: method call 78, iteration 58, loop 26, computed key 13. The top callees are id lookups (`memberById`, `valueById`, `resolveRecordById`, `classById`) and `_backing.read()`.
- 218 body reads go to another `@memo` / `@select` getter, so composition is getter-to-getter; a compiler composes those as version dependencies without re-tracking.
- 105 of 256 keyed members are fully static in both key and body. Of the 891 undecorated getters that keys and bodies read through, 643 are static, 31 static + iteration, 115 dynamic, 102 constant, so a transitive pass would raise the fully-static count well above 105.

Reading: about 80% of Neo's key functions and 64% of bodies (static or
static + iteration) are lexically resolvable today, before any transitive
analysis of the plain getters and revision helpers they call. The remaining
dynamic surface is concentrated in id lookups and the `corpus()` /
`revision()` family, which are either computed keys (need a per-key version
map, which Retree already has in `@fnMemo`) or already explicit versions.

## 2. What would and wouldn't be faster (probe, 1,024 instances, median of 9)

### Reads

| Shape | ns per read |
| --- | --- |
| raw object (hoisted by V8, floor only) | 0.3 |
| ReactiveNode via proxy, today | 38 |
| ReactiveNode via latest view, today | 38 |
| compiled accessors | 7.9 |
| compiled accessors through a forwarding view | 8.3 |
| compiled accessors through `Object.create(node)` views | 139 |
| compiled accessors after `Object.create(node)` views exist | 129 |

A compiled scalar read is about 5x faster than the trap. The last two rows
are a V8 rule, not a Retree one: an object used as a prototype gets its own
unique map, so prototype-chained view shells make every read site that
sees many nodes megamorphic, and they also slow reads on the base node
itself. Identity must come from a shared view class per node class (all
views share one map and forward to the node), not from `Object.create`.

### Derived value after a write (write one field, read the memoized sum)

| Shape | ns per write + read |
| --- | --- |
| `@memo` with a 10-field key, today | 7,285 |
| `@select` auto-tracked with one listener, today | 4,477 |
| compiled static deps + version check | 5 |

This is the largest gap and it is not the trap: it is the key function
re-running ten tracked reads and comparisons, plus the write path below. A
static dependency list compiles to "is my cached version the node's
version", which is one integer compare.

### Writes (one scalar field)

| Shape | ns per write |
| --- | --- |
| raw object | 1 |
| plain object node via proxy, today | 724 |
| ReactiveNode, fields only, no listener, today | 1,800 |
| ReactiveNode, fields only, one listener, today | 1,774 |
| ReactiveNode, fields only, 1,000 writes per transaction, today | 1,584 |
| ReactiveNode with a `@memo` getter, today | 1,818 |
| ReactiveNode with a `@select` getter and one listener, today | 4,072 |
| compiled setter, no listener | 3.7 |
| compiled setter, listener + forwarding view + change record | 7.5 |
| compiled setter, listener + `Object.create` view + change record | 444 |

Profile of the 1.8 µs ReactiveNode write (3M writes, self time):

| Where | Share |
| --- | --- |
| set trap body (compare, change record, `Reflect.defineProperty`) | 20% + 5% |
| garbage collector | 12% |
| pending-transaction flush and ReactiveNode lifecycle (`_nodeChangeListener`, `runTransaction`, `runPendingTransactions`, `handleReactiveNode`, `scheduleReactiveNodeLifecycle`) | ~25% |
| re-reading `dependencies` and select dependencies during handling (`get` trap, `readReactiveNodeGetter`, `getReactiveSelectDependencies`, `getReactiveNodeDependencyCollection`) | ~12% |
| handler lookups (`getCustomProxyHandlerFromMetadata`) | 5% |
| reproxy and snapshot versions | 2% |

Trap dispatch is a few percent of a write. A compiler that only replaces
traps leaves writes where they are. Writes get faster only if the
compiler also owns the write bookkeeping: a static `dependencies` list
(no re-reading the getter on every change), one version bump per node,
change records only when a listener or undo history needs them, and no
internal transaction wrapper per write. The compiled row above does all of
that and lands at 7.5 ns with a listener; a design that keeps undo history
and transactions would sit somewhere between 7.5 ns and a few hundred.

### Materialization (push 2,000 fresh rows, read one field each, x50)

| Shape | ns per row |
| --- | --- |
| ReactiveNode rows via Retree, today | 2,737 |
| compiled rows: construct + parent link + list version | 73 |

A compiled node is the raw object, so there is no Proxy, no handler, no
key-role lookup, and no metadata WeakMap per node. Neo's largest measured
costs (per-row materialization on mount) are here.

### Identity per change

| Shape | ns per identity |
| --- | --- |
| forwarding view (`new View(node)`) | 10.6 |
| `Object.create(node)` shell | 25.8 (and poisons reads, see above) |
| 10-field snapshot copy | 9.1 |

Today's reproxy is inside the 1.8 µs write above (about 2% of it), so
identity is cheap either way. The forwarding view keeps React.memo
semantics (fresh identity per change, same slots) at one small allocation.

## 3. What a compiler would not speed up

- Plain object and array children. A compiled `ReactiveNode` still holds
  `rows: Row[]`; the array is either a proxy (today's read wrappers already
  walk it raw) or a compiled list class, and plain `{ x, y }` children
  stay proxied unless the compiler also emits a class for them.
- Dynamic reads: computed keys (`byId[id]`, `map.get(id)`), loops whose
  element reads depend on data, and calls into methods the compiler cannot
  see. The scan puts 96 of 274 bodies there. These keep dynamic tracking or
  a per-key version map (what `@fnMemo` does now).
- Reads through `@ignore` fields and plain objects (39 keys, 24 bodies).
  They are untracked today and would be untracked after compiling.
- Reads inside a tracked run. Tracking cost is per read regardless of how
  the read is served; only static dependency extraction removes it, and
  only for the static share.

## 4. Recommended shape

1. Compile `ReactiveNode` subclasses to prototype accessors over a slot
   record with a tracking-frame check, plus a generated forwarding view
   class per node class. Reads 38 to 8 ns, materialization 2.7 µs to under
   100 ns, identity 10 ns.
2. Emit static dependency lists for the ~80% of keys and ~64% of bodies
   the scan already resolves, with version-compare memo cells. Fall back to
   today's dynamic tracking per member, not per class.
3. Move write bookkeeping into the generated setter: version bump, change
   record only when observed, no per-write internal transaction, no
   re-reading `dependencies`. This is where the write cost lives; the trap
   is not.
4. Keep the scan rule as a real ESLint rule that reports "this member would
   fall back to dynamic tracking because of X", so Neo can see the dynamic
   surface shrink as code moves to static shapes.

Next measurement: hand-compile one real Neo VM (a `MemberValueNodeVM`
subclass, keys through `projectVM` getters) and run it under the Neo
benchmark rig against the decorated original.
