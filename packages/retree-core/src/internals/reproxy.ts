/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import {
    getCustomProxyHandler,
    getBaseProxy,
    getUnproxiedNode,
} from "./buildProxy";
import {
    ICustomProxyHandler,
    proxiedChildrenKey,
    unproxiedBaseNodeKey,
    proxiedParentKey,
} from "./proxy-types";

const reproxyMap: WeakMap<TreeNode, TreeNode> = new WeakMap();

export function updateReproxyNode<T extends TreeNode = TreeNode>(node: T): T {
    const handler = getCustomProxyHandler(node);
    if (!handler) {
        throw new Error("Cannot reproxy a root unproxied node");
    }
    const rootNode = handler[unproxiedBaseNodeKey];
    const reproxy = buildReproxy<T>(node);
    reproxyMap.set(rootNode, reproxy);
    return reproxy;
}

export function getReproxyNode<T extends TreeNode = TreeNode>(node: T): T {
    const handler = getCustomProxyHandler(node);
    if (!handler) {
        throw new Error("Cannot reproxy a root unproxied node");
    }
    const rootNode = handler[unproxiedBaseNodeKey];
    // If we haven't reproxied, we return the original TreeNode
    return (reproxyMap.get(rootNode) ?? node) as T;
}

function buildReproxy<T extends TreeNode = TreeNode>(object: T): T {
    const handler = getCustomProxyHandler(object);
    if (!handler) {
        throw new Error("Cannot reproxy a root unproxied node");
    }
    const proxyHandler: ProxyHandler<T> &
        Omit<ICustomProxyHandler<T>, typeof proxiedChildrenKey> = {
        // Add some extra stuff into the handler so we can store the original TreeNode and access it later
        // Without overriding the rest of the getters in the object.
        [unproxiedBaseNodeKey]: handler[unproxiedBaseNodeKey] as T,
        [proxiedParentKey]: handler[proxiedParentKey],
        get: (target, prop, receiver) => {
            if (prop === "[[Handler]]") {
                return proxyHandler;
            }
            if (prop === "[[Target]]") {
                return object;
            }
            if (
                typeof prop === "string" &&
                prop !== "constructor" &&
                handler[proxiedChildrenKey][prop]
            ) {
                const childProxy = handler[proxiedChildrenKey][prop];
                const reproxy = getReproxyNode(childProxy);
                return reproxy ?? childProxy;
            }
            const baseProxy = getBaseProxy(receiver);
            const reproxy = getReproxyNode(baseProxy);
            const rawNode = getUnproxiedNode(baseProxy);
            const value = Reflect.get(rawNode ?? target, prop, receiver);
            return typeof value === "function" ? value.bind(reproxy) : value;
        },
        set(target, prop, newValue, receiver) {
            return Reflect.set(target, prop, newValue, receiver);
        },
    };
    const proxy = new Proxy(object, proxyHandler);
    return proxy;
}
