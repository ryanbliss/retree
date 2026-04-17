/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import { getCustomProxyHandler, getBaseProxy, getUnproxiedNode } from "./proxy";
import {
    ICustomProxyHandler,
    proxiedChildrenKey,
    unproxiedBaseNodeKey,
    proxiedParentKey,
    TCustomProxy,
} from "./proxy-types";

const reproxyMap: WeakMap<TreeNode, TCustomProxy<TreeNode>> = new WeakMap();

export function updateReproxyNode<T extends TreeNode = TreeNode>(
    node: TCustomProxy<T>
): TCustomProxy<T> {
    const handler = getCustomProxyHandler(node);
    if (!handler) {
        throw new Error("Cannot reproxy a root unproxied node");
    }
    const unproxiedNode = handler[unproxiedBaseNodeKey];
    const reproxy = buildReproxy<T>(node);
    reproxyMap.set(unproxiedNode, reproxy);
    return reproxy;
}

export function getReproxyNode<T extends TreeNode = TreeNode>(node: T): T {
    const handler = getCustomProxyHandler<T>(node);
    if (!handler) {
        throw new Error("Cannot get a reproxy for a root unproxied node");
    }
    const unproxiedNode = handler[unproxiedBaseNodeKey];
    // If we haven't reproxied, we return the original TreeNode
    return (getReproxyNodeForUnproxiedNode(unproxiedNode) ?? node) as T;
}

export function getReproxyNodeForUnproxiedNode<T extends TreeNode = TreeNode>(
    unproxiedNode: T
): TCustomProxy<T> | undefined {
    return reproxyMap.get(unproxiedNode) as TCustomProxy<T> | undefined;
}

function buildReproxy<T extends TreeNode = TreeNode>(
    object: T
): TCustomProxy<T> {
    const handler = getCustomProxyHandler(object);
    if (!handler) {
        throw new Error("Cannot reproxy a root unproxied node");
    }
    const proxyHandler: ProxyHandler<T> &
        Omit<ICustomProxyHandler<T>, typeof proxiedChildrenKey> = {
        // Add some extra stuff into the handler so we can store the original TreeNode and access it later
        // Without overriding the rest of the getters in the object.
        [unproxiedBaseNodeKey]: handler[unproxiedBaseNodeKey],
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
            const baseProxy: TCustomProxy<T> = getBaseProxy(receiver);
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
    return proxy as TCustomProxy<T>;
}
