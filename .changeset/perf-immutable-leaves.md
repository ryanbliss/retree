---
"@retreejs/core": minor
---

Frozen objects (`Object.isFrozen`) stored in a tree are immutable leaves: stored and returned as-is, never proxied, with replacement as the change signal. This covers plain objects, arrays, class instances, Map and Set values, and array elements. Nothing beneath a frozen object was reactive before (its properties cannot change); now the object itself is a leaf too, so reads run at raw speed and allocate no node. `Retree.root` rejects a frozen object with a precise error.
