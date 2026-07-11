# @retreejs/react README

> Generated from the React package README used by TypeDoc package docs.
> Source: `packages/retree-react/README.md`

# Retree React

Retree is a lightweight and simple state management library, specifically designed for frameworks like React. If you know how to work with objects in JavaScript or TypeScript, you pretty much already know how to use Retree.

Retree React enables a performant, intuitive interface for managing app state of any complexity. It is designed to seamlessly mix-and-match class-based data layers with React hooks with minimal boilerplate.

## How to install

Install with `npm`:

```bash
npm i @retreejs/core @retreejs/react
```

Install with `yarn`:

```bash
yarn add @retreejs/core @retreejs/react
```

## Feature glossary

-   [`useRoot`](#useroot-hook) creates one Retree root for a component lifetime. Use it when state belongs to a React subtree.
-   [`useNode`](#usenode-hook) subscribes to direct `nodeChanged` events. Use it for focused components that own one node.
-   [`useTree`](#usetree-hook) subscribes to `treeChanged` events from a node and descendants. Use it for small subtrees that should re-render together.
-   [`useSelect`](#useselect-hook) subscribes to a selected value or ordered dependency list and re-renders only when it changes. Use it for counts, totals, booleans, labels, and other narrow projections.
-   [`useRaw`](#useraw-hook) subscribes like `useNode` but returns `[raw, toSource]` for native-speed, proxy-free reads. Use it for components that read wide during render.
-   [`@select`](https://github.com/ryanbliss/retree/tree/main/packages/retree-core#reactive-dependencies) decorates a getter with an ordered dependency list. Use it when VM logic should stay in the `ReactiveNode` while `useNode(node)` stays selective.
-   [`ReactiveNode.dependencies`](#reactivenode) can make a node emit `nodeChanged` from narrow dependencies. Return raw reactive nodes/primitives directly, or wrap one slot with `this.dependency(node, comparisons)`.
-   [`memo`, `@memo`, and `@fnMemo`](https://github.com/ryanbliss/retree/tree/main/packages/retree-core#memoize-computed-getters) cache expensive computed values. They do not trigger renders by themselves.
-   [`@ignore`](https://github.com/ryanbliss/retree/tree/main/packages/retree-core#opt-fields-out-of-reactivity-with-ignore) stores non-rendered state on a `ReactiveNode`. Writes do not emit and therefore do not re-render React subscribers.

## How to use

It's extremely easy to get started with Retree. The main React hooks are `useNode`, `useTree`, and `useSelect`. Each has specific advantages while leveraging the same simple interface.

### useRoot hook

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

### useSelect hook

Use `useSelect` when a component needs a selected value or dependency list from a Retree node but should only re-render when that selection changes. It accepts any Retree-managed node, not only a root.

```tsx
import { Retree } from "@retreejs/core";
import { useSelect } from "@retreejs/react";

const root = Retree.root({
    total: 20,
    taxRate: 0.08,
});

function TotalRow() {
    const total = useSelect(
        root,
        (invoice) => invoice.total * (1 + invoice.taxRate)
    );

    return <td>{total}</td>;
}
```

```tsx
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
function DoneCount() {
    const doneCount = useSelect(
        () => project.tasks.filter((task) => task.done).length
    );

    return <span>{doneCount}</span>;
}

project.tasks[0].done = true; // ✅ re-renders DoneCount
project.tasks[0].title = "Better docs"; // ❌ no re-render: doneCount stayed 2
```

Selectors can return an ordered dependency list. Reactive entries are subscribed to; primitive entries are compared. This lets a component listen broadly enough to stay fresh without re-rendering for unrelated changes.

```tsx
function AttributeLabel({ row }: { row: AttributeRow }) {
    const [, , attribute] = useSelect(row, (self) => [
        self.attributes,
        self.attributeId,
        self.attribute,
    ]);

    return <span>{attribute?.label}</span>;
}
```

`useSelect` listens with `nodeChanged` by default. This is best for selecting direct values owned by that exact node, including `ReactiveNode` values that emit when their dependencies change. Pass `listenerType: "treeChanged"` when the selector intentionally reads descendant nodes.

Dependency-list subscriptions in `useSelect` are observational. If `self.attributes` or `self.attribute` changes in the example above, the component can re-render, but the `row` node passed to `useSelect` is not forced to receive a fresh reproxy. Use `@select` on a `ReactiveNode` getter when the owner node itself should emit `nodeChanged`. Use `@select()` with no selector when the getter should trap reads automatically, including property-level reads like `task.done`.

`useSelect` is a subscription primitive, not a memo cache. Use `memo` or `fnMemo` to cache expensive computation, and use `useSelect` to narrow React updates. If your selector returns a fresh object or array, pass `equals` to avoid re-rendering when the selected value is logically unchanged.

### useNode hook

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

### useTree hook

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

### useRaw hook

Use `useRaw` when a component reads wide during render — big tables, canvas
layers, subtree serialization — and per-property proxy reads show up in
profiles. It subscribes exactly like `useNode` (`nodeChanged` by default) but
returns `[raw, toSource]`: the live raw object for native-speed reads plus a
resolver back to managed nodes.

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

-   The prop passed to children is the **node** (`toSource(rawTask)`), never
    the raw value. Nodes carry subscriptions, writes, navigation, and
    identity; raw is a local read view.
-   `toSource` always resolves direct children of the subscribed node —
    object/array children, Map values, and Set members — materializing them
    on demand.
-   Invalidation matches `useNode`: deep changes re-render only when declared
    — via the node's `dependencies` / `@select`, via `useSelect` for derived
    views, or via the `listenerType: "treeChanged"` opt-in. Raw is live, so
    any render (including parent-triggered ones) reads current state.
-   Do not filter or aggregate raw content inline when membership must stay
    in lockstep with deep fields — that is derived state; use `useSelect`.
-   Never write to raw values, and never use raw references as `React.memo`
    props or `useMemo` deps.

## React performance guide

Retree's fastest React path is narrow subscription plus narrow render work:

-   Use `useNode(child)` when a component owns one child node.
-   Use `useSelect(node, selector)` when a component only needs a derived value.
-   Use `useTree(node)` when a component truly needs descendant changes from a subtree.
-   Avoid constructing new Retree roots or large `ReactiveNode` trees during render. Create them outside React render, in stable module state, or with `useMemo` / `useState` initialization.

```tsx
function TodoRow({ todo }: { todo: Todo }) {
    const state = useNode(todo);
    return <input checked={state.checked} readOnly />;
}

function TodoCount({ todos }: { todos: Todo[] }) {
    const completed = useSelect(
        todos,
        (items) => items.filter((todo) => todo.checked).length,
        { listenerType: "treeChanged" }
    );
    return <span>{completed}</span>;
}
```

`useTree` maps to broad descendant invalidation. It is still useful, especially for small local subtrees, but it should not be the default for large app-level roots. If a `useTree` component reads deeply on every render, the render itself becomes part of the benchmark cost.

`ReactiveNode.dependencies` and `@select` are often better bridges than `useTree` when one node needs to update from another node. Dependency lists can change length/order; Retree treats shape changes as invalidation and refreshes subscriptions. Return raw reactive nodes/primitives directly for simple slots, and use `this.dependency(node, comparisons)` when one slot needs custom comparison values. Prefer `@select` for hot filtered lists where one getter should listen to a broad collection but only emit when the selected items or selected order changes. Keep setup work in `onObserved()` instead of inside the `dependencies` getter.

Plain object and array fields on `ReactiveNode` are prepared lazily. This reduces initial proxy/setup time, but the first nested read pays the preparation cost. If you want to pay that cost during a loading state, call `node.prepareTree({ depth })` or opt into `super({ prepare: { autoPrepare: true, depth } })`.

## Optimize for performance

`Retree` offers useful utility APIs for further optimizing performance, including `ReactiveNode`, `Retree.runTransaction`, and `Retree.runSilent`.

### ReactiveNode

The `ReactiveNode` class allows nodes in your tree to reactively update when their declared dependencies change. This offers a middleground between `useTree` and `useNode` that can be extremely powerful for minimizing re-renders in your application.

```tsx
import { Retree, ReactiveNode } from "@retreejs/core";
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

### Transactions

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

### Skip re-rendering changes

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

## React samples

See the [Cat Facts sample](https://github.com/ryanbliss/retree/tree/main/samples/02.react-example) or [recursive tree](https://github.com/ryanbliss/retree/tree/main/samples/03.react-recursion) for more examples of `@retreejs/react`.

## Docs

Docs are hosted at https://ryanbliss.github.io/retree/.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
