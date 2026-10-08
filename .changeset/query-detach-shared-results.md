---
"@retreejs/query": patch
"@retreejs/convex": patch
---

Queries no longer adopt the objects a source emits, so two queries can share one cached result.

Two queries that received the same cached result threw "Retree cannot assign this node because it already has a structural parent". Rows added during reconciliation were also shared between queries, so editing one query changed the other. Query state now holds its own copies, including of `initialState`. Frozen objects and opaque built-ins are still shared, and reconciliation copies only the rows and fields it writes.

Custom reconcilers should not write objects from `next` into `current` directly. Use `reconcileArray`, or return a replacement value; it is copied, except for rows reused from `current`.
