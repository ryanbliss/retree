---
"@retreejs/core": patch
---

Reuse Map and Set method wrappers across reads and views, reducing repeated method allocation without changing collection types. Custom method replacements invalidate the cached wrapper.
