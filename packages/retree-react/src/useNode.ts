/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { TreeNode } from "@retreejs/core";
import { useNodeInternal } from "./internals/useNodeInternal";
import { NodeFactory } from "./types";

const LISTENER_TYPE = "nodeChanged";

/**
 * Stateful version of an object and its leafs.
 *
 * @remarks
 * `useNode` subscribes to direct `nodeChanged` events for the node you pass.
 * Changes to fields owned by that node (for example `todo.text`) re-render
 * the component. Changes inside child nodes (for example
 * `project.tasks[0].text` when subscribed to `project`) do not re-render the
 * component.
 *
 * Use `useNode` for focused components such as list rows, panels, and forms.
 * Prefer it over `useTree` for hot paths. If the component only needs a
 * derived value, prefer `useSelect`.
 *
 * @param node object to make stateful
 * @returns a stateful version of the node provided.
 * 
 * @example
 * ```tsx
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
 * ```
 */
export function useNode<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>
): T {
    return useNodeInternal(node, LISTENER_TYPE);
}
