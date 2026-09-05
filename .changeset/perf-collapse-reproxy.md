---
"@retreejs/core": patch
---

Reproxy views now target the raw node instead of the base proxy, so a read, write, `in`, `Object.keys`, or `delete` through a view runs one trap instead of two. Property reads through a view of a `ReactiveNode` are about 4x faster, whole-array scans through a view about 2x. The per-node view record folds into the base handler.
