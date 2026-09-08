---
"@retreejs/core": patch
---

Store each managed node's handler in a private field on the raw object instead of a module-level WeakMap. The WeakMap's ephemeron table rehashed after garbage collection, so the first materialization after any collection paid a stall proportional to every node ever managed. Registration is now constant cost, apps that keep a large tree mounted while data churns no longer see those stalls, and the raw object stays clean: private fields are invisible to key walks, spreads, JSON, `structuredClone`, and equality checks. The core package now compiles to ES2022 so the private field ships natively; bundlers that lower class private fields below ES2022 fall back to WeakMap helpers and keep the old cost.
