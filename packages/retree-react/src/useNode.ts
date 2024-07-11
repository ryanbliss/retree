/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Retree, TreeNode } from "@retreejs/core";
import { useEffect, useState } from "react";

/**
 * Stateful version of an object and its leafs.
 *
 * @remarks
 * Changes to child leafs (e.g., `node.text`) will cause this to re-render.
 * Changes to child nodes (e.g., `node.someObject.text`) will not cause this to re-render.
 * If the `nodeState` response is used in a comparison check, the old `nodeState` will not equal the new `nodeState`.
 *
 * @param node object to make stateful
 * @returns a stateful version of the node provided.
 * 
 * @example
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
 */
export function useNode<T extends TreeNode = TreeNode>(node: T) {
    const [nodeState, setNodeState] = useState(node);

    useEffect(() => {
        const unsubscribe = Retree.on(node, "nodeChanged", (proxy) => {
            setNodeState(proxy);
        });
        return unsubscribe;
    }, [node]);

    return nodeState;
}
