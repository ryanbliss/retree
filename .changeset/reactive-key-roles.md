---
"@retreejs/core": patch
---

Field reads on a `ReactiveNode` do one lookup in a per-node map of key roles (`@ignore`, `@link`, getter) built when the node is managed, instead of two key-set checks plus memo-getter bookkeeping on every read. Only getters enter the memo-getter reader. ReactiveNode field reads through the base proxy or a view are about 23% faster (48 to 37 ns per read); plain node reads are unchanged.
