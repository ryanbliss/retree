---
"@retreejs/core": patch
---

Three read-path trims measured against Neo's constructor replay, where Retree's cost is per-read overhead on millions of untracked reads.

Reading a `ReactiveNode` getter through a proxy no longer treats its result as a stored slot. A managed node the getter returns is served at its identity and a plain object it builds is served as built, instead of probing the result for proxy metadata and looking up an own-property descriptor the getter never has. This matches what compiled classes already did. Each handler also remembers whether its class uses keyless `this.memo(fn)`, so getter reads skip a per-read prototype lookup, and `@ignore` and `@link` reads of a managed node resolve its latest identity with one metadata probe instead of two.

The array callback wrappers (`forEach`, `map`, `filter`, `find`, `findIndex`, `some`, `every`, `reduce`, `flatMap`, `slice`) walk the raw array in their own loop instead of through a per-element visitor closure, and a primitive element is served straight from its slot without the hole check or the element resolver. Callback methods over lists of ids or numbers are about 40 to 55% faster; over lists of records about 5%.

Memo comparison snapshots no longer copy a comparison's captured values before normalizing them, and a value that is not an explicit `{ node, comparisons }` dependency is compared as itself without building a dependency slot for it.
