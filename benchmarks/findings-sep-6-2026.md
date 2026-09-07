# Findings September 6, 2026 — array read fast paths

Context: the July 10 findings (§4) noted that array read methods are bound to
the proxy, so `list.map(cb)` runs the native with a proxy as `this` and pays a
`has` trap and a `get` trap per element plus V8's post-trap invariant check
on each. The Sep 5 platform findings concluded the trap body is not the cost;
dispatch is. This branch serves the common read methods from wrappers that
walk the raw array and resolve each element the way the get trap would, so
callers see the same values and identities without the per-element dispatch.

## What changed

`internals/array-read.ts` wraps `forEach`, `map`, `filter`, `find`,
`findIndex`, `some`, `every`, `reduce`, `values`, and `Symbol.iterator`
(so `for...of`, spread, and `Array.from` also benefit). Both get traps serve
the wrapper when the raw array is a plain `Array` whose method is the
untouched native; array subclasses and overridden methods stay on the bound
native so species and overrides keep their behavior.

Per element the wrapper reads the raw slot, then:

- a cached child comes back as its base proxy (base path) or latest view
  (view path), exactly what the two get traps return;
- an uncached object goes through the handler's stored-object resolver, so
  first-touch materialization, parent edges, and stored-proxy adoption are
  unchanged;
- a primitive is returned as-is.

The callback's array argument and `this` are the proxy the method was read
from (the latest view on the view path, matching the bound-native path).
Wrappers are cached per handler and method like the bound natives were.

Dependency tracking records the same reads the trap path recorded: one
`length` read and one property read per element. Two intentional
differences:

- The native's per-element `HasProperty` no longer records a key-presence
  read. Presence of index `i` is implied by the `length` read and the
  element read together (a hole created by `delete` changes the element
  read's value), so nothing observable is lost.
- The iterator records `length` once per iteration instead of once per
  `next()` call, which is what the native iterator did through the trap.

## Measurements

M-series laptop, node 22, `packages/retree-core/src/array-read-perf-probe.spec.ts`
run with `--no-file-parallelism --disable-console-intercept`. 50k plain rows
`{ id, done, value: { classId } }` under `Retree.root`, every row materialized
before timing. Each cell is the median of nine runs; two samples per column,
taken serially with the branch's internals stashed for the main samples.

| Read (50k rows) | main | branch |
| --- | --- | --- |
| `map` via raw | 0.39 / 0.37 ms | 0.38 / 0.36 ms |
| `map` via base | 8.19 / 8.07 ms | 3.61 / 3.74 ms |
| `map` via view | 8.38 / 8.03 ms | 4.37 / 4.51 ms |
| `filter` via base | 8.25 / 8.03 ms | 3.97 / 4.00 ms |
| `filter` via view | 8.40 / 8.20 ms | 4.50 / 4.65 ms |
| `forEach` via base | 7.92 / 8.10 ms | 3.59 / 3.59 ms |
| `forEach` via view | 8.17 / 7.99 ms | 4.33 / 4.39 ms |
| `find` (last row) via base | 6.66 / 6.83 ms | 3.62 / 3.64 ms |
| `find` (last row) via view | 6.84 / 6.63 ms | 4.35 / 4.39 ms |
| `for...of` via base | 10.10 / 9.87 ms | 3.88 / 3.81 ms |
| `for...of` via view | 11.47 / 11.09 ms | 4.68 / 4.65 ms |
| tracked `map`, dependencies mode | 31.6 / 29.1 ms | 24.8 / 25.3 ms |
| tracked `map`, comparisons mode | 24.1 / 24.8 ms | 12.3 / 12.1 ms |

Untracked callback methods drop by 2.1x to 2.3x; `for...of` by 2.4x to 2.6x.
Comparisons-mode tracking halves because the presence reads and their
per-read bookkeeping are gone. Dependencies-mode tracking improves less
because its cost is dominated by the per-element record work that still runs.

## What remains

Every callback in the probe reads one field off its element (`row.id`), and
that read still dispatches through the element's proxy. At the measured
~70 ns per trapped scalar read (1.8M reads in 127 ms, Sep 5 platform
findings) that is ~3.5 ms of the ~3.6 ms branch floor. The wrappers removed
the list's share of the cost; the per-element field reads are the compiler /
accessor question and are out of scope here.

Not wrapped: `indexOf`, `includes`, `lastIndexOf` (argument identity must be
matched per read path), `slice`, `at`, `concat`, `flat`, `flatMap`, `join`,
`entries`, `keys`, `findLast`, `findLastIndex`, `reduceRight`, `toSorted`,
`toReversed`, `with`. They still work through the bound native; add them
when a workload shows them.
