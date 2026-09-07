# `@retreejs/babel-plugin-compiler`

Babel plugin that compiles `ReactiveNode` subclasses into managed classes so
their instances skip the Proxy path. Every member Retree tracks becomes a
literal accessor on a per-class prototype, which keeps V8 inline caches
monomorphic. Nodes keep the same identity contract: a stable base identity
plus a fresh view identity per change.

## Install

```bash
npm install --save-dev @retreejs/babel-plugin-compiler
```

Running `npm create @retreejs@latest` offers the compiler as an opt-in
(`--compiler`) and can add it to a JSON Babel config for you.

## Setup

Add the plugin **before** the decorators plugin so it sees `@memo`, `@ignore`,
and `@link` before they are lowered:

```json
{
    "presets": ["next/babel"],
    "plugins": [
        "@retreejs/babel-plugin-compiler",
        ["@babel/plugin-proposal-decorators", { "version": "2023-11" }]
    ]
}
```

The emitted code imports from `@retreejs/core/compiler-runtime`, so the
installed `@retreejs/core` must match the compiler's peer range.

## What compiles

A class compiles when it extends `ReactiveNode` imported from a core module,
extends a class in the same file that does, extends a class listed in
`bases`, or applies any Retree decorator. For each compiled class the plugin
emits a managed class with:

-   reactive fields, `@ignore` fields, and `@link` fields as accessors that
    call the same runtime paths the Proxy traps use;
-   methods bound to the managed node, and prototype getters that run under
    the same dependency tracking;
-   `@memo(fn)` getters whose selector is an array of literals or member
    chains on the parameter, compiled to inline key reads with a
    write-version fast path (other selectors stay on the runtime decorator).

Classes with `#private` members, `accessor` fields, or computed keys stay on
the Proxy path. The first instance of a compiled class completes its schema
at runtime: fields of an uncompiled base class (one from another package)
and properties assigned in a constructor get accessors too. Later instances
whose decorator keys or own keys differ from that first instance fall back
to the Proxy path with a dev warning.

## Options

```json
[
    "@retreejs/babel-plugin-compiler",
    {
        "coreModules": ["@retreejs/core"],
        "bases": ["BaseViewModel"],
        "runtimeModule": "@retreejs/core/compiler-runtime"
    }
]
```

-   `coreModules` lists the module specifiers that export `ReactiveNode` and
    the decorators. Add your own re-export module here.
-   `bases` names base classes from other files whose subclasses should
    compile even when they use no decorator.
-   `runtimeModule` overrides where the emitted helpers are imported from.

## Limitations

Fields of a compiled node live on the raw object behind prototype accessors,
so `Object.keys`, spread, `for...in`, and `Object.hasOwn` on a managed node
do not see them. Use `Retree.raw(node)` for those. `JSON.stringify` works:
compiled classes get a default `toJSON` that snapshots every declared field
unless the class defines its own. `delete node.field` and
`Object.defineProperty` on a managed node are not supported.

Assigning a key the class does not declare (`node.extra = 1`,
`Reflect.set(node, ...)`) lands on the managed object instead of the raw
node, so views and serialization never see it; declare the field or assign
on `Retree.raw(node)`. Dev builds warn when a view is created for such a
node, and `Retree.move` throws when its destination is a compiled node with
no such field.

Test spies work on methods and on arrow-function fields
(`vi.spyOn(node, "handler")`). Getters and methods replaced on a live
prototype after the class was defined are picked up for compiled classes;
getters inherited from an uncompiled base are captured when the class is
defined.
