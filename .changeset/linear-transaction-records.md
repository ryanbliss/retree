---
"@retreejs/core": patch
---

Accumulate transaction change records in linear time and avoid scheduling unused ancestor payloads. Traverse deep tree listeners iteratively while preserving change order and React identities.
