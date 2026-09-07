---
"@retreejs/core": minor
"@retreejs/babel-plugin-compiler": minor
---

Add `@retreejs/babel-plugin-compiler`, a Babel plugin that compiles `ReactiveNode` subclasses into managed classes with literal accessors so their instances skip the Proxy path while keeping every `ReactiveNode` feature: reactive, `@ignore`, and `@link` fields, bound methods, tracked getters, `@memo`/`@select`/`@fnMemo`, undo history, transactions, and the stable-base plus per-change view identity contract. `@memo` getters with static key selectors compile to inline key reads with a write-version fast path.

`@retreejs/core` gains the `@retreejs/core/compiler-runtime` entry the emitted code imports from. Instances whose decorator key set or own keys disagree with the compiled schema fall back to the Proxy path with a development warning.
