/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import { TreeChangeEmitter } from "./NodeChangeEmitter";
import {
    ICustomProxy,
    ICustomProxyHandler,
    IProxyParent,
    isCustomProxy,
    isCustomProxyHandler,
    proxiedChildrenKey,
    proxiedParentKey,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types";
import { getReproxyNodeForUnproxiedNode, updateReproxyNode } from "./reproxy";
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
    parent?: IProxyParent<any>
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
            const baseProxy = getBaseProxy<T>(receiver);
            if (hasChanged) {
                let valueToSet = newValue;
                let nodeRemoved: object | undefined;
                if (
                    newValue === undefined ||
                    newValue === null ||
                    typeof newValue === "object"
                ) {
                    // If `receiver` has a value, we are replacing it with a new one
                    nodeRemoved = handleNodeRemoved(baseProxy, prop);
                }
                if (typeof newValue === "object") {
                    if (prop === "constructor")
                        return Reflect.set(target, prop, newValue, receiver);

                    // If already a proxied object, we simply reparent
                    // Otherwise, build a new proxy object
                    const parentToSet: IProxyParent<any> = {
                        proxyNode: baseProxy,
                        propName: prop,
                    };
                    valueToSet = isCustomProxy(newValue)
                        ? reparentProxy(newValue, parentToSet)
                        : buildProxy(newValue, emitter, parentToSet);
                    proxyHandler[proxiedChildrenKey][prop] = valueToSet;
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
        deleteProperty(target, prop) {
            // Good example of `deleteProperty` is when an item is removed / moved in a list.
            // `deleteProperty` does not expose the receiver...get the latest reproxy instead.
            // TODO: should revisit this at some point...
            const baseProxy = isCustomProxy(target)
                ? getBaseProxy(target)
                : getReproxyNodeForUnproxiedNode(target);
            const nodeRemoved = handleNodeRemoved(baseProxy, prop);
            const returnValue = Reflect.deleteProperty(target, prop);
            // If in a skip reproxy transaction, do not reproxy node
            if (!Transactions.skipReproxy) {
                if (baseProxy) {
                    const reproxy = updateReproxyNode(baseProxy);
                    // Still emit here if in a `skipEmit` transaction so that parents get reproxied
                    emitter.emit(
                        "nodeChanged",
                        proxyHandler[unproxiedBaseNodeKey],
                        baseProxy,
                        reproxy
                    );
                } else {
                    console.warn(
                        `buildProxy.deleteProperty: cannot find baseProxy for target`
                    );
                }
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
        },
    };
    const proxy = new Proxy(object, proxyHandler) as TCustomProxy<T>;
    Object.entries(object).forEach(([prop, value]) => {
        if (typeof value === "object") {
            const cProxy = buildProxy(value, emitter, {
                proxyNode: proxy,
                propName: prop,
            });
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
 * @param newParent parent proxy object to set a reference to the proxied child
 */
function reparentProxy<T extends TreeNode = TreeNode>(
    proxy: ICustomProxy<T>,
    newParent: IProxyParent<any>
) {
    const currentParent = proxy["[[Handler]]"][proxiedParentKey];
    // Reproxy shares same reference to original IProxyParent object.
    // Set deep values directly.
    if (currentParent) {
        if (
            currentParent.proxyNode !== null &&
            newParent.proxyNode !== null &&
            // It's okay to reference a node twice in the same object.
            // This is especially common when moving an item in a list from one index to another.
            // Such a case is usually temporary, but it doesn't have to be.
            currentParent.proxyNode !== newParent.proxyNode
        ) {
            throw new Error(
                "A node can only have a single parent. To move the node to a new parent, first remove it from the previous parent and then set it to the new object."
            );
        }
        currentParent.propName = newParent.propName;
        currentParent.proxyNode = newParent.proxyNode;
    }
    return proxy;
}

/**
 *
 * @param node the node that has a value being removed
 * @param prop the prop being removed
 * @returns an node that was removed, if it exists
 */
function handleNodeRemoved(
    node: object | undefined,
    prop: string | symbol
): object | undefined {
    const nodeRemoved = (node as any)?.[prop];
    if (typeof nodeRemoved === "object") {
        // Remove parent reference
        const oldHandler = getCustomProxyHandler(nodeRemoved);
        if (oldHandler) {
            const oldParent = oldHandler[proxiedParentKey];
            // If the prop of the parent doesn't match, it was recently set to a new node.
            // That means it is still part of the object tree, and thus we do not want to notify node removed.
            if (!oldParent || oldParent?.propName !== prop) {
                return undefined;
            }
            // Reproxy shares same reference to original IProxyParent object.
            // Set deep values directly.
            oldParent.propName = null;
            oldParent.proxyNode = null;
        }
    }
    return nodeRemoved;
}

/**
 * @internal
 * Gets the raw node for a given proxied tree node
 *
 * @param proxy the proxied TreeNode to get the raw node for
 * @returns the raw node if valid, otherwise undefined
 */
export function getUnproxiedNodeFromProxy<TNode extends TreeNode = TreeNode>(
    proxy: TCustomProxy<TNode>
): TNode {
    return proxy["[[Handler]]"][unproxiedBaseNodeKey];
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
    if (isCustomProxy<TNode>(node)) {
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
export function getBaseProxy<T extends TreeNode = TreeNode>(
    node: T
): TCustomProxy<T> {
    if (isCustomProxy<T>(node)) {
        const target = node["[[Target]]"];
        if (isCustomProxy<T>(target)) {
            return getBaseProxy<T>(target as T);
        }
        return node;
    }
    throw new Error("Unproxied object");
}
