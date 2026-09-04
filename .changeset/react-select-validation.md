---
"@retreejs/react": patch
---

Validate changed tracked dependencies before rerunning useSelect selectors. Unrelated field writes reuse the previous selection while relevant changes and dependency replacements remain observable.
