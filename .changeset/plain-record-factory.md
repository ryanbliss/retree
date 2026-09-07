---
"@retreejs/core": patch
---

Allow optional handler factories for plain records and reuse compiled read helpers with base handlers. This supports the benchmark-only fixed-shape materialization experiment; ordinary records continue to use proxies unless a factory is explicitly registered.
