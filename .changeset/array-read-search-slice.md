---
"@retreejs/core": patch
---

`indexOf`, `includes`, `slice`, `at`, `flatMap`, `entries`, and `keys` on a managed list also walk the raw array. A primitive search compares raw slots; an object search compares the identity the read path serves (base proxy from the base, latest view from a view), exactly what the trapped native saw. `includes` uses SameValueZero and reads holes as `undefined`; `indexOf` skips holes. At 50k elements a primitive `indexOf` or `includes` is about 50x faster, `slice` 5x, `at` 2x, `entries` and `keys` about 2x. A tracked walk now records a hole as an `undefined` read at its index, so filling it re-runs a selector that skipped it.
