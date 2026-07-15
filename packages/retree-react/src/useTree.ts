/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo" is load-bearing when this source is compiled by the React
// Compiler (source-inclusion setups only; consumers' compilers skip the
// published bin/ output in node_modules). See useNodeInternalCore.ts and
// react-compiler.spec.tsx for the failure mode and proof.
"use no memo";
"use client";

import { Retree, TreeNode } from "@retreejs/core";
import { useNodeInternal } from "./internals/useNodeInternal.js";
import { NodeFactory } from "./types.js";

const LISTENER_TYPE = "treeChanged";

/**
 * Stateful version of an object and its child nodes.
 *
 * @remarks
 * `useTree` subscribes to `treeChanged`, so the component re-renders when the
 * node or any descendant changes. Use it for small local subtrees that should
 * render together, such as a compact summary or table section.
 *
 * Do not use `useTree` as the default for broad app roots. Prefer
 * `useNode(child)` for focused child components and `useSelect(...)` for
 * derived values. The root of the node provided must have been first passed
 * to {@link Retree.root}.
 *
 * @param node object to make stateful
 * @returns a stateful version of the node provided
 * 
 * @example
 * ```tsx
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
 * ```
 */
export function useTree<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>
): T {
    return useNodeInternal(node, LISTENER_TYPE, "useTree");
}
