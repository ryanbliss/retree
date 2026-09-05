---
"@retreejs/core": patch
"@retreejs/react": patch
---

Resolve base proxies and raw nodes in one proxy trap, walk `treeChanged` ancestors over handler metadata without per-level allocations, and refresh retained `ReactiveNode` dependency records in place while sharing one record between the dependency and dependent registries. Reuse a dependent's current dependency collection after its notification reproxy instead of collecting twice per related write, and drain deferred lifecycles with one live iterator.

Tracked `Retree.select`, `Retree.effect`, and `useSelect` read their subscription sources and comparison cells from the tracking pass itself instead of re-normalizing every dependency through proxy traps on each run.
