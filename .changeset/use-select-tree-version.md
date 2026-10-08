---
"@retreejs/core": patch
"@retreejs/react": patch
---

A selector that reads `Retree.treeVersion(node)` now re-runs on every write under `node`.

Before, a selector-only `useSelect` dropped writes to descendants the selector never read directly, unlike `Retree.select`. And `useSelect`, `Retree.select`, `Retree.effect` and `@select` getters all skipped a write to a descendant's field when the selector also read a different field of that descendant.
