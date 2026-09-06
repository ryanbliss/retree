---
"@retreejs/core": patch
---

Stop walking raw input up front. `Retree.root(...)` and every write path used to visit each object in the new input to reject structural cycles and unwrap embedded proxies, which made `root()` linear in the size of plain data that is otherwise proxied lazily (57 ms for 50k rows). Both checks now run where an edge is materialized: a cycle throws when its closing edge is built or first read, and a managed node stored as a proxy inside plain input is unwrapped when its holder is first read. Locked data properties keep their exact stored value.

One pattern the old walk let through now throws: a plain field on a new child that points back at an ancestor already in the tree (a dialog view model holding its page). The walk skipped nodes it had already normalized, so that edge silently became a shared, non-owning reference; it is now rejected at the closing edge like every other structural cycle. Mark such back-references `@ignore` or `Retree.link`.
