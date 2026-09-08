---
"@retreejs/core": patch
"@retreejs/react": patch
---

An explicit `equals` now decides whether the tracked forms of `Retree.select` and `useSelect` notify.

When a tracked selector re-ran because a dependency changed, both forms notified (and `useSelect` re-rendered) even when the `equals` option reported the previous and next selections equal. The dependency check existed so a selector returning a stable node reference still notifies when that node's content changes; it now applies only to the default comparison. With `equals` supplied, a re-run whose result compares equal keeps the previous reference and stays silent, which is what lets a component select a derived value such as a sorted order and re-render only when that order changes.
