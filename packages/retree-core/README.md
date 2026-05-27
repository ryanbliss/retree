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

`ReactiveNode` exposes a `memo` helper for caching the result of a computed getter, similar in spirit to React's `useMemo`. It also exposes `@fnMemo` for caching deterministic method return values. Four forms are supported:

```ts
import { Retree, ReactiveNode, fnMemo, memo } from "@retreejs/core";

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

    // 4) Function decorator form — compares method arguments plus deps.
    @fnMemo((self: ListFilter) => [self.list, self.searchText])
    filteredListLimited(limit: number): Card[] {
        return this.list
            .filter((c) => c.text === this.searchText)
            .slice(0, limit);
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

`deps` semantics (same for all forms; `@fnMemo` also compares method arguments and passes them to the `deps` function):

-   `undefined` → recompute whenever the `ReactiveNode` reproxies (any dependency changes or a property is set).
-   `[]` → compute once and cache forever for that instance.
-   `[a, b, ...]` → recompute when any cell shallow-changes (compared with `Object.is`). Tree-node cells are compared by their latest reproxy identity, so passing `this.list` correctly invalidates when `list` mutates.

The cache is per-instance (a `WeakMap` keyed by the unproxied `ReactiveNode`) and is GC'd with the node.

## React to observation and changes

`ReactiveNode` has lifecycle hooks for work that should happen when a node is observed, unobserved, or actually changed:

-   `onObserved()` runs when the node gets its first active `nodeChanged` or `treeChanged` observer.
-   `onUnobserved()` runs when the node loses its last active `nodeChanged` or `treeChanged` observer.
-   `onChanged()` runs after the node receives a fresh reproxy because one of its own properties changed or one of its declared dependencies changed.

Use `onObserved()` for setup that needs the proxied instance, such as starting an external subscription that writes back into Retree state. Keep `dependencies` declarative; it should describe dependency nodes and comparison values, not start subscriptions or perform synchronization.

```ts
import { ReactiveNode, ignore } from "@retreejs/core";

declare function subscribeToValue(
    callback: (value: string) => void
): () => void;

class SubscriptionNode extends ReactiveNode {
    public value: string | null = null;
    @ignore private unsubscribe: (() => void) | null = null;

    get dependencies() {
        return [];
    }

    protected onObserved(): void {
        this.unsubscribe = subscribeToValue((value) => {
            this.value = value;
        });
    }

    protected onUnobserved(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
```

`onChanged()` is useful for synchronizing derived state after Retree knows a change really happened. Retree runs it before listener callbacks flush. If no transaction is already active, Retree starts one so state updates made in `onChanged()` are bundled with the change that triggered it.

```ts
class SearchNode extends ReactiveNode {
    public query = "";
    public normalizedQuery = "";

    get dependencies() {
        return [];
    }

    protected onChanged(): void {
        const next = this.query.trim().toLowerCase();
        if (this.normalizedQuery === next) {
            return;
        }

        this.normalizedQuery = next;
    }
}
```

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

See the [useNode React hook](https://github.com/ryanbliss/retree/blob/main/packages/retree-react/src/useNode.ts) or [example 01 project](https://github.com/ryanbliss/retree/tree/main/samples/01.core-example) for more example usages.

## Docs

Docs are hosted at https://ryanbliss.github.io/retree/.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
