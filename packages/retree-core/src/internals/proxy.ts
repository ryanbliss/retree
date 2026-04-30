/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { COLLECTED_KEYS_SYMBOL, ReactiveNode } from "../ReactiveNode";
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
import { getReactiveNodeGetter, popMemoGetter, pushMemoGetter } from "./memo";
import { getReproxyNodeForUnproxiedNode, updateReproxyNode } from "./reproxy";
import { Transactions } from "./transactions";

export const FUNCTION_NAMES_BIND_TO_RAW: (string | symbol)[] = [
    "valueOf",
    "toISOString",
    "toJSON",
];

const MAP_MUTATING_METHODS = new Set(["set", "delete", "clear"]);
const SET_MUTATING_METHODS = new Set(["add", "delete", "clear"]);

/**
 * Built-ins like {@link Map} and {@link Set} rely on internal slots, so calling their methods
 * with a Proxy as the `this` value throws "incompatible receiver". For those instances we bind
 * methods to the raw target and wrap mutating methods so they still emit change events.
 */
function isInternalSlotInstance(
    target: any
): target is Map<any, any> | Set<any> {
    return target instanceof Map || target instanceof Set;
}

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
            if (target instanceof ReactiveNode) {
                const propString = String(prop);
                // Check for ignore keys
                if (
                    propString === COLLECTED_KEYS_SYMBOL ||
                    target[COLLECTED_KEYS_SYMBOL].has(propString)
                ) {
                    return Reflect.get(target, prop, receiver);
                }
            }
            if (
                typeof prop === "string" &&
                proxyHandler[proxiedChildrenKey][prop]
            ) {
                const value = proxyHandler[proxiedChildrenKey][prop];
                if (typeof value !== "function") {
                    return value;
                }
            }
            const baseProxy = getBaseProxy(receiver);
            if (isInternalSlotInstance(target)) {
                // Methods on Map/Set must run with the raw target as `this` because they read
                // internal slots that the proxy does not expose.
                const value = Reflect.get(target, prop, target);
                if (typeof value === "function") {
                    if (
                        target instanceof Map &&
                        typeof prop === "string" &&
                        MAP_MUTATING_METHODS.has(prop)
                    ) {
                        return wrapMapMutation(
                            prop,
                            target,
                            baseProxy,
                            emitter
                        );
                    }
                    if (
                        target instanceof Set &&
                        typeof prop === "string" &&
                        SET_MUTATING_METHODS.has(prop)
                    ) {
                        return wrapSetMutation(
                            prop,
                            target,
                            baseProxy,
                            emitter
                        );
                    }
                    return value.bind(target);
                }
                return value;
            }
            let value: any;
            if (
                target instanceof ReactiveNode &&
                getReactiveNodeGetter(target, prop)
            ) {
                // For ReactiveNode getters, push the getter name onto the memo-getter
                // stack so a keyless `this.memo(fn, deps)` inside the getter can derive
                // its cache key from `prop`. Pop in `finally` so a throwing getter
                pushMemoGetter(target, prop);
                try {
                    value = Reflect.get(target, prop, receiver);
                } finally {
                    popMemoGetter(target);
                }
            } else {
                value = Reflect.get(target, prop, receiver);
            }
            if (typeof value === "function") {
                if (FUNCTION_NAMES_BIND_TO_RAW.includes(prop)) {
                    return value.bind(target);
                }
                return value.bind(baseProxy);
            }
            return value;
        },
        set(target, prop, newValue, receiver) {
            if (target instanceof ReactiveNode) {
                const propString = String(prop);
                // Check for ignore keys
                if (
                    propString === COLLECTED_KEYS_SYMBOL ||
                    target[COLLECTED_KEYS_SYMBOL].has(propString)
                ) {
                    return Reflect.set(target, prop, newValue, receiver);
                }
            }
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
                if (newValue !== null && typeof newValue === "object") {
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
                } else if (!newValue && !!prev && typeof prev === "object") {
                    proxyHandler[proxiedChildrenKey][prop] = newValue;
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
                        const removedUnproxied = getUnproxiedNode(nodeRemoved);
                        emitter.emit(
                            "nodeRemoved",
                            removedUnproxied ?? nodeRemoved,
                            nodeRemoved
                        );
                    }
                }

                return returnValue;
            }
            return true;
        },
        deleteProperty(target, prop) {
            if (target instanceof ReactiveNode) {
                const propString = String(prop);
                // Check for ignore keys
                if (
                    propString === COLLECTED_KEYS_SYMBOL ||
                    target[COLLECTED_KEYS_SYMBOL].has(propString)
                ) {
                    return Reflect.deleteProperty(target, prop);
                }
            }
            // Good example of `deleteProperty` is when an item is removed / moved in a list.
            // `deleteProperty` does not expose the receiver...get the latest reproxy instead.
            // TODO: should revisit this at some point...
            const currentProxy = isCustomProxy(target)
                ? target
                : getReproxyNodeForUnproxiedNode(target);
            const baseProxy = currentProxy
                ? getBaseProxy(currentProxy)
                : currentProxy;
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
                    const removedUnproxied = getUnproxiedNode(nodeRemoved);
                    emitter.emit(
                        "nodeRemoved",
                        removedUnproxied ?? nodeRemoved,
                        nodeRemoved
                    );
                }
            }
            return returnValue;
        },
    };
    if (object === null) return object;
    if (isCustomProxy(object)) return getBaseProxy(object);
    const proxy = new Proxy(object, proxyHandler) as TCustomProxy<T>;
    if (object instanceof Map) {
        // Replace each existing object value with a proxied/parented version so reads
        // through the proxy yield reactive children with correct parent links.
        const entries = Array.from(object.entries());
        for (const [key, value] of entries) {
            if (value !== null && typeof value === "object") {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: proxy,
                    propName: mapKeyAsPropName(key),
                };
                const childProxy = isCustomProxy(value)
                    ? reparentProxy(value, parentToSet)
                    : buildProxy(value, emitter, parentToSet);
                Map.prototype.set.call(object, key, childProxy);
            }
        }
    } else {
        Object.entries(object).forEach(([prop, value]) => {
            const propString = String(prop);
            if (
                value === null ||
                (object instanceof ReactiveNode &&
                    (propString === COLLECTED_KEYS_SYMBOL ||
                        object[COLLECTED_KEYS_SYMBOL].has(propString)))
            ) {
                proxyHandler[proxiedChildrenKey][prop] = value;
            } else if (typeof value === "object") {
                const cProxy = buildProxy(value, emitter, {
                    proxyNode: proxy,
                    propName: prop,
                });
                proxyHandler[proxiedChildrenKey][prop] = getBaseProxy(cProxy);
            }
        });
    }
    updateReproxyNode(proxy);
    return proxy;
}

function mapKeyAsPropName(key: unknown): string | symbol | null {
    if (typeof key === "string" || typeof key === "symbol") return key;
    return null;
}

function wrapMapMutation(
    prop: string,
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (prop === "set") {
        return function setWrapper(key: any, value: any) {
            const previous = target.get(key);
            const removedNodes: object[] = [];
            // If we are replacing an existing object child of this map, detach it.
            if (
                previous !== value &&
                previous !== null &&
                typeof previous === "object"
            ) {
                const removed = detachCollectionChild(previous, baseProxy);
                if (removed) removedNodes.push(removed);
            }
            let valueToStore: any = value;
            if (value !== null && typeof value === "object") {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: baseProxy,
                    propName: mapKeyAsPropName(key),
                };
                valueToStore = isCustomProxy(value)
                    ? reparentProxy(value, parentToSet)
                    : buildProxy(value, emitter, parentToSet);
            }
            Map.prototype.set.call(target, key, valueToStore);
            emitCollectionChange(target, baseProxy, emitter, removedNodes);
            // Map.prototype.set returns the map itself; return the proxy so chaining stays reactive.
            return baseProxy;
        };
    }
    if (prop === "delete") {
        return function deleteWrapper(key: any) {
            const previous = target.get(key);
            const removedNodes: object[] = [];
            if (
                previous !== null &&
                previous !== undefined &&
                typeof previous === "object"
            ) {
                const removed = detachCollectionChild(previous, baseProxy);
                if (removed) removedNodes.push(removed);
            }
            const result = Map.prototype.delete.call(target, key);
            if (result) {
                emitCollectionChange(target, baseProxy, emitter, removedNodes);
            }
            return result;
        };
    }
    if (prop === "clear") {
        return function clearWrapper() {
            if (target.size === 0) return;
            const removedNodes: object[] = [];
            target.forEach((value) => {
                if (value !== null && typeof value === "object") {
                    const removed = detachCollectionChild(value, baseProxy);
                    if (removed) removedNodes.push(removed);
                }
            });
            Map.prototype.clear.call(target);
            emitCollectionChange(target, baseProxy, emitter, removedNodes);
        };
    }
    throw new Error(`Unsupported Map mutation: ${prop}`);
}

function wrapSetMutation(
    prop: string,
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (prop === "add") {
        return function addWrapper(value: any) {
            const hadValue = target.has(value);
            Set.prototype.add.call(target, value);
            if (!hadValue) {
                emitCollectionChange(target, baseProxy, emitter, []);
            }
            return baseProxy;
        };
    }
    if (prop === "delete") {
        return function deleteWrapper(value: any) {
            const result = Set.prototype.delete.call(target, value);
            if (result) {
                emitCollectionChange(target, baseProxy, emitter, []);
            }
            return result;
        };
    }
    if (prop === "clear") {
        return function clearWrapper() {
            if (target.size === 0) return;
            Set.prototype.clear.call(target);
            emitCollectionChange(target, baseProxy, emitter, []);
        };
    }
    throw new Error(`Unsupported Set mutation: ${prop}`);
}

function detachCollectionChild(
    child: object,
    parentBaseProxy: TCustomProxy<any>
): object | undefined {
    const handler = getCustomProxyHandler(child);
    if (!handler) return undefined;
    const oldParent = handler[proxiedParentKey];
    if (!oldParent || oldParent.proxyNode !== parentBaseProxy) {
        return undefined;
    }
    oldParent.propName = null;
    oldParent.proxyNode = null;
    return child;
}

function emitCollectionChange(
    target: object,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter,
    removedNodes: object[]
) {
    if (Transactions.skipReproxy) return;
    const reproxy = updateReproxyNode(baseProxy);
    emitter.emit("nodeChanged", target, baseProxy, reproxy);
    if (removedNodes.length === 0 || Transactions.skipEmit) return;
    for (const removed of removedNodes) {
        const removedUnproxied = getUnproxiedNode(removed);
        emitter.emit("nodeRemoved", removedUnproxied ?? removed, removed);
    }
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
    if (nodeRemoved !== null && typeof nodeRemoved === "object") {
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
