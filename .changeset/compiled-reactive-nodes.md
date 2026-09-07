---
"@retreejs/core": minor
"@retreejs/babel-plugin-compiler": minor
---

Add `@retreejs/babel-plugin-compiler`, a Babel plugin that compiles `ReactiveNode` subclasses into managed classes with literal accessors so their instances skip the Proxy path with support for reactive, `@ignore`, and `@link` fields, bound methods, tracked getters, `@memo`/`@select`/`@fnMemo`, undo history, transactions, and the stable-base plus per-change view identity contract. `@memo` getters use the existing memo runtime to preserve selector tracking, decorator composition, and live prototype replacements.

`@retreejs/core` gains the `@retreejs/core/compiler-runtime` entry the emitted code imports from. Instances whose decorator key set or own keys disagree with the compiled schema fall back to the Proxy path with a development warning.

Compiled instances with symbol-keyed own properties fall back to proxies. Moving to an undeclared compiled field fails before detaching the child from its original parent.

The optional compiler runtime registers handler subclasses through a dependency-free registry. Core no longer imports the compiler runtime, and ordinary handlers do not carry compiler state. Compiled mutations and function binding reuse the proxy implementation.

Install reactive dependency subscriptions as one transaction so synchronous cached query results reach all dependencies. Recursive listener cleanup traverses compiled fields correctly.
