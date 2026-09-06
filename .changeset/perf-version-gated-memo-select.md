---
"@retreejs/core": patch
---

`@memo(keyFn)` and `@fnMemo(keyFn)` no longer evaluate their key function on every read. The key function's reads are tracked and validated like a trapped memo's body, so it runs again only after a write to something it read; a memo keyed on three levels of memos now reads in 0.7 µs instead of 16 µs. Auto-trapped `@select` getters cache their last run per instance and return the same value until a read they made changes, so a filter over 1000 rows costs 0.4 µs per repeated read instead of 180 µs and React consumers see a stable identity. Key functions and trapped getters are expected to be deterministic over tree state; a key element that is not a tracked read, or a key function or getter that read past the traps (`Retree.untracked`, `Retree.raw`, an unmanaged object behind `@ignore`), keeps the old evaluate-every-read behavior.
