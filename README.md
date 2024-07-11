# Retree packages

Retree is a lightweight and simple state management library, specifically designed for frameworks like React. If you know how to work with objects in JavaScript or TypeScript, you pretty much already know how to use Retree.

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

It's extremely easy to get started with Retree. There are two React hooks: `useNode` and `useTree`. Each have specific advantages while leveraging the same simple interface.

#### useNode hook

If you adopt the `useNode` pattern, your apps will automatically inherit performant re-renders, since only the components that depend on each node in your object tree will re-render on changes. For this to work, you need to do the following:

1. Pass some object into `Retree.use`, e.g., `const root = Retree.use({ foo: "bar", list: [] })`
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

// Todo React component that acceps a Todo object as a prop
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
const root = Retree.use(new TodoList());

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

const whiteboardRoot = Retree.use({
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

#### useTree hook

In some cases it might be desirable to get re-renders for all child nodes at a given point in your object tree. In such cases, it can be impractical to put each child node in `useNode`. Fortunately, `useTree` makes this very simple.

Let's look at this simple example:

```jsx
import React from "react";
import { Retree } from "@retreejs/core";
import { useNode, useTree } from "@retreejs/react";

const table = Retree.use({
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
    // In this simple case, `useNode` and `useTree` can be used interchangably.
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
const root = Retree.use({
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

### React samples

See the [Cat Facts sample](./samples/02.react-example/) or [recursive tree](./samples/03.react-recursion/) for more examples of `@retreejs/react`.

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
        const index = parent.findIndex((c) => todo.id === c.id);
        parent.splice(index, 1);
    };
}

class TodoList {
    public todos: Todo[] = [];
    add() {
        this.todos.push(new Todo());
    }
}

const tree = Retree.use(new TodoList());

// Listen for changes to the todo list (e.g., todo created)
const unsubscribe = Retree.on(tree.todos, "treeChanged", (todos) => {
    console.log("list updated", todos);
});
tree.todos.add();
tree.todos[0].toggle();
tree.todos[0].delete();
unsubscribe();
```

### Core samples

See the [useNode React hook](./packages/retree-react/src/useNode.ts) or [example 01 project](./samples/01.core-example/) for more example usages.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
