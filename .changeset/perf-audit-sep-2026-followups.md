---
"@retreejs/core": patch
---

Store the parent handler on each node's parent edge so `treeChanged` notification, listener precheck, and snapshot-version walks read ancestors without a proxy trap per level. Tracked reads now record one self-validating entry per property, presence, or keys read: the entry doubles as its comparison accessor and validator, the owner handler comes from the trap instead of a second proxy lookup, and `{ node, comparisons }` dependency values and memo source lookups are built only when a consumer asks for them.
