---
"@retreejs/core": patch
---

Materializing plain objects and arrays does less work per node. Each handler now stores its parent edge in two fields instead of a separately allocated record, a fresh node's field walk no longer looks up the registry for plain children (a plain object or array that is already managed elsewhere attaches on its first read, with the same structural-cycle check), fresh arrays are walked by index instead of through `Object.keys`, element reads skip the array method tables when the key starts with a digit, and the children-cache prototype is no longer frozen, which had forced V8's slow path for every index-keyed store. First traversal of a deep plain tree is about 13% faster, a 10k-row table about 16%, and the steady-state churn of fresh rows into a large mounted tree about 14%, all measured against the private-field registry.

One observable change: a structural cycle through plain objects is now rejected when the closing edge itself is first read rather than when its holder is. `Retree.root(input)` with `input.self = input` no longer throws at `root()`; the first read of `root.self` throws instead. Class instances and collections still attach eagerly.
