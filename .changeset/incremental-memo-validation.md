---
"@retreejs/core": patch
---

Make unchanged automatic memo reads constant-time when all reads have managed owners. Validate only recently written owners, retain dependency replay values, and fall back to full validation for silent writes and bounded-history overflow. Ignored data and unscoped getters retain their validation behavior.

Track returned managed-node identities as well as property owners so terminal child reads invalidate correctly. Fall back to full validation when WeakRef is unavailable, preserving ordinary writes in those runtimes.
