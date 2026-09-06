---
"@retreejs/core": patch
---

`@memo(keyFn)` and `@fnMemo(keyFn)` entries whose key cannot be gated (a derived or literal element, or a key run that read past the traps) run their key function plainly again. Every read of such an entry was collecting tracked reads, snapshots, and a source map that nothing validated; on a view model with a few hundred keyed memos that tripled a constructor replay. An unscoped entry re-attempts scoping once after each recompute, so a key that becomes fully tracked in a later state still gates.
