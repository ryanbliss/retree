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

## Select derived values

`Retree.select` subscribes to a derived value from any Retree-managed node and only calls your callback when that selected value changes. This is different from `memo` and `fnMemo`: memoization caches computation, while `select` narrows notifications.

```ts
const root = Retree.root({
    total: 20,
    taxRate: 0.08,
});

const unsubscribe = Retree.select(
    root,
    (invoice) => invoice.total * (1 + invoice.taxRate),
    (nextGrandTotal, previousGrandTotal) => {
        console.log({ nextGrandTotal, previousGrandTotal });
    }
);

root.total = 25;
unsubscribe();
```

By default, `select` listens to `nodeChanged` on the node you pass. This is best for selecting direct values owned by that exact node, including `ReactiveNode` values that emit when their dependencies change. Pass `listenerType: "treeChanged"` when the selector intentionally reads descendant nodes, and pass `equals` when the selected value is a new object or array that should be compared structurally.

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

## Prepare lazy ReactiveNode fields

`ReactiveNode` plain object and array fields are proxied lazily. That keeps root creation and setup cheaper, but the first read of a nested field pays the proxy cost. Call `prepareTree()` when you want to pay that cost during a controlled phase, such as while showing a loading spinner.

`prepareTree()` walks own data fields only. It skips computed getters like `dependencies` and skips fields marked with `@ignore`.

```ts
class LargeNode extends ReactiveNode {
    public sections = [{ title: "Intro", cards: [] }];

    get dependencies() {
        return [];
    }
}

const node = Retree.root(new LargeNode());
node.prepareTree(); // warm all reachable non-ignored child proxies
node.prepareTree({ depth: 0 }); // warm only direct object/array fields
```

You can also opt a node into automatic preparation when Retree proxies it:

```ts
class EagerNode extends ReactiveNode {
    constructor() {
        super({
            prepare: {
                autoPrepare: true,
                depth: 0,
            },
        });
    }

    public sections = [{ title: "Intro", cards: [] }];

    get dependencies() {
        return [];
    }
}
```

## Performance model

Retree is built on JavaScript proxies plus stable "base" proxies and fresh reproxy identities after changes. That model is ergonomic, but the cost is not uniform. The main rule of thumb is to subscribe and read as narrowly as your UI or workflow allows.

### Prefer narrow `nodeChanged` subscriptions

Use `nodeChanged` for hot paths and direct node ownership. Use `treeChanged` when you intentionally need descendant changes from a broad subtree, and treat it as a wider invalidation primitive.

```ts
Retree.on(todo, "nodeChanged", (nextTodo) => {
    console.log(nextTodo.checked);
});

Retree.on(todoList, "treeChanged", (nextList) => {
    console.log(nextList.todos.length);
});
```

`treeChanged` is most expensive when a listener also performs deep reads across the subtree, because the listener is asking Retree to propagate the ancestor change and then traverse the changed graph. If a selector or component only needs one derived value, prefer `Retree.select(...)` on the narrowest node that owns that value.

### Use `ReactiveNode.dependencies` as a narrow bridge

`ReactiveNode.dependencies` is a good way to make one node react to another node without subscribing a broad tree. Keep the getter deterministic and stable:

-   Keep dependency list length and order stable.
-   Use comparison values when only some changes should emit.
-   Avoid doing setup, network subscriptions, or synchronization inside `dependencies`; use `onObserved()`, `onUnobserved()`, and `onChanged()` for lifecycle work.
-   Prefer one dependency on a narrow child node over a dependency on a broad parent.

Retree shares dependency listeners for many dependent nodes that observe the same dependency node, but fan-out still has real work: every dependent may need comparison checks and a reproxy when it should emit.

### Understand preparation and collection costs

Plain object and array fields on `ReactiveNode` are prepared lazily. This makes initial root/proxy setup cheaper, and it avoids preparing subtrees that are never read. The first read of a lazy child pays that proxy preparation cost. If the app wants to pay that cost during a controlled phase, call `prepareTree()` or use `super({ prepare: { autoPrepare: true, depth } })`.

Assignments of new object, array, `Map`, or `Set` values still have work proportional to the values Retree must prepare or later read. Laziness mostly changes when that cost is paid:

-   Untouched assigned subtrees are cheaper because they are not prepared.
-   Touched assigned paths are prepared once on first access.
-   Broad loops that repeatedly create and immediately traverse fresh objects will still pay for those fresh objects.

### Listener fan-out and transactions

Each listener is work. Many listeners on the exact same broad node can be slower than fewer listeners on narrower children or selected values. For React, this is why `useNode(child)` and `useSelect(node, selector)` usually scale better than many components reading the same broad parent.

Use `Retree.runTransaction(...)` when multiple synchronous mutations are one logical update. It coalesces listener emission per node during the transaction. It does not make the mutations themselves free, and it is less useful when each mutation targets unrelated nodes that all need distinct notifications.

### Benchmark summary

In stable medium single-worker benchmark runs before and after the recent architecture work:

| Area                                 | Before avg ms | After avg ms | Before P95 ms | After P95 ms |
| ------------------------------------ | ------------- | ------------ | ------------- | ------------ |
| `runTransaction`                     | 3.881         | 1.350        | 10.994        | 4.081        |
| `Reactive dependency fan-out`        | 2.049         | 0.290        | 2.361         | 0.372        |
| `Reactive dependency update fan-out` | 0.138         | 0.071        | 0.184         | 0.105        |
| `Direct nodeChanged`                 | 0.269         | 0.170        | 0.391         | 0.351        |

Setup P95 also dropped substantially after lazy preparation. For example, `Direct nodeChanged` setup P95 moved from about `6.146 ms` to about `1.562 ms`. Some measured first-touch mutation tails can move up because laziness defers preparation into the first read; use `prepareTree()` when that tradeoff is undesirable.

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
