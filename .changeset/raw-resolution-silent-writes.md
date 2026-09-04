---
"@retreejs/core": patch
"@retreejs/react": patch
---

Keep raw child lookup correct after silent structural writes by validating its slot index against write history instead of React render versions. Unrelated writes reuse the index; unknown or expired history triggers a conservative rebuild.
