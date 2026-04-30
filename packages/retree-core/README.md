# Retree Core

Retree is a lightweight and simple state management library, specifically designed for frameworks like React. If you know how to work with objects in JavaScript or TypeScript, you pretty much already know how to use Retree.

## How to install

Install with `npm`:

xretree

```bash
npm i @evergreen/core
```

Install with `yarn`:

```bash
yarn add @retreejs/core
```

## How to use

Retree Core allows for easy observations of deeply nested values in any object. It is a general purpose package for JavaScript/TypeScript modules, though it is probably best paired with `@retreejs/react`.

```ts
import { Retree } from "@retreejs/core";
import { v4 as uuid } from "uuid";

class Todo {
    readonly id = uuid();
    public text = "";
    public checked = false;
    toggle() {
        this.checked = !this.checked;
    }
    delete() {
        // Get parent of the Todo, which is Array<Todo>
        const parent = Retree.parent(this);
        if (!Array.isArray(parent)) return;
        const index = parent.findIndex((c) => this.id === c.id);
        parent.splice(index, 1);
    }
}

class TodoList {
    public todos: Todo[] = [];
    add() {
        this.todos.push(new Todo());
    }
}

const tree = Retree.root(new TodoList());

// Listen for changes to the todo list (e.g., todo created)
const unsubscribe = Retree.on(tree.todos, "treeChanged", (todos) => {
    console.log("list updated", todos);
});
tree.todos.add();
tree.todos[0].toggle();
tree.todos[0].delete();
unsubscribe();
```

## Memoize computed getters

`ReactiveNode` exposes a `memo` helper for caching the result of a computed getter, similar in spirit to React's `useMemo`. Three forms are supported:

```ts
import { Retree, ReactiveNode, memo } from "@retreejs/core";

interface Card {
    text: string;
}

class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    // 1) Keyless method form — cache key is the getter's name.
    get filteredList(): Card[] {
        return this.memo(
            () => this.list.filter((c) => c.text === this.searchText),
            [this.list, this.searchText]
        );
    }

    // 2) Decorator form — same cache-key behavior; pass a function that
    //    returns deps so they're read live on every access.
    @memo((self: ListFilter) => [self.list, self.searchText])
    get filteredListDecorated(): Card[] {
        return this.list.filter((c) => c.text === this.searchText);
    }

    // 3) Explicit-key method form — required for multiple memos in one
    //    getter, or memoizing inside a method.
    get pair() {
        const filtered = this.memo(
            "filtered",
            () => this.list.filter((c) => c.text === this.searchText),
            [this.list, this.searchText]
        );
        const count = this.memo("count", () => filtered.length, [filtered]);
        return { filtered, count };
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

`deps` semantics (same for all three forms):

-   `undefined` → recompute whenever the `ReactiveNode` reproxies (any dependency changes or a property is set).
-   `[]` → compute once and cache forever for that instance.
-   `[a, b, ...]` → recompute when any cell shallow-changes (compared with `Object.is`). Tree-node cells are compared by their latest reproxy identity, so passing `this.list` correctly invalidates when `list` mutates.

The cache is per-instance (a `WeakMap` keyed by the unproxied `ReactiveNode`) and is GC'd with the node.

## Opt fields out of reactivity with `@ignore`

`@ignore` is a class-field decorator that excludes a property of a `ReactiveNode` from Retree's reactivity system. Reads and writes still work normally — what's skipped is listener emission. Nested mutations (`this.cache.foo = 1`) and top-level replacement (`this.cache = {...}`) both bypass `nodeChanged` / `treeChanged`, and the proxy will not wrap the field's value or build child proxies underneath it.

Use it for state that lives on a `ReactiveNode` but shouldn't participate in the tree — caches, scratch buffers, framework handles, references to objects already managed elsewhere, etc.

```ts
import { Retree, ReactiveNode, ignore } from "@retreejs/core";

class Counter extends ReactiveNode {
    public count = 0;
    @ignore public cache: Record<string, unknown> = {};

    get dependencies() {
        return [];
    }
}

const node = Retree.root(new Counter());
Retree.on(node, "nodeChanged", () => console.log("changed"));
node.cache.something = 1; // ❌ no log
node.count = 1; //            ✅ logs "changed"
```

**Caveat:** because the field's value isn't wrapped, you also lose `Retree.parent(...)` for objects stored under it, and they won't appear in `treeChanged` notifications. Treat ignored fields as opaque from Retree's perspective.

## Core samples

See the [useNode React hook](./packages/retree-react/src/useNode.ts) or [example 01 project](./samples/01.core-example/) for more example usages.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
