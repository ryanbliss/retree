---
"@retreejs/core": patch
---

`@fnMemo(keyFn)` entries for new arguments run their key function plainly and are probed for gating on the next read with the same arguments. A lookup whose arguments rarely repeat, such as a by-id resolver called across a whole document, was paying for a tracked key run on every call that nothing ever validated. A key element that is one of the call's arguments now counts as covered, since the entry already matched it, so `@fnMemo((self, id) => [self.rows, id])` gates once its arguments repeat instead of running its key on every read.
