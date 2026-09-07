---
"@retreejs/core": patch
---

Native array read methods on a managed list (`forEach`, `map`, `filter`, `find`, `findIndex`, `some`, `every`, `reduce`, `values`, `for...of`, spread) walk the raw array instead of dispatching a `has` and a `get` trap per element. Callbacks still receive base proxies from the base proxy and latest views from a view, untouched elements still materialize on first read, and array subclasses or overridden methods keep the bound native. At 50k rows `map` and `filter` run about 2x faster and `for...of` about 2.5x; a tracked `map` under `Retree.select` about 2x. Tracked reads record the list's `length` and each element once, without a separate key-presence read per element.
