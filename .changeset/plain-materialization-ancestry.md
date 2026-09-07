---
"@retreejs/core": patch
---

Avoid redundant ancestor walks when first materializing unmanaged plain children. Deep plain-object traversal scales linearly for fresh nodes while existing-node and reparenting cycle checks remain in place.
