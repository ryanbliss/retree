---
"@retreejs/core": minor
---

Add `Retree.materializeAsync` to run bounded generator steps across host tasks. It preserves proxy and memo caches between slices, rejects stale or cancelled work, reports progress, and returns only the completed result.
