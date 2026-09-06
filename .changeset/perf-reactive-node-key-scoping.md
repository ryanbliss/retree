---
"@retreejs/core": patch
---

Writes to a `ReactiveNode` field now skip tracked readers (`Retree.select`, `Retree.effect`, `useSelect`) that never read that field, the same key-scoped validation plain objects already had. Readers of plain getters are scoped by the fields the getter read, readers of `@memo` getters by the memo's dependency reads, and readers of `@select` getters by the fields the getter's last run read. An unrelated write on a view model with hundreds of readers no longer re-validates each of them or re-runs their getters.
