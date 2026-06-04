# Retree Core

Retree is a lightweight and simple state management library, specifically designed for frameworks like React. If you know how to work with objects in JavaScript or TypeScript, you pretty much already know how to use Retree.

## How to install

Install with `npm`:

```bash
npm i @retreejs/core
```

Install with `yarn`:

```bash
yarn add @retreejs/core
```

## Feature glossary

Use this as a quick map before choosing an API:

-   [`Retree.root`](#how-to-use) makes one object the root of a Retree-managed tree. Use it once at the boundary where plain state enters Retree.
-   [`Retree.on`](#listen-to-nodechanged-treechanged-and-noderemoved) subscribes to `nodeChanged`, `treeChanged`, or `nodeRemoved`. Use it outside React or inside lower-level integrations.
-   [`Retree.select`](#select-derived-values) subscribes to a selected value or ordered dependency list. Use it to narrow notifications; it is not a cache.
-   [`Retree.parent`](#find-a-parent) returns the structural parent of a node. Use it for tree-local actions like deleting yourself from an array.
-   [`Retree.move`](#move-link-or-clone-existing-nodes) transfers an existing node to a new structural parent. Use it when ownership should change.
-   [`Retree.link` and `@link`](#move-link-or-clone-existing-nodes) store a reactive pointer to a node without reparenting it. Use it for selected items and cross-references.
-   [`Retree.clone`](#move-link-or-clone-existing-nodes) creates a detached copy. Use it when two places need independent state.
-   [`@select`](#reactive-dependencies) makes a getter's owning `ReactiveNode` emit from an ordered dependency list. Use it when VM logic should stay in the node while renders stay narrow.
-   [`ReactiveNode.dependencies`](#reactive-dependencies) makes one node emit when another node changes. Use raw reactive nodes/primitives for simple slots, or `this.dependency(node, comparisons)` for custom comparison cells.
-   [`memo`, `@memo`, and `@fnMemo`](#memoize-computed-getters) cache computed values. Prefer bare decorators for automatic dependency trapping; pass comparison functions for finer cache-key control.
-   [`@ignore`](#opt-fields-out-of-reactivity-with-ignore) keeps a `ReactiveNode` field out of Retree emissions. Use it for caches, subscriptions, framework handles, and non-rendered state.
-   [`Retree.runTransaction`](#transactions) batches synchronous mutations into one listener flush per changed node. Use it for one logical update made of several writes.
-   [`Retree.runSilent`](#skip-emitting-changes) performs writes without emitting listeners. Use it for non-rendered bookkeeping.
-   [`ReactiveNode.prepareTree`](#prepare-lazy-reactivenode-fields) warms lazy child proxies. Use it when first-touch proxy cost should happen during a controlled loading phase.

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
tree.add();
tree.todos[0].toggle();
tree.todos[0].delete();
unsubscribe();
```

## Listen to nodeChanged, treeChanged, and nodeRemoved

`Retree.on` is the core subscription primitive. `nodeChanged` fires for direct changes to that node. `treeChanged` fires for the node and descendant changes. `nodeRemoved` fires when that node is detached from its parent.

```ts
const board = Retree.root({
    title: "Roadmap",
    cards: [{ text: "Ship docs", done: false }],
});

Retree.on(board, "nodeChanged", () => console.log("board changed"));
Retree.on(board, "treeChanged", () => console.log("board subtree changed"));
Retree.on(board.cards[0], "nodeRemoved", () => console.log("card removed"));

board.title = "Q2 Roadmap"; // ✅ nodeChanged(board), ✅ treeChanged(board)
board.cards[0].done = true; // ❌ nodeChanged(board), ✅ treeChanged(board)
board.cards.splice(0, 1); // ✅ nodeRemoved(card), ✅ treeChanged(board)
```

Call the unsubscribe returned by `Retree.on(...)` when you only want to remove one listener. Use `Retree.clearListeners(node)` when you own all listeners for a node and want to remove them at once.

```ts
const unsubscribe = Retree.on(board, "nodeChanged", () => {});
unsubscribe();

Retree.clearListeners(board.cards, false); // clear the list and child listeners
```

## Select derived values

`Retree.select` subscribes to a selected value or ordered dependency list from any Retree-managed node and only calls your callback when that selection changes. This is different from `memo` and `fnMemo`: memoization caches computation, while `select` narrows notifications.

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

```ts
const project = Retree.root({
    tasks: [
        { title: "Docs", done: false },
        { title: "Tests", done: true },
    ],
});

Retree.select(
    project.tasks,
    (tasks) => tasks.filter((task) => task.done).length,
    (doneCount) => console.log(doneCount),
    { listenerType: "treeChanged" }
);

project.tasks[0].done = true; // ✅ emits: selected count changed 1 -> 2
project.tasks[0].title = "Better docs"; // ❌ no emit: selected count stayed 2
```

`Retree.select` can also infer its own dependencies when you pass only a selector function and a callback. Whole Retree-managed values read by the selector subscribe automatically. Property reads subscribe to the owner node but compare the specific property value, so `task.done` reacts to task replacement or `done` changes without reacting to unrelated task fields. Primitive reads compare.

```ts
const unsubscribeDoneCount = Retree.select(
    () => project.tasks.filter((task) => task.done).length,
    (doneCount) => console.log(doneCount)
);

project.tasks[0].done = true; // ✅ emits: trapped task read changed the count
project.tasks[0].title = "Better docs"; // ❌ no emit: selected count stayed 2
unsubscribeDoneCount();
```

Selectors can also return an ordered dependency list. Reactive entries are subscribed to; primitive and plain entries are compared. This is useful when a broad source can change often, but only a narrowed selected value should notify.

```ts
const unsubscribeAttribute = Retree.select(
    row,
    (self) => [self.attributes, self.attributeId, self.attribute],
    ([, , nextAttribute], [, , previousAttribute]) => {
        console.log({ nextAttribute, previousAttribute });
    }
);
```

By default, `select` listens to `nodeChanged` on the node you pass. This is best for selecting direct values owned by that exact node, including `ReactiveNode` values that emit when their dependencies change. Pass `listenerType: "treeChanged"` when the selector intentionally reads descendants, and pass `equals` when you need custom comparison for the entire selected value or tuple.

Dependency-list subscriptions in `Retree.select` are observational. If `self.attributes` or `self.attribute` changes in the example above, the callback can run, but the `row` node passed to `Retree.select` is not forced to receive a fresh reproxy. Use `@select` when a `ReactiveNode` owner should emit `nodeChanged`.

`select` does not cache expensive work for later reads. If the selector is expensive and reused from multiple places, put the expensive part behind `memo`, `@memo`, or `@fnMemo`, then select the cached value.

## Move, link, or clone existing nodes

Retree keeps a pure ownership tree: a node can have one structural parent. If you need to put an existing node somewhere else, choose the operation that matches your intent.

Use `Retree.move(node, destination, key?)` when ownership should move. Arrays accept a numeric `key` as the insertion index, or omit it to append. Maps and objects require a key. Sets ignore the key.

```ts
const task = projectA.tasks[0];
Retree.move(task, projectB.tasks); // append to projectB.tasks
Retree.move(task, tasksById, task.id); // Map key or object key
```

`ReactiveNode` also has `moveTo(destination, key?)`, which wraps `Retree.move(this, destination, key)`.

```ts
class Task extends ReactiveNode {
    public title = "";

    get dependencies() {
        return [];
    }

    public archive(archiveList: Task[]) {
        this.moveTo(archiveList); // same as Retree.move(this, archiveList)
    }
}
```

Use `Retree.link(node)` or `@link` when one part of your state should point at a node that remains owned somewhere else. Replacing the link emits on the owner, but the target keeps its original parent. Reads return the latest reproxy for the linked node.

```ts
import { Retree, ReactiveNode, link } from "@retreejs/core";

const root = Retree.root({
    tasks: [{ title: "Write docs" }],
    selectedTask: null as null | ReturnType<typeof Retree.link>,
});

root.selectedTask = Retree.link(root.tasks[0]);
root.selectedTask.current.title = "Write better docs";

class EditorState extends ReactiveNode {
    @link public selectedTask: { title: string } | null = null;

    public select(task: { title: string }) {
        this.selectedTask = task;
    }

    public selectedTaskLink(task: { title: string }) {
        return this.link(task); // same as Retree.link(task)
    }

    get dependencies() {
        return [];
    }
}
```

```ts
const state = Retree.root(new EditorState());
state.selectedTask = root.tasks[0]; // ✅ emits on state, ❌ does not reparent task
state.selectedTask.title = "Renamed"; // ✅ emits where the task is structurally owned
state.selectedTask = root.tasks[0]; // ❌ no emit if the field already points there
```

Use `Retree.clone(node)` when you want a detached copy that can become a new child somewhere else.

```ts
const copy = Retree.clone(root.tasks[0]);
root.tasks.push(copy); // ✅ emits for root.tasks; copy is a new structural child
```

## Find a parent

`Retree.parent(node)` returns the node's structural parent, or `null` for a root.

```ts
class Task {
    public title = "";

    public removeSelf() {
        const parent = Retree.parent(this);
        if (!Array.isArray(parent)) return;

        const index = parent.indexOf(this);
        if (index >= 0) {
            parent.splice(index, 1); // ✅ emits on the parent list
        }
    }
}
```

Links are not structural parents: if `editor.selectedTask` is a `@link` field pointing at `project.tasks[0]`, `Retree.parent(editor.selectedTask)` still returns `project.tasks`.

## Reactive dependencies

`ReactiveNode.dependencies` lets one node emit `nodeChanged` when another node changes. Use it when a node exposes derived state but you do not want broad `treeChanged` subscriptions.

Return raw Retree-managed nodes directly when any change to that node should emit. Return primitives directly when they should be compared only. Wrap one slot with `this.dependency(node, comparisons)` when a reactive dependency needs custom comparison cells.

```ts
class ProjectSummary extends ReactiveNode {
    public tasks: { done: boolean }[] = [];

    get doneCount() {
        return this.tasks.filter((task) => task.done).length;
    }

    get dependencies() {
        return [this.dependency(this.tasks, [this.doneCount])];
    }
}

const summary = Retree.root(new ProjectSummary());
Retree.on(summary, "nodeChanged", () => console.log(summary.doneCount));

summary.tasks.push({ done: false }); // ❌ no emit: doneCount stayed 0
summary.tasks[0].done = true; //       ✅ emits: doneCount changed 0 -> 1
```

Dependency arrays should be deterministic, but they may change length or order at runtime. Retree treats added, removed, or reordered entries as invalidation and refreshes subscriptions. Use `null` when you want an inactive slot to keep its position, but it is not required for correctness.

For simple cases, no wrapper is needed:

```ts
import { ReactiveNode, link } from "@retreejs/core";

class AuthStore extends ReactiveNode {
    public session: { userId: string; role: string } | null = null;

    get dependencies() {
        return [];
    }
}

class HeaderState extends ReactiveNode {
    @link
    public auth: AuthStore;

    constructor(auth: AuthStore) {
        super();
        this.auth = auth;
    }

    get dependencies() {
        return [this.auth, this.auth.session?.userId];
    }
}
```

Use `@select` when the dependency list belongs to one getter and you want `useNode(node)` to re-render only when those selected dependencies change:

```ts
import { ReactiveNode, link, memo, select } from "@retreejs/core";

class TaskRow extends ReactiveNode {
    @link public task!: { isCompleted: boolean };
    @link public filter!: { isComplete: boolean | null };

    @select()
    get isVisible() {
        return (
            this.filter.isComplete === null ||
            this.task.isCompleted === this.filter.isComplete
        );
    }
}
```

`@select()` without a selector traps dependencies while the getter runs. Whole Retree-managed values read by the getter subscribe; property reads subscribe to the owner node but compare the specific property value; primitive values read by the getter compare. Pass an explicit selector when you want to choose or customize dependency slots:

```ts
import { ReactiveNode, memo, select } from "@retreejs/core";

class AttributeRow extends ReactiveNode {
    public attributes: { id: string; label: string }[] = [];
    public attributeId!: string;

    @memo
    private get _attribute() {
        return this.attributes.find((check) => check.id === this.attributeId);
    }

    @select((self) => [
        self.attributes,
        self.attributeId,
        self.dependency(self._attribute, [self._attribute?.id]),
    ])
    get attribute() {
        return this._attribute;
    }
}
```

In explicit `@select` lists, raw reactive values subscribe, primitive values compare, and `self.dependency(...)` customizes one slot's comparison behavior.

Pass an options object when the getter output needs custom equality. `equals` receives `(self, previous, next)` and returns `true` when the outputs are equivalent, so the owner should not emit or reproxy. You can use it with automatic trapping or an explicit dependency getter:

```ts
class VisibleTaskList extends ReactiveNode {
    public tasks: { id: string; isArchived: boolean }[] = [];

    @select({
        equals: (_self, previous, next) =>
            previous.length === next.length &&
            previous.every((task, index) => task.id === next[index].id),
    })
    get visibleTasks() {
        return this.tasks.filter((task) => !task.isArchived);
    }

    @select((self) => self.tasks, {
        equals: (_self, previous, next) =>
            previous.length === next.length &&
            previous.every((task, index) => task.id === next[index].id),
    })
    get visibleTasksWithExplicitDeps() {
        return this.visibleTasks;
    }
}
```

## Memoize computed getters

`ReactiveNode` exposes `@memo` for caching computed getters and `@fnMemo` for caching deterministic method return values. With no arguments, both decorators automatically trap the Retree reads inside the getter or method and invalidate the cache when those values change.

Pass a comparison function only when you want finer control over the cache keys. The method forms (`this.memo(fn, deps?)` and `this.memo(key, fn, deps?)`) are still available when you need to memoize part of a getter or maintain multiple cache cells.

```ts
import { Retree, ReactiveNode, fnMemo, memo } from "@retreejs/core";

interface Card {
    text: string;
}

class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    // Recommended: @memo traps the Retree reads in this getter automatically.
    @memo
    get filteredList(): Card[] {
        return this.list.filter((c) => c.text === this.searchText);
    }

    // Recommended: @fnMemo traps Retree reads and also compares method args.
    @fnMemo
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

Pass a comparison function when the automatic trapper is broader than you want:

```ts
class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    @memo((self: ListFilter) => [self.list, self.searchText])
    get filteredList(): Card[] {
        return this.list.filter((c) => c.text === this.searchText);
    }

    @fnMemo((self: ListFilter, limit: number) => [
        self.list,
        self.searchText,
        limit,
    ])
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

Use the method forms when a decorator does not fit:

```ts
class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    get filteredList(): Card[] {
        return this.memo(() =>
            this.list.filter((c) => c.text === this.searchText)
        );
    }

    get pair() {
        const filtered = this.memo("filtered", () =>
            this.list.filter((c) => c.text === this.searchText)
        );
        const count = this.memo("count", () => filtered.length, [filtered]);
        return { filtered, count };
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

Comparison semantics (same for all forms; `@fnMemo` also compares method arguments):

-   Bare/empty decorators, or omitted `this.memo` comparisons → trap Retree reads automatically and recompute when a trapped value changes.
-   Function returns `undefined` → recompute whenever the `ReactiveNode` reproxies (any dependency changes or a property is set).
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

## Transactions

Use `Retree.runTransaction(...)` when several synchronous writes are one logical update. Retree still updates every changed node, but listener callbacks flush once per changed node after the transaction finishes.

```ts
const counter = Retree.root({ count: 0 });
let emits = 0;

Retree.on(counter, "nodeChanged", () => {
    emits += 1;
});

Retree.runTransaction(() => {
    counter.count += 1;
    counter.count *= 2;
});

console.log(counter.count); // 2
console.log(emits); // ✅ 1 emit, not 2
```

## Skip emitting changes

Use `Retree.runSilent(...)` for writes that should update state without notifying listeners. By default it also skips reproxying, which means old and new object identities remain equal for comparison checks.

```ts
const settings = Retree.root({
    renderedCount: 0,
    telemetryCount: 0,
});

Retree.on(settings, "nodeChanged", () => console.log("render"));

Retree.runSilent(() => {
    settings.telemetryCount += 1;
}); // ❌ no emit

settings.renderedCount += 1; // ✅ emits
```

Pass `false` as the second argument when you want to suppress listener emission but still refresh reproxy identities for later comparisons:

```ts
Retree.runSilent(() => {
    settings.telemetryCount += 1;
}, false);
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

`treeChanged` is most expensive when a listener also performs deep reads across the subtree, because the listener is asking Retree to propagate the ancestor change and then traverse the changed graph. If a selector or component only needs one selected value or dependency list, prefer `Retree.select(...)` on the narrowest node that owns that value.

### Use `ReactiveNode.dependencies` as a narrow bridge

`ReactiveNode.dependencies` is a good way to make one node react to another node without subscribing a broad tree. Keep the getter deterministic:

-   Dependency list length/order can change; Retree treats shape changes as invalidation and refreshes subscriptions.
-   Use comparison values when only some changes should emit.
-   Prefer `@select` for hot filtered lists where one getter should listen to a broad collection but only emit when the selected items or selected order changes.
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

**Caveat:** because the field's value isn't wrapped, plain objects stored under it lose `Retree.parent(...)` and won't appear in `treeChanged` notifications. If you store an existing Retree-managed node in an ignored field, Retree does not reparent it, but reads still return that node's latest reproxy.

## Core samples

See the [useNode React hook](https://github.com/ryanbliss/retree/blob/main/packages/retree-react/src/useNode.ts) or [example 01 project](https://github.com/ryanbliss/retree/tree/main/samples/01.core-example) for more example usages.

## Docs

Docs are hosted at https://ryanbliss.github.io/retree/.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
