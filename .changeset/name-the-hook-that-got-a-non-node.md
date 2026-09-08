---
"@retreejs/core": patch
"@retreejs/react": patch
---

`useNode`, `useTree`, `useRaw`, `useSelect`, and `Retree.select` now name themselves when they receive a value that is not a Retree node.

Passing an unmanaged value to one of these APIs used to throw Retree's internal invariant, which reported an unproxied object and asked the caller to file a Retree issue — even though the value came straight from application code. The error now names the API that received it and what arrived instead, for example: `useRaw: expected a Retree-managed node but received an unmanaged array. Pass an object returned by Retree.root(...) or read a child from an existing Retree tree.` The internal invariant still covers values that reach the base-proxy lookup through an internal path.
