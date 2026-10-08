---
"@retreejs/react": patch
---

A selector-only `useSelect` that reads `Retree.treeVersion(node)` now re-renders when a descendant of `node` changes, matching `Retree.select`. Before, it dropped writes to descendants the selector never read directly.
