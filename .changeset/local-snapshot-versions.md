---
"@retreejs/core": patch
---

Keep direct snapshot writes constant-time after the first root lookup. Settle subtree versions only when their root is read, coalesce shared ancestor work, and cache tree-listener paths. Preserve pending versions across moves and detachments without enabling expensive writes through unrelated listeners.
