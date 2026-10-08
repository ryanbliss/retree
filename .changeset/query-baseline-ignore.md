---
"@retreejs/query": patch
---

Fixed an "already has a structural parent" error when a query reused a backend-cached result after an overlapping optimistic update rolled back.
