---
"@retreejs/core": patch
---

Calling a `Retree.on` unsubscribe after `Retree.clearListeners` already removed that listener no longer runs the node's `onUnobserved` a second time.
