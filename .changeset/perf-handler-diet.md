---
"@retreejs/core": patch
---

Each managed node now costs about a third less heap. The base handler records what its node is (plain object, array, `ReactiveNode`, Map, Set, or Date) as one `kind` field instead of five, its four lazily built caches share one slot, and the children cache is a fast-mode object with an empty prototype instead of a dictionary-mode `Object.create(null)`. Read speed is unchanged.
