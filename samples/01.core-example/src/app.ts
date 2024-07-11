/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Retree, TreeNode } from "@retreejs/core";
import { renderError } from "./renderError";

const searchParams = new URL(window.location.href).searchParams;
const root = document.getElementById("content")!;

// STARTUP LOGIC

async function start() {
    console.log("start");
    // Check for page to display
    let view = searchParams.get("view") || "stage";

    class Node {
        count: number = 0;
        constructor(public readonly id: string) {}
    }

    class Schema {
        constructor(
            public count: number,
            public text: string,
            public node: Node,
            public list: string[]
        ) {}
    }

    const schema = new Schema(0, "", new Node("initial"), []);

    const root = Retree.use(schema);
    const unsubscribe = Retree.on(root, "nodeChanged", (reproxy) => {
        console.log("nodeChanged root:", root, reproxy === root);
        if (reproxy.count === 1) {
            console.log("nodeChanged root: setting count via reproxy");
            reproxy.count += 1;
        }
    });

    function listenToNode() {
        const node = root.node;
        const unsubscribe2 = Retree.on(node, "nodeChanged", (reproxy) => {
            console.log("nodeChanged node", node.id, node, reproxy === node);
        });
        const unsubscribe3 = Retree.on(node, "nodeRemoved", () => {
            console.log("nodeRemoved node", node.id, node);
            unsubscribe2();
            unsubscribe3();
            listenToNode();
            console.log("setting count for removed node");
            node.count += 1;
        });
    }
    listenToNode();

    root.count += 1;
    root.text = "Hello";
    root.node.count += 1;
    root.node = new Node("second");
    root.node.count += 1;
    console.log("pushing to list");
    function addToListRecursive(list: TreeNode<string[]>, maxToAdd: number) {
        const listUnsubscribe = Retree.on(list, "nodeChanged", (reproxy) => {
            console.log("nodeChanged list", list, root.list === list);
            listUnsubscribe();
            if (list.length < maxToAdd) {
                addToListRecursive(reproxy, maxToAdd);
            }
        });
        root.list.push(`item-${list.length}`);
    }
    addToListRecursive(root.list, 3);

    unsubscribe();
}

start().catch((error) => renderError(root, error));
