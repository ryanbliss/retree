---
"@retreejs/core": patch
---

A `@memo` or `@fnMemo` read inside `Retree.untracked` no longer subscribes the surrounding selector or effect to its key's reads. Before, a memo whose key had to re-run (on its first read, or after a key input changed) leaked those reads, so whether a selector stayed asleep depended on what had warmed the memo.
