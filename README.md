# Retree packages

Retree is a lightweight and simple state management library, designed primarily for React. If you know how to work with objects in JavaScript or TypeScript, you pretty much already know how to use Retree.

## API docs

Generate the TypeDoc site locally with:

```bash
npm run docs
```

The generated static site is written to `docs/` and ignored by Git. The docs build also copies `llms.txt` into the generated site so agents can discover the curated docs manifest at the Pages root. GitHub Pages can host it from the included docs workflow after the repository's Pages source is set to **GitHub Actions**.

## Agent docs and skill

Published Retree npm packages include their package `README.md` and the root `llms.txt` file so sandboxed agents can read the high-signal Retree guide directly from an installed package.

This repository also exposes a Retree agent skill at `skills/retree/SKILL.md`, with full markdown references generated from the docs sources into `skills/retree/references/`. `npm run docs` refreshes those references after the TypeDoc site builds. After the repository is public on GitHub, agents that support the open skills CLI can install or use it with:

```bash
npx skills add ryanbliss/retree --skill retree
npx skills use ryanbliss/retree@retree
```

## Packages

-   `@retreejs/core` provides Retree's proxy, event, memo, and `ReactiveNode` primitives.
-   `@retreejs/react` provides React hooks for rendering Retree nodes.
-   `@retreejs/convex` connects Convex queries, paginated queries, actions, mutations, and connection state to Retree nodes.
-   `@retreejs/react-convex` adapts Convex's `ConvexReactClient` for React apps that want one client instance for both Convex React and Retree Convex nodes.

## Feature glossary

-   [`Retree.root`](#retreejscore) makes one object the root of a Retree-managed tree. Use it once where plain state enters Retree.
-   [`useRoot`](#useroot-hook) creates one Retree root for a React component lifetime. Use it when state belongs to a React subtree.
-   [`useNode`](#usenode-hook) re-renders a React component for direct `nodeChanged` events on one node. Use it for rows, panels, forms, and focused child components.
-   [`useTree`](#usetree-hook) re-renders for `treeChanged` events from a node or any descendant. Use it sparingly for small subtrees that truly need broad invalidation.
-   [`useSelect`](#useselect-hook) re-renders only when a selected value or ordered dependency list changes. Use it for counts, totals, booleans, and other narrow projections.
-   [`Retree.on`](#core-api-examples) subscribes to `nodeChanged`, `treeChanged`, or `nodeRemoved`. Use it outside React and inside integrations.
-   [`Retree.select`](#core-api-examples) is the non-React version of `useSelect`. Use it to narrow notifications; it is not a cache.
-   [`Retree.parent`](#core-api-examples) returns the structural parent of a node. Use it for tree-local operations like deleting yourself from a list.
-   [`Retree.raw`](#core-api-examples) returns the raw, proxy-free object behind a node for native-speed, read-only access. Raw subtrees are guaranteed proxy-free.
-   [`Retree.source`](#core-api-examples) resolves a raw value back to its managed node — the inverse of `Retree.raw`.
-   [`Retree.peekInto`](#core-api-examples) runs a read-only query against a node's raw object and resolves the result to its managed node when one exists.
-   [`Retree.untracked`](#core-api-examples) pauses dependency tracking during a synchronous callback, for bulk reads inside tracked selectors and memo getters.
-   [`useRaw`](#useraw-hook) subscribes like `useNode` but returns `[raw, toSource]` for native-speed, proxy-free render reads. Use it for components that read wide.
-   [`Retree.move`](#core-api-examples) transfers an existing node to a new structural parent. Use it when ownership should change.
-   [`Retree.link` and `@link`](#core-api-examples) store a reactive pointer without reparenting. Use them for selected items and cross-references.
-   [`Retree.clone`](#core-api-examples) makes a detached copy. Use it when two places need independent state.
-   [`@select`](#reactivenode) decorates a getter with an ordered dependency list so VM logic can stay in the node while `useNode(node)` stays selective.
-   [`ReactiveNode.dependencies`](#reactivenode) makes one node emit when another node changes. Return raw reactive nodes/primitives directly, or wrap one slot with `this.dependency(node, comparisons)`.
-   [`memo`, `@memo`, and `@fnMemo`](#memoize-computed-getters) cache computed values. Prefer bare decorators for automatic dependency trapping; pass comparison functions for finer cache-key control.
-   [`@ignore`](#opt-fields-out-of-reactivity-with-ignore) keeps a field out of Retree emissions. Use it for caches, subscriptions, framework handles, and non-rendered state.
-   [`Retree.runTransaction`](#transactions) batches synchronous writes into one listener flush per changed node.
-   [`Retree.runSilent`](#skip-re-rendering-changes) performs writes without emitting listeners.
-   [`ReactiveNode.prepareTree`](#core-api-examples) warms lazy child proxies during a controlled phase.
-   [`RetreeConvexReactClient`](#retreejsreact-convex) extends Convex's `ConvexReactClient` with Retree Convex subscription methods for React apps.

## @retreejs/react

Retree React enables a performant, intuitive interface for managing app state of any complexity. It is designed to seamlessly mix-and-match class-based data layers with React hooks with minimal boilerplate.

### How to install

Install with `npm`:

```bash
npm i @retreejs/core @retreejs/react
```

Install with `yarn`:

```bash
yarn add @retreejs/core @retreejs/react
```

### How to use

It's extremely easy to get started with Retree. The main React hooks are `useNode`, `useTree`, `useSelect`, and `useRoot`. Each has specific advantages while leveraging the same simple interface.

#### useRoot hook

Use `useRoot` when a component should create and retain its own Retree root. The factory runs once for the component lifetime.

```tsx
import { useNode, useRoot } from "@retreejs/react";

function CounterPanel() {
    const counter = useRoot(() => ({ count: 0 }));
    const state = useNode(counter);

    return <button onClick={() => (state.count += 1)}>{state.count}</button>;
}
```

`useRoot` creates the root; `useNode`, `useTree`, or `useSelect` decide what causes the component to re-render.

#### useNode hook

If you adopt the `useNode` pattern, your apps will automatically inherit performant re-renders, since only the components that depend on each node in your object tree will re-render on changes. For this to work, you need to do the following:

1. Pass some object into `Retree.root`, e.g., `const root = Retree.root({ foo: "bar", list: [] })`
2. Make the response stateful using `useNode`, e.g., `const rootState = useNode(root)`
3. Render values from the object in your component, e.g., `<h1>{fooState.foo}</h1>`
4. Set values like you normally would in JS/TS, e.g., `fooState.foo = "moo"`
5. Ensure child nodes are passed to `useNode` when using deeply nested values, e.g., `const list = useNode(root.list)`

**NOTE:** A node is any non-primitive type, including objects, lists, maps, etc. Primitive values of a node like `string`, `number`, and `boolean` do not require being passed into `useNode`.

Let's take a look at a standard todo list example:

```tsx
import React from "react";
import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

// Todo view model
class Todo {
    public text = "";
    public checked = false;
    toggle() {
        this.checked = !this.checked;
    }
    onValueChange(event: React.ChangeEvent<HTMLInputElement>) {
        this.text = event.target.value;
    }
}

// Todo React component that accepts a Todo object as a prop
function _ViewTodo({ todo }) {
    // Make todo stateful. Changes to todo will only re-render this component.
    const _todo = useNode(todo);
    return (
        <div>
            <input
                type="checkbox"
                checked={_todo.checked}
                onChange={_todo.toggle}
            />
            <input value={_todo.text} onChange={_todo.onValueChange} />
        </div>
    );
}
const ViewTodo = React.memo(_ViewTodo);

// Todo list view model
class TodoList {
    public readonly todos: Todo[] = [];
    add() {
        this.todos.push(new Todo());
    }
}

// Create your root TreeNode instance with any object
const root = Retree.root(new TodoList());

// Render app
function App() {
    // Make our list of todos stateful
    const todos = useNode(root.todos);
    return (
        <div>
            <button onClick={root.add}>Add</button>
            {todos.map((todo, index) => (
                <ViewTodo key={index} todo={todo} />
            ))}
        </div>
    );
}
export default App;
```

To better understand the rules of `useNode`, let's look at the following:

```ts
import React from "react";
import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

const whiteboardRoot = Retree.root({
    selectedColor: "red",
    visible: false,
    canvasSize: { width: "0px", height: "0px" },
    shapes: [],
});
function App() {
    const whiteboard = useNode(whiteboardRoot);
    // ...
    return <>{JSON.stringify(whiteboard)}</>;
}
// ✅ will re-render
whiteboardRoot.selectedColor = "blue";
// ✅ will re-render
whiteboardRoot.visible = true;
// ✅ will re-render
whiteboardRoot.canvasSize = { width: "100px", height: "100px" };
// ❌ no re-render
whiteboardRoot.canvasSize.width = "200px";
// ❌ no re-render
whiteboardRoot.shapes.push({ type: "circle" });
```

There are two ways to fix this. The first way is to pass each child object used in a component into `useNode`, like this:

```tsx
function App() {
    const whiteboard = useNode(whiteboardRoot);
    const canvasSize = useNode(whiteboard.canvasSize);
    const shapes = useNode(whiteboard.shapes);
    // ...
    return <>{JSON.stringify(whiteboard)}</>;
}
// ✅ will re-render
whiteboardRoot.selectedColor = "blue";
// ✅ will re-render
whiteboardRoot.visible = true;
// ✅ will re-render
whiteboardRoot.canvasSize = { width: "100px", height: "100px" };
// ✅ will re-render
whiteboardRoot.canvasSize.width = "200px";
// ✅ will re-render
whiteboardRoot.shapes.push({ type: "circle" });
```

This is ideal in cases when you want to use child nodes as props into other child components, such as a `<ViewTodo todo={todo} />`. This ensures that state changes to each individual item in the list won't trigger re-renders of its parent. When using `memo` components or the new React compiler, this also means irrelevant changes to parent nodes won't re-render items in the list.

#### useSelect hook

Use `useSelect` when a component needs a selected value or ordered dependency list from a Retree node and should only re-render when that selection changes. It listens to `nodeChanged` by default; pass `listenerType: "treeChanged"` when the selector reads descendants.

```tsx
import { Retree } from "@retreejs/core";
import { useSelect } from "@retreejs/react";

const project = Retree.root({
    tasks: [
        { title: "Docs", done: false },
        { title: "Tests", done: true },
    ],
});

function DoneCount() {
    const doneCount = useSelect(
        project.tasks,
        (tasks) => tasks.filter((task) => task.done).length,
        { listenerType: "treeChanged" }
    );

    return <span>{doneCount}</span>;
}

project.tasks[0].done = true; // ✅ re-renders DoneCount: 1 -> 2
project.tasks[0].title = "Better docs"; // ❌ no re-render: doneCount stayed 2
```

`useSelect` can also infer dependencies when you pass only a selector function. Whole Retree-managed values read by the selector subscribe automatically. Property reads subscribe to the owner node but compare the specific property value, so `task.done` reacts to task replacement or `done` changes without reacting to unrelated task fields. Primitive reads compare.

```tsx
const doneCount = useSelect(
    () => project.tasks.filter((task) => task.done).length
);
```

Selectors can also return ordered dependency lists. Reactive entries subscribe; primitive entries compare:

```tsx
const [, , attribute] = useSelect(row, (self) => [
    self.attributes,
    self.attributeId,
    self.attribute,
]);
```

Dependency-list subscriptions in `useSelect` are observational: selected dependency changes can re-render the component, but they do not force the node passed to `useSelect` to receive a fresh reproxy. Use `@select` when a `ReactiveNode` owner should emit `nodeChanged`.

`useSelect` is a subscription primitive, not a memo cache. Use `memo`, `@memo`, or `@fnMemo` for expensive computation you want to cache, then select the cached value when you want narrower renders.

#### useRaw hook

Use `useRaw` when a component reads wide during render — big tables, canvas
layers, subtree serialization. It subscribes exactly like `useNode`
(`nodeChanged` by default) but returns `[raw, toSource]`: the live raw object
for native-speed, proxy-free reads plus a resolver back to managed nodes.

```tsx
import React from "react";
import { useNode, useRaw } from "@retreejs/react";

function TaskListView({ list }: { list: TaskList }) {
    // Re-renders only when the array itself changes: add / remove / reorder.
    const [tasksRaw, toSource] = useRaw(list.tasks);
    return (
        <ul>
            {tasksRaw.map((rawTask) => (
                <TaskRow key={rawTask.id} task={toSource(rawTask)!} />
            ))}
        </ul>
    );
}

const TaskRow = React.memo(function TaskRow({ task }: { task: Task }) {
    const t = useNode(task); // node prop: own subscription, write surface
    return <li onClick={() => (t.isComplete = !t.isComplete)}>{t.title}</li>;
});
```

Pass **nodes** to children via `toSource`, never raw values — nodes carry
subscriptions, writes, and identity; raw is a local read view. `toSource`
always resolves direct children of the subscribed node (object/array
children, Map values, Set members). Deep changes re-render only when declared
— via the node's `dependencies` / `@select`, via `useSelect` for derived
views, or via the `treeChanged` opt-in. Never write to raw values or use raw
references as `React.memo` props or `useMemo` deps.

#### useTree hook

In some cases it might be desirable to get re-renders for all child nodes at a given point in your object tree. In such cases, it can be impractical to put each child node in `useNode`. Fortunately, `useTree` makes this very simple.

Let's look at this simple example:

```jsx
import React from "react";
import { Retree } from "@retreejs/core";
import { useNode, useTree } from "@retreejs/react";

const table = Retree.root({
    headers: [{ title: "label" }, { title: "count" }, { title: "actions" }],
    rows: [
        { label: "count 1", count: 0 },
        { label: "count 2", count: 0 },
    ],
});

function Headers({ headers }) {
    // If it is cheap to render all columns, `useTree` can save time
    const headerState = useTree(headers);
    return (
        <tr>
            {headerState.map((header) => (
                <td key={header.title}>{header.title}</td>
            ))}
        </tr>
    );
}

function Row({ row }) {
    // In this simple case, `useNode` and `useTree` can be used interchangeably.
    const rowState = useNode(row);
    return (
        <tr>
            <td>{rowState.label}</td>
            <td>{rowState.count}</td>
            <td onClick={() => (rowState.count += 1)}>+1</td>
        </tr>
    );
}

function TotalRow({ rows }) {
    // We want a sum of all rows, so we want to re-render on all child changes
    const rowsState = useTree(rows);
    const sumOfCounts = rowsState.reduce(
        (sum, current) => sum + current.count,
        0
    );
    return (
        <tr>
            <td>{rows.length}</td>
            <td>{sumOfCounts}</td>
            <td>N/A</td>
        </tr>
    );
}

function App() {
    // We don't want to re-render the whole table on each state change, so we useNode
    const tableState = useNode(table);
    const rows = useNode(tableState.rows);
    return (
        <table>
            <Headers headers={tableState.headers} />
            {rows.map((row, i) => (
                <Row key={i} row={row} />
            ))}
            <TotalRow rows={rows} />
        </table>
    );
}
export default App;
```

`useTree` is very powerful and makes things incredibly simple. The following scenarios should help clarify the behavior of `useTree`:

```ts
const root = Retree.root({
    great_grandparent_1: {
        name: "Bob Sr",
        grandparent_1: {
            name: "Bob Jr",
            parent_1: {
                name: "Angie",
                child_1: {
                    name: "Megan",
                },
            },
        },
        grandparent_2: {
            /** ... **/
        },
    },
    great_grandparent_2: {
        /** ... **/
    },
});

// Root component
const family = useNode(root);
// Great Grandparent Component 1
const greatGrandparent1 = useTree(family.great_grandparent_1);
// Great Grandparent Component 2
const greatGrandparent2 = useTree(family.great_grandparent_2);

// If we set:
greatGrandparent1.grandparent_1.name = "Beth";

// What will NOT change:
// - Root component (no render)
// - Great Grandparent Component 2 (no render)
// - old `family` value to be unchanged in comparisons (e.g., `memo` or hook dependencies)
// - old `greatGrandparent2` + all children nodes to be unchanged in comparisons
// - old `greatGrandparent1.grandparent_1.parent_1` to be unchanged in comparisons
// - old `greatGrandparent1.grandparent_2` to be unchanged in comparisons

// What will change:
// - Great Grandparent Component 1 to render
// - old `greatGrandparent1` to not equal new `greatGrandparent1` value in comparisons
// - old `greatGrandparent1.grandparent_1` to not equal new value in comparisons
```

While `useTree` is powerful and can make things a lot easier, it is important to ensure its usage doesn't have negative performance. As your component tree gets more complicated, you should take care to only `useTree` sparingly (e.g., lower down in your view tree hierarchy).

**Tip:** Always use React Dev Tools' profile tab to measure render performance when using `useTree`.

### Performance guidance

Retree performs best when components subscribe to the narrowest node or value they need:

-   Prefer `useNode(child)` for item rows and focused panels.
-   Prefer `useSelect(node, selector)` for selected values or dependency lists that should only re-render when the selection changes.
-   Treat `useTree` / `treeChanged` as broad subtree invalidation, especially in hot paths.
-   Keep `ReactiveNode.dependencies` deterministic. Length/order can change; Retree treats shape changes as invalidation and refreshes subscriptions.
-   Prefer `@select` for hot filtered lists where one getter should listen to a broad collection but only emit when the selected items or selected order changes.
-   Avoid constructing large Retree roots or `ReactiveNode` graphs during React render; create them once, or initialize them through `useMemo` / `useState`.

Large `ReactiveNode` object and array fields are prepared lazily. This improves initial setup, but the first nested read pays the preparation cost. Use `node.prepareTree({ depth })` or `super({ prepare: { autoPrepare: true, depth } })` if you want to pay that cost during a controlled loading phase.

Recent stable medium benchmark runs show the main direction of the architecture work: `runTransaction` average time dropped from about `3.881 ms` to `1.350 ms`, and `Reactive dependency fan-out` average time dropped from about `2.049 ms` to `0.290 ms`. Setup P95 for direct `nodeChanged` dropped from about `6.146 ms` to `1.562 ms`.

### Optimize for performance

`Retree` offers useful utility APIs for further optimizing performance, including `ReactiveNode`, `Retree.runTransaction`, and `Retree.runSilent`.

#### ReactiveNode

The `ReactiveNode` class allows nodes in your tree to reactively update when their declared dependencies change. This offers a middleground between `useTree` and `useNode` that can be extremely powerful for minimizing re-renders in your application.

Dependency arrays accept raw reactive nodes and primitives. Reactive nodes subscribe; primitives compare. Use `this.dependency(node, comparisons)` when one slot needs custom comparison values.

```tsx
import { Retree, ReactiveNode, memo, select } from "@retreejs/core";
import { useNode } from "@retreejs/react";

class EvenCounter extends ReactiveNode {
    public numbers: number[] = [];

    get evenNumberCount(): number {
        return this.numbers.filter((number) => number % 2 === 0).length;
    }

    get dependencies() {
        return [this.dependency(this.numbers, [this.evenNumberCount])];
    }
}

const counter = Retree.root(new EvenCounter());

function EvenBadge() {
    const state = useNode(counter);
    return <span>{state.evenNumberCount}</span>;
}

counter.numbers.push(2); // ✅ re-renders: evenNumberCount 0 -> 1
counter.numbers.push(3); // ❌ no re-render: evenNumberCount stayed 1
```

Use `@select` when the dependency list belongs to a getter and `useNode(node)` should update only for that getter's selected dependencies:

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

Pass an options object when the getter output needs custom equality. `equals` receives `(self, previous, next)` and returns `true` when the outputs are equivalent, so the owner should not emit or reproxy:

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
}
```

##### ReactiveNode lifecycle hooks

`ReactiveNode` also exposes lifecycle hooks for setup, cleanup, and post-change synchronization:

-   `onObserved()` runs when the node gets its first active `nodeChanged` or `treeChanged` observer.
-   `onUnobserved()` runs when the node loses its last active `nodeChanged` or `treeChanged` observer.
-   `onChanged()` runs after the node receives a fresh reproxy because one of its own properties changed or one of its declared dependencies changed.

Use `onObserved()` and `onUnobserved()` for external resources that should only exist while something is observing the node. This keeps `dependencies` purely declarative instead of using it as a setup side effect.

```ts
import { ReactiveNode, ignore } from "@retreejs/core";

declare function subscribeToValue(
    callback: (value: string) => void
): () => void;

class LiveValueNode extends ReactiveNode {
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

Use `onChanged(changes)` when you need to update derived state only after Retree has confirmed that the node actually changed. Retree runs `onChanged()` before listener callbacks flush. `changes` is an array of `{ key, previous, new }` records.

```ts
import type { INodeFieldChanges } from "@retreejs/core";

class SearchNode extends ReactiveNode {
    public query = "";
    public normalizedQuery = "";

    get dependencies() {
        return [];
    }

    protected onChanged(_changes: INodeFieldChanges[]): void {
        const next = this.query.trim().toLowerCase();
        if (this.normalizedQuery === next) {
            return;
        }

        this.normalizedQuery = next;
    }
}
```

#### Memoize computed getters

`ReactiveNode` provides `memo` to cache the result of a getter, similar in spirit to React's `useMemo`. Use it to skip expensive recomputation when the values it depends on haven't changed.

The simplest path is to decorate computed getters and deterministic methods with `@memo` / `@fnMemo`. With no arguments, the decorator automatically traps the Retree reads inside the getter or method and invalidates the cache when those values change.

Pass a comparison function only when you want finer control over the cache keys, such as depending on a cheaper primitive instead of every value read by the computation. The method forms (`this.memo(fn, deps?)` and `this.memo(key, fn, deps?)`) are still available when a decorator does not fit the shape of the code.

##### `@memo` decorator (recommended for computed getters)

The cache key is the getter's property name. Use `@memo` or `@memo()` with no comparisons for automatic dependency trapping.

```ts
import { Retree, ReactiveNode, memo } from "@retreejs/core";

interface Card {
    text: string;
}

class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    @memo
    get filteredList(): Card[] {
        return this.list.filter((c) => c.text === this.searchText);
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

    // Only invalidate when the list identity/reproxy or search text changes.
    @memo((self: ListFilter) => [self.list, self.searchText])
    get filteredList(): Card[] {
        return this.list.filter((c) => c.text === this.searchText);
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

##### `@fnMemo` decorator (recommended for deterministic methods)

Use this when a method is deterministic for a given argument list plus the Retree values it reads. Method arguments are always shallow-compared. Use `@fnMemo` or `@fnMemo()` with no comparisons for automatic dependency trapping.

```ts
import { Retree, ReactiveNode, fnMemo } from "@retreejs/core";

class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    @fnMemo
    public filteredList(limit: number): Card[] {
        return this.list
            .filter((c) => c.text === this.searchText)
            .slice(0, limit);
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

Pass a comparison function when you want to manually choose the cache keys. The function receives the current instance followed by the method arguments:

```ts
class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    @fnMemo((self: ListFilter, limit: number) => [
        self.list,
        self.searchText,
        limit,
    ])
    public filteredList(limit: number): Card[] {
        return this.list
            .filter((c) => c.text === this.searchText)
            .slice(0, limit);
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

##### `this.memo(fn, deps?)` (keyless, inside a getter)

Use this when you want decorator-like cache behavior but need to wrap only part of a getter body. The cache key is derived from the active getter's name automatically. Throws if called outside a getter, or more than once in the same getter without an explicit key.

```ts
class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    get filteredList(): Card[] {
        return this.memo(() =>
            this.list.filter((c) => c.text === this.searchText)
        );
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}
```

##### `this.memo(key, fn, deps?)` (explicit key)

Use this when you need multiple memo cells in the same getter, or when caching a result inside a method.

```ts
class ListFilter extends ReactiveNode {
    public list: Card[] = [];
    public searchText = "";

    get pair(): { filtered: Card[]; count: number } {
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

##### Cache Semantics

The same comparison rules apply to all forms. For `@fnMemo`, the method arguments are also compared every call:

| Form / comparisons                                                             | Behavior                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@memo`, `@memo()`, `@fnMemo`, `@fnMemo()`, or omitted `this.memo` comparisons | Automatically trap Retree reads and recompute when a trapped value changes.                                                                           |
| Function returns `undefined`                                                   | Recompute whenever the `ReactiveNode` reproxies (a property was set on it or one of its dependencies changed). Useful as a "compute once per render." |
| Function returns `[]`                                                          | Compute once and cache forever for that instance.                                                                                                     |
| Function returns `[a, b, ...]`                                                 | Recompute when any cell shallow-changes (compared with `Object.is`).                                                                                  |

**Tree-node cells in `deps` are compared by their latest reproxy identity, not by the stable buildProxy reference.** That's why `[this.list, this.searchText]` correctly invalidates when `list` mutates — without this, `this.list` would always look unchanged because Retree returns the same buildProxy for the lifetime of the tree.

The cache is per-instance and stored in a `WeakMap` keyed by the unproxied `ReactiveNode`, so it follows the instance's lifetime and is naturally garbage-collected when the node is dropped.

#### Move, link, or clone existing nodes

Retree keeps a pure ownership tree: a node can have one structural parent. If an existing node needs to appear somewhere else, choose the operation that matches your intent.

-   `Retree.move(node, destination, key?)` transfers ownership. Arrays accept a numeric insertion index or append when omitted. Maps and objects require a key. Sets ignore the key.
-   `Retree.link(node)` creates a reactive pointer object with `.current`. The link can be stored in the tree without reparenting the target.
-   `@link` marks a `ReactiveNode` field as a reactive pointer. Replacing the field emits on the owner, but the assigned node keeps its existing parent.
-   `Retree.clone(node)` creates a detached copy that can become a new child elsewhere.

```ts
import { Retree, ReactiveNode, link } from "@retreejs/core";

const task = projectA.tasks[0];
Retree.move(task, projectB.tasks);

root.selectedTask = Retree.link(task);
root.selectedTask.current.title = "Selected";

class EditorState extends ReactiveNode {
    @link public selectedTask: Task | null = null;

    get dependencies() {
        return [];
    }
}
```

#### Opt fields out of reactivity with `@ignore`

`@ignore` is a class-field decorator that excludes a property of a `ReactiveNode` from Retree's reactivity system. Reads and writes to the field still work normally — what's skipped is **listener emission**:

-   Nested mutations like `this.cache.foo = 1` do **not** fire `nodeChanged` / `treeChanged` on the `ReactiveNode` or its ancestors.
-   Replacing the field at the top level (`this.cache = {...}`) likewise skips emission.
-   The proxy will not wrap the field's value or build child proxies underneath it.

Use it for state that lives on a `ReactiveNode` but shouldn't participate in the tree — caches, scratch buffers, framework handles, references to objects already managed elsewhere, etc.

```ts
import { Retree, ReactiveNode, ignore } from "@retreejs/core";
import { useNode } from "@retreejs/react";

class Counter extends ReactiveNode {
    public count = 0;
    // Mutations under `cache` do not trigger Retree listeners or re-renders.
    @ignore public cache: Record<string, unknown> = {};

    get dependencies() {
        return [];
    }
}

const node = Retree.root(new Counter());
const state = useNode(node);

// ❌ no re-render
node.cache.something = 1;
// ❌ no re-render — replacing the field also skips emission
node.cache = { other: 2 };
// ✅ re-renders
node.count += 1;
```

**Caveat:** because the proxy doesn't wrap an `@ignore`-d field's value, plain objects stored under it lose `Retree.parent(...)` and won't appear in `treeChanged` notifications. If you store an existing Retree-managed node in an ignored field, Retree does not reparent it, but reads still return that node's latest reproxy.

#### Transactions

If you are making multiple changes to one or many nodes at once, you can use `Retree.runTransaction` function to only set to React state once per instance of `useNode` or `useTree`. Here is an example:

```ts
const _counter = Retree.root({ count: 0 });
const counter = useNode(_counter);
// Will only emit "nodeChanged" once
Retree.runTransaction(() => {
    counter.count = counter.count + 1;
    counter.count = counter.count * 2;
});
```

#### Skip re-rendering changes

If you want to skip re-rendering on a change, you can use the `Retree.runSilent` function. Here is an example:

```ts
const counter = Retree.root({ count: 0, multiplier: 1 });
const counterState = useNode(counter);
// Skip re-render on setting the multiplier
function onClickIncrementMultiplier() {
    Retree.runSilent(() => {
        counterState.multiplier += 1;
    });
}
// Re-render when user clicks button
function onClickIncrementCount() {
    counterState.count = counterState.count * counterState.multiplier;
}
```

**Note:** if you want nodes to still be reproxied when they change for React's comparison checks but don't yet want to re-render, set the `skipReproxy` prop in `Retree.runSilent` to `false`.

### React samples

See the [Cat Facts sample](https://github.com/ryanbliss/retree/tree/main/samples/02.react-example) or [recursive tree](https://github.com/ryanbliss/retree/tree/main/samples/03.react-recursion) for more examples of `@retreejs/react`.

## @retreejs/core

### How to install

Install with `npm`:

```bash
npm i @retreejs/core
```

Install with `yarn`:

```bash
yarn add @retreejs/core
```

### How to use

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
const unsubscribe = Retree.on(tree.todos, "treeChanged", (todos, changes) => {
    console.log("list updated", todos, changes);
});
tree.add();
tree.todos[0].toggle();
tree.todos[0].delete();
unsubscribe();
```

### Core API examples

Use `Retree.on` when you need events outside React:

`nodeChanged` and `treeChanged` callbacks receive `(reproxiedNode, changes)`, where `changes` is an array of `{ key, previous, new }` records.

```ts
Retree.on(tree.todos, "nodeChanged", (_todos, changes) =>
    console.log("list changed", changes)
);
Retree.on(tree.todos, "treeChanged", (_todos, changes) =>
    console.log("list or child changed", changes)
);

tree.todos.push(new Todo()); // ✅ nodeChanged, ✅ treeChanged
tree.todos[0].toggle(); //    ❌ nodeChanged on list, ✅ treeChanged on list
```

Use `Retree.select` when only one selected value or dependency list matters:

```ts
const unsubscribeDoneCount = Retree.select(
    tree.todos,
    (todos) => todos.filter((todo) => todo.checked).length,
    (doneCount) => console.log(doneCount),
    { listenerType: "treeChanged" }
);

tree.todos[0].toggle(); // ✅ emits if done count changes
tree.todos[0].text = "Docs"; // ❌ no emit if done count is unchanged
unsubscribeDoneCount();
```

`Retree.select` can also infer dependencies when you pass only a selector function and callback:

```ts
Retree.select(
    () => tree.todos.filter((todo) => todo.checked).length,
    (doneCount) => console.log(doneCount)
);
```

`Retree.select` also accepts ordered dependency lists. Reactive entries subscribe; primitive entries compare:

```ts
Retree.select(
    row,
    (self) => [self.attributes, self.attributeId, self.attribute],
    ([, , attribute]) => console.log(attribute)
);
```

Dependency-list subscriptions in `Retree.select` are observational: selected dependency changes can call the callback, but they do not force the node passed to `Retree.select` to receive a fresh reproxy.

Use `Retree.move`, `Retree.link`, and `Retree.clone` to make ownership explicit:

```ts
const task = projectA.tasks[0];

Retree.move(task, projectB.tasks); // ✅ transfers ownership
projectA.selected = Retree.link(task); // ✅ points at task without reparenting
projectA.tasks.push(Retree.clone(task)); // ✅ independent copy
```

Use `Retree.parent` for tree-local operations:

```ts
const parent = Retree.parent(tree.todos[0]);
if (Array.isArray(parent)) {
    parent.splice(0, 1); // ✅ removes the task and emits on the parent list
}
```

Use `ReactiveNode.prepareTree` when you want lazy child proxy setup to happen before first render or first interaction:

```ts
class ProjectState extends ReactiveNode {
    public tasks = [{ title: "Docs", comments: [] }];

    get dependencies() {
        return [];
    }
}

const root = Retree.root(new ProjectState());
root.prepareTree({ depth: 1 });
```

Use `Retree.raw` for native-speed, read-only scans; `Retree.source` to
resolve raw values back to managed nodes; `Retree.peekInto` to query raw and
get the managed result in one call; and `Retree.untracked` to pause
dependency tracking during bulk reads:

```ts
const rawTasks = Retree.raw(tree.todos); // ✅ proxy-free, native-speed reads
const found = Retree.peekInto(tree.todos, (raw) =>
    raw.find((todo) => todo.id === id)
);
found?.toggle(); // ✅ peekInto resolved the managed node

const managed = Retree.source(rawTasks[0]); // raw → managed node
```

Raw subtrees are guaranteed proxy-free under every write path (raw purity),
so `structuredClone(Retree.raw(node))` is a valid point-in-time copy. Treat
raw values as read-only, never use raw references as memo/equality tokens,
and note that change payloads (`INodeFieldChanges.previous` / `.new`) are
always raw values — `Retree.source(change.previous)` opts back into the
managed node.

### Core samples

See the [useNode React hook](https://github.com/ryanbliss/retree/blob/main/packages/retree-react/src/useNode.ts) or [example 01 project](https://github.com/ryanbliss/retree/tree/main/samples/01.core-example) for more example usages.

## @retreejs/convex

Retree Convex lets a `ReactiveNode` own a Convex client, create typed query nodes with `this.query(...)`, run one-off queries with `this.queryOnce(...)`, call actions and mutations, subscribe to paginated queries, and track connection state. Query results are written into Retree state, Convex document arrays are reconciled by `_id` by default, and optimistic updates can be applied narrowly to existing query state.

### How to install

Install with `npm`:

```bash
npm i @retreejs/core @retreejs/convex convex
```

Install with `yarn`:

```bash
yarn add @retreejs/core @retreejs/convex convex
```

### How to use

```ts
import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;

    constructor(convexUrl: string) {
        const client = new ConvexClient(convexUrl);
        super(client);
        this.tasks = this.query(api.tasks.get);
    }

    get dependencies() {
        return [];
    }

    public toggleCompleted(taskId: Id<"tasks">): Promise<null> {
        const toggleCompleted = this.mutation(api.tasks.toggleCompleted);
        return toggleCompleted(
            { taskId },
            {
                withOptimisticUpdate: (ctx) => {
                    this.tasks.optimisticUpdate({
                        ctx,
                        apply(tasks) {
                            const task = tasks.find((candidateTask) => {
                                return candidateTask._id === taskId;
                            });
                            if (!task) return;

                            task.isCompleted = !task.isCompleted;
                        },
                    });
                },
            }
        );
    }
}
```

## @retreejs/react-convex

Retree React Convex adapts Convex's `ConvexReactClient` to the Retree Convex client interface. Use it in React apps that want one Convex client instance for both Convex React hooks/`ConvexProvider` and Retree `ConvexNode` state.

### How to install

Install with `npm`:

```bash
npm i @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```

Install with `yarn`:

```bash
yarn add @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```

### How to use

```tsx
"use client";

import { useNode, useRoot } from "@retreejs/react";
import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { RetreeConvexReactClient } from "@retreejs/react-convex";
import { api } from "../convex/_generated/api";

const convexClient = new RetreeConvexReactClient(
    process.env.NEXT_PUBLIC_CONVEX_URL!
);

class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;

    constructor() {
        super(convexClient);
        this.tasks = this.query(api.tasks.get, { initialState: [] });
    }

    get dependencies() {
        return [];
    }
}

export function TaskList() {
    const root = useRoot(() => new TasksState());
    const state = useNode(root);

    return (
        <ul>
            {state.tasks.state?.map((task) => {
                return <li key={task._id}>{task.text}</li>;
            })}
        </ul>
    );
}
```

`useNode(root)` releases its Retree observer on unmount. `ConvexNode` then disposes live query, paginated query, and connection-state children created through its helper methods.

## Docs

Docs are hosted at https://ryanbliss.github.io/retree/.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
