---
"@retreejs/core": patch
---

Normalize nested managed references in new input so raw trees remain proxy-free before their children are read. Reuse the existing managed identity when rooting an already-managed raw object.

Keep plain ancestors lazy when an input contains an existing managed leaf, so deep inputs do not enter recursive proxy construction.
