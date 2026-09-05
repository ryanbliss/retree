---
"@retreejs/core": minor
---

Reads return one identity per node whatever the receiver. A child read through a base proxy, a view, `Retree.parent`, or a chaining mutator (`sort`, `Map.set`, `Set.add`) now resolves to the node's latest identity: its view once it has changed, its base proxy until then. Two reads of a node are `===` exactly while no change to that node happened between them, so hand-rolled caches no longer need to normalize identities across read contexts. The `Retree.root()` handle and a method's `this` stay the receiver you used; compare `Retree.raw(node)` when you need an identity that survives writes. New `Retree.version(node)` and `Retree.treeVersion(node)` expose the node's own-field and subtree versions as numbers for cache keys; both accept a managed node or its raw object.
