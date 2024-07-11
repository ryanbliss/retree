/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { Retree, TreeNode } from "@retreejs/core";
import { useEffect, useState } from "react";

export function useTree<T extends TreeNode = TreeNode>(node: T) {
    const [nodeState, setNodeState] = useState(node);

    useEffect(() => {
        const unsubscribe = Retree.on(node, "treeChanged", (proxy) => {
            setNodeState(proxy);
        });
        return unsubscribe;
    }, [node]);

    return nodeState;
}
