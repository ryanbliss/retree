---
"@retreejs/core": patch
---

Stop walking raw input up front. `Retree.root(...)` and every write path used to visit each object in the new input to reject structural cycles and unwrap embedded proxies, which made `root()` linear in the size of plain data that is otherwise proxied lazily (57 ms for 50k rows). Both checks now run where an edge is materialized: a cycle throws when its closing edge is built or first read, and a managed node stored as a proxy inside plain input is unwrapped when its holder is first read. Locked data properties keep their exact stored value.
