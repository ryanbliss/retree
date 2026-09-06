---
"@retreejs/core": patch
---

The children cache stores each child's base handler instead of its proxy, so a child read through a view resolves the child's latest identity from the handler without a sentinel trap: 200k child reads through a view model's view drop from 16.7 ms to 11.4 ms, and scalar reads through either proxy get a smaller get trap. What a read returns is unchanged. New `Retree.version(node)` and `Retree.treeVersion(node)` expose the node's own-field and subtree versions as numbers for cache keys; both accept a managed node or its raw object.
