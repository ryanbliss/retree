---
"@retreejs/core": patch
---

Store each managed node's base and current view in one record. Invalidate unobserved ancestor identities on writes and create their views on first read. Observers and intermediate transaction reads still receive fresh identities. Retained views share the base node's live parent edge across adoption and detachment.
