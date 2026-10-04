---
"@retreejs/core": patch
---

Built-ins that keep their state in internal slots are now leaves, so reading them from a tree works.

A `DOMException` stored in a tree threw on `error.message` ("Illegal invocation" in browsers, `ERR_INVALID_THIS` in Node) because Retree proxied it and its accessors reject a proxy as `this`. The same broke `URL`, `Blob`, `RegExp`, typed arrays, `AbortController`, `Promise`, and other platform objects. Retree now stores these as-is, like frozen objects: reads return the object itself, and assigning a new one notifies. `Retree.root` rejects them because a root must be a node.
