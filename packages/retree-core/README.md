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
    constructor(public text: string, public checked: boolean) {}
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
    constructor(public todos: Todo[]) {}
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

## Core samples

See the [useNode React hook](./packages/retree-react/src/useNode.ts) or [example 01 project](./samples/01.core-example/) for more example usages.

# Licensing & Copyright

Copyright (c) Ryan Bliss. All rights reserved.
Licensed under MIT license.

Credit to [Fluid Framework](https://aka.ms/fluid)'s new [SharedTree](https://fluidframework.com/docs/data-structures/tree/) feature, which has served as a major inspiration for this project. If you want to use collaborative objects, I recommend checking out Fluid Framework!
