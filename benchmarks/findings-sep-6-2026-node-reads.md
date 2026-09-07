# Findings September 6, 2026 — scalar reads against the engine floor

Context: the array read fast paths (`findings-sep-6-2026.md`) left the
callback's own field read (`row.id`) as the remaining cost and called it a
~70 ns floor. This pass measures that read next to the engine floor (the
same loop over the raw object, an empty `Proxy`, and a trivial get trap) to
see how much of it is Retree's trap body and how much is `Proxy` dispatch.

## Method

`benchmarks/node-reads.mts`, run with `npm run benchmark:node-reads`
(production source bundle, `--expose-gc`, GC outside the timed samples),
M3 Max, node 22. Ten scalar fields read 180k times per sample (1.8M reads);
median of nine samples. The ReactiveNode has ten fields, a method, and one
plain child, the Sep 5 platform shape.

The Sep 6 array read numbers were taken inside vitest, which runs this same
loop 2x to 3x slower than the production bundle (the vite transform, not
Retree). Those numbers are right relative to each other and wrong in
absolute terms; from here on standalone probes are the absolute reference.

## Where a read goes (before this change)

| 1.8M scalar reads | median | per read |
| --- | --- | --- |
| raw object | 5 ms | folded by the JIT |
| empty `Proxy` (no traps) | 18 ms | 10 ns |
| trivial get trap (`Reflect.get`) | 44 ms | 24 ns |
| Retree plain node, base or view | 55 ms | 31 ns |
| Retree ReactiveNode, base or view | 87 ms | 48 ns |

A plain node read is 7 ns over a trivial trap, so its body is not the cost;
the Sep 5 conclusion holds there. A ReactiveNode read paid 17 ns more than
a plain one. Patching the built trap one branch at a time attributed it:

- `readReactiveNodeProperty` on every read: 13 ns. It ran an unproxied
  lookup (a sentinel-symbol miss up the prototype chain), a
  `getPrototypeOf`, and a `WeakSet` check to decide whether the read might
  be a getter that needs a memo-getter frame, for data fields too.
- Two `Set.has` checks (collected keys, linked keys): 7 ns.
- The `RETREE_` prefix check: nothing measurable.

## What changed

A managed ReactiveNode's handler builds one `ReadonlyMap` of key roles when
it is created: `@ignore` keys, `@link` keys, and the prototype's getters.
Decorators fill the key sets while the instance constructs, so the roles
are fixed by the time a node is managed. Both get traps do one lookup; a
key without a role is a plain read. Only a key with the getter role enters
the memo-getter reader, which no longer resolves the unproxied instance
(its argument is always raw). Collected keys keep precedence over linked
and getter keys, matching the order the traps checked before.

The handler gains one field (8 B per node). ReactiveNode instances keep
their key sets; the write, define, delete, and own-keys paths still read
them directly.

## Measurements

| 1.8M scalar reads | before | after |
| --- | --- | --- |
| ReactiveNode via base | 87.6 ms | 67.4 ms |
| ReactiveNode via view | 86.0 ms | 66.7 ms |
| plain via base | 55.7 ms | 57.0 ms |
| plain via view | 55.1 ms | 57.5 ms |
| 50k row scan (`id`, `done`) via base | 12.6 ms | 13.2 ms |
| 50k row scan via view | 13.4 ms | 13.3 ms |
| 50k `map(row => row.id)` via base | 2.7 ms | 2.7 ms |
| 50k `map(row => row.id)` via view | 2.5 ms | 2.7 ms |

ReactiveNode field reads drop 23%, from 48 ns to 37 ns. Plain reads and
the row probes are unchanged within the run-to-run wobble (about 3%),
which is expected: they never entered the ReactiveNode branch.

## What remains

The remaining 6 ns between a ReactiveNode read and a plain read is the one
`Map` lookup; a null-prototype record in its place measured slower (71 ms).
The 7 ns between a plain read and a trivial trap is the handler's own
branching and is already at the shape the Sep 5 fast-path experiment could
not improve. Everything under that, 24 ns per read, is `Proxy` dispatch and
V8's post-trap invariant check, which no trap body can remove. The array
callback floor from Sep 6 is therefore about 31 ns per field read on plain
rows, not 70, and the only lever left on it is a read path with no `Proxy`
at all: the ReactiveNode compiler or accessor direction, which stays a
separate discussion.
