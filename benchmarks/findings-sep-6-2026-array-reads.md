# Findings September 6, 2026 — remaining array read methods

Context: the array read fast paths (`findings-sep-6-2026.md`) wrapped the
callback methods and iteration and left `indexOf`, `includes`, `slice`,
`at`, `flatMap`, `entries`, and `keys` on the bound native, which still
pays a `has` and a `get` trap per element. This pass wraps those seven the
same way and measures each next to the raw array.

## What changed

`internals/array-read.ts` now also serves:

- `indexOf` and `includes`: a primitive search compares raw slots and never
  resolves an object element, since an object can only match an object.
  An object search resolves each object slot to the identity the read path
  serves (base proxy from the base, latest view from a view) and compares
  that, exactly what the native saw through the trap. `indexOf` skips
  holes; `includes` reads them as `undefined` and uses SameValueZero, so
  `includes(NaN)` matches. Negative and out-of-range `fromIndex` clamp
  like the spec's `ToIntegerOrInfinity`.
- `slice`: a raw walk over the clamped range into a fresh array, holes
  preserved.
- `at`: one resolved element, negative indices from the end.
- `flatMap`: one level, like the native; a returned array's present
  elements are read through whatever it is, so a returned Retree list
  still resolves its elements the way its own proxy does.
- `entries` and `keys`: the same hand-rolled iterator as `values`, keyed by
  what each step yields; `keys` never reads an element.

Under tracking every method records one `length` read and one read per
visited element, as before. A tracked walk now also records a hole as an
`undefined` read at its index, so filling a hole invalidates a selector
that skipped it; the Sep 6 wrappers recorded nothing for holes.

## Measurements

`benchmarks/array-reads.mts`, run with `npm run benchmark:array-reads`
(production source bundle, `--expose-gc`), M3 Max, node 22. 50k plain rows
`{ id, done, value: { classId } }` and a 50k number list under
`Retree.root`, every row materialized before timing; median of nine.
Before is the parent branch (#93); after is this branch. The raw column is
the same call on the unmanaged array.

| 50k elements | raw | before, base | after, base | before, view | after, view |
| --- | --- | --- | --- | --- | --- |
| `ids.indexOf(last)` | 0.01 ms | 8.70 ms | 0.16 ms | 8.77 ms | 0.16 ms |
| `ids.includes(last)` | 0.01 ms | 6.41 ms | 0.14 ms | 6.48 ms | 0.14 ms |
| `rows.indexOf(lastRow)` | 0.01 ms | 6.86 ms | 0.82 ms | 7.08 ms | 0.91 ms |
| `rows.slice()` | 0.05 ms | 4.07 ms | 0.76 ms | 4.00 ms | 1.05 ms |
| `rows.at(i)` × 50k | 0.05 ms | 10.38 ms | 4.66 ms | 10.39 ms | 4.65 ms |
| `rows.flatMap(row => [row.id, row.done])` | 1.84 ms | 8.77 ms | 5.37 ms | 9.03 ms | 5.39 ms |
| `for...of rows.entries()` | 0.15 ms | 7.78 ms | 4.35 ms | 7.91 ms | 4.04 ms |
| `for...of rows.keys()` | 0.03 ms | 3.05 ms | 1.16 ms | 2.99 ms | 1.16 ms |

Primitive searches drop 45x to 55x because nothing per element leaves the
raw array. An object search and `slice` still resolve every element (8x
and 5x). `at` is bounded by the trapped read of the method itself on every
call, about 90 ns, so a loop of `at(i)` gains 2.2x and no more. `flatMap`
and `entries` are bounded by the callback's or loop body's own `row.id`
read, the per-field floor measured in
`findings-sep-6-2026-node-reads.md`.

## What remains

Still on the bound native: `lastIndexOf`, `findLast`, `findLastIndex`,
`reduceRight`, `join`, `concat`, `flat`, `toSorted`, `toReversed`, `with`.
None of them has shown up in a workload; the search and walk helpers here
would serve them in a few lines each when one does.
