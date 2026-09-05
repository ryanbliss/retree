---
"@retreejs/core": patch
---

Retain active dependency records across lifecycle refreshes, preserve pending comparison baselines, and remove consumed entries from the prior-record lookup instead of building a second key set.
