/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import { TreeChangeEmitter } from "./NodeChangeEmitter";
import {
    ICustomProxy,
    ICustomProxyHandler,
    isCustomProxy,
    isCustomProxyHandler,
    proxiedChildrenKey,
    proxiedParentKey,
    unproxiedBaseNodeKey,
} from "./proxy-types";
import { updateReproxyNode } from "./reproxy";
import { Transactions } from "./transactions";

/**
 * @internal
 * Builds a proxied object that emits changes when any value changes.
 * Also ensures `this` references are bound properly to functions, among other things.
 *
 * @param object base object to proxy
 * @param emitter event emitter to emit changes through
 * @param parent Optional. The parent of the object
 * @returns the proxied version of the object provided.
 */
export function buildProxy<T extends TreeNode = TreeNode>(
    object: T,
    emitter: TreeChangeEmitter,
    parent?: TreeNode
): T {
    const proxyHandler: ProxyHandler<T> & ICustomProxyHandler<T> = {
        // Add some extra stuff into the handler so we can store the original TreeNode and access it later
        // Without overriding the rest of the getters in the object.
        [unproxiedBaseNodeKey]: object,
        [proxiedChildrenKey]: {},
        [proxiedParentKey]: parent ?? null,
        get: (target, prop, receiver) => {
            if (prop === "[[Handler]]") {
                return proxyHandler;
            }
            if (prop === "[[Target]]") {
                return object;
            }
            if (
                typeof prop === "string" &&
                proxyHandler[proxiedChildrenKey][prop]
            ) {
                return proxyHandler[proxiedChildrenKey][prop];
            }
            const baseProxy = getBaseProxy(receiver);
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(baseProxy) : value;
        },
        set(target, prop, newValue, receiver) {
            const prev = (target as any)[prop];
            const hasChanged = prev !== newValue;
            const baseProxy = getBaseProxy(receiver);
            if (hasChanged) {
                let valueToSet = newValue;
                let nodeRemoved: object | undefined;
                if (typeof newValue === "object") {
                    if (prop === "constructor")
                        return Reflect.set(target, prop, newValue, receiver);
                    nodeRemoved = (receiver as any)[prop];
                    if (nodeRemoved) {
                        const oldHandler = getCustomProxyHandler(nodeRemoved);
                        if (oldHandler) {
                            oldHandler[proxiedParentKey] = null;
                        }
                    }
                    if (typeof prop === "string") {
                        // If already a proxied object, we simply reparent
                        valueToSet = isCustomProxy(newValue)
                            ? reparentProxy(newValue, baseProxy)
                            : buildProxy(newValue, emitter, receiver);
                        proxyHandler[proxiedChildrenKey][prop] = valueToSet;
                    } else {
                        console.warn(
                            "Retree buildProxy.ts: unexpected symbol",
                            prop
                        );
                    }
                }
                const returnValue = Reflect.set(
                    target,
                    prop,
                    valueToSet,
                    receiver
                );
                // If in a skip reproxy transaction, do not reproxy node
                if (!Transactions.skipReproxy) {
                    const reproxy = updateReproxyNode(baseProxy);
                    // Still emit here if in a `skipEmit` transaction so that parents get reproxied
                    emitter.emit(
                        "nodeChanged",
                        proxyHandler[unproxiedBaseNodeKey],
                        baseProxy,
                        reproxy
                    );
                    // nodeRemoved events do not reproxy parents, so we skip
                    if (nodeRemoved && !Transactions.skipEmit) {
                        emitter.emit(
                            "nodeRemoved",
                            proxyHandler[unproxiedBaseNodeKey],
                            nodeRemoved
                        );
                    }
                }

                return returnValue;
            }
            return true;
        },
    };
    const proxy = new Proxy(object, proxyHandler);
    Object.entries(object).forEach(([prop, value]) => {
        if (typeof value === "object") {
            const cProxy = buildProxy(value, emitter, proxy);
            proxyHandler[proxiedChildrenKey][prop] = getBaseProxy(cProxy);
        }
    });
    updateReproxyNode(proxy);
    return proxy;
}

/**
 * @internal
 * Gets the proxy handler for a given TreeNode, assuming `isCustomProxyHandler` returns true.
 * @param proxy the proxied TreeNode to get the handler for.
 * @returns the handler if valid, otherwise undefined
 */
export function getCustomProxyHandler<TNode extends TreeNode = TreeNode>(
    proxy: TNode
) {
    const handler = (proxy as any)["[[Handler]]"];
    if (isCustomProxyHandler<TNode>(handler)) {
        return handler;
    }
    return undefined;
}

/**
 * @internal
 * Reset the parent reference.
 * @param proxy proxied being object reparented
 * @param parent parent proxy object to set a reference to the proxied child
 */
function reparentProxy(proxy: ICustomProxy<any>, parent: ICustomProxy<any>) {
    proxy["[[Handler]]"][proxiedParentKey] = parent;
}

/**
 * @internal
 * Gets the raw node for a given proxied tree node
 *
 * @param proxy the proxied TreeNode to get the raw node for
 * @returns the raw node if valid, otherwise undefined
 */
function getUnproxiedNodeFromProxy<TNode extends TreeNode = TreeNode>(
    proxy: TNode
): TNode | undefined {
    const proxyHandler = getCustomProxyHandler<TNode>(proxy);
    if (proxyHandler) {
        return proxyHandler[unproxiedBaseNodeKey];
    }
    return undefined;
}

/**
 * @internal
 * We store a reference to the raw unproxied node in our proxied instances so we can easily access it at any proxy depth.
 *
 * @param node get the raw node from the proxy
 * @returns the raw unproxied object
 */
export function getUnproxiedNode<TNode extends TreeNode = TreeNode>(
    node: TNode
): TNode | undefined {
    if (isCustomProxy(node)) {
        return getUnproxiedNodeFromProxy<TNode>(node);
    }
    return node;
}

/**
 * @internal
 * Gets the base proxied object, aka meaning the non reproxied object.
 * @remarks
 * Recursively goes through each proxy until there are no more proxy references.
 *
 * @param node node to check
 * @returns the base proxied object
 */
export function getBaseProxy(node: TreeNode) {
    if (isCustomProxy(node)) {
        const target = node["[[Target]]"];
        if (isCustomProxy(target)) {
            return getBaseProxy(target);
        }
        return node;
    }
    throw new Error("Unproxied object");
}
