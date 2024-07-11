/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types";
import { TreeChangeEmitter } from "./NodeChangeEmitter";
import { updateReproxyNode } from "./reproxy";

export const rawTNodeKey = "retree-base";
export const staticProxyKey = "retree-static-proxy";
export const proxiedParentKey = "retree-parent";
export const proxiedChildrenKey = "retree-children";

export interface ICustomProxyHandler<TNode extends TreeNode = TreeNode> {
    [rawTNodeKey]: TNode;
    [rawTNodeKey]: TNode;
    [proxiedChildrenKey]: Record<string, any>;
    [proxiedParentKey]: TreeNode | null;
}

export function isCustomProxyHandler<TNode extends TreeNode = TreeNode>(
    value: any
): value is ICustomProxyHandler<TNode> {
    return value?.[rawTNodeKey] !== undefined;
}

/**
 * Gets the proxy handler for a given TreeNode, assuming `isCustomProxyHandler` returns true.
 * @param proxy the proxied TreeNode to get the handler for.
 * @returns the handler if valid, otherwise undefined
 */
export function getCustomProxyHandler(proxy: TreeNode) {
    const handler = (proxy as any)["[[Handler]]"];
    if (isCustomProxyHandler(handler)) {
        return handler;
    }
    return undefined;
}

export function buildProxy<T extends TreeNode = TreeNode>(
    object: T,
    emitter: TreeChangeEmitter,
    parent?: TreeNode
) {
    const proxyHandler: ProxyHandler<T> & ICustomProxyHandler<T> = {
        // Add some extra stuff into the handler so we can store the original TreeNode and access it later
        // Without overriding the rest of the getters in the object.
        [rawTNodeKey]: object,
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
                const reproxy = updateReproxyNode(baseProxy);
                emitter.emit(
                    "nodeChanged",
                    proxyHandler[rawTNodeKey],
                    baseProxy,
                    reproxy
                );
                if (nodeRemoved) {
                    emitter.emit(
                        "nodeRemoved",
                        proxyHandler[rawTNodeKey],
                        nodeRemoved
                    );
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

function reparentProxy(proxy: ICustomProxy, parent: ICustomProxy) {
    proxy["[[Handler]]"][proxiedParentKey] = parent;
}

export interface IProxy {
    ["[[Handler]]"]: any;
    ["[[Target]]"]: any;
}

export function isProxy(value: any): value is IProxy {
    return value && value["[[Handler]]"] && value["[[Target]]"];
}

export interface ICustomProxy {
    ["[[Handler]]"]: ICustomProxyHandler;
    ["[[Target]]"]: any;
}

export function isCustomProxy(value: any): value is IProxy {
    return (
        value &&
        isCustomProxyHandler(value["[[Handler]]"]) &&
        value["[[Target]]"]
    );
}

/**
 * Gets the raw node for a given proxied tree node
 *
 * @param proxy the proxied TreeNode to get the raw node for
 * @returns the raw node if valid, otherwise undefined
 */
function getRawNodeFromProxy(proxy: TreeNode) {
    return getCustomProxyHandler(proxy)?.[rawTNodeKey];
}

/**
 * @internal
 * We store a reference to the raw unproxied node in our proxied instances so we can easily access it at any proxy depth.
 *
 * @param node get the raw node from the proxy
 * @returns the raw unproxied object
 */
export function getRawNode<TNode extends TreeNode | undefined = TreeNode>(
    node: TNode
): TNode {
    if (isProxy(node)) {
        return getRawNodeFromProxy(node) as TNode;
    }
    return node;
}

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
