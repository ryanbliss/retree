/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
} from "../ReactiveNode";
import { TreeNode } from "../types";
import {
    getCustomProxyHandler,
    getBaseProxy,
    getUnproxiedNode,
    FUNCTION_NAMES_BIND_TO_RAW,
    getCachedBoundFunction,
    isInternalSlotInstance,
} from "./proxy";
import {
    trackDependencyAccess,
    trackDependencyPropertyAccess,
} from "./dependency-tracking";
import { getReactiveNodeGetter, popMemoGetter, pushMemoGetter } from "./memo";
import {
    ICustomProxyHandler,
    isCustomProxy,
    proxiedChildrenKey,
    unproxiedBaseNodeKey,
    proxiedParentKey,
    TCustomProxy,
} from "./proxy-types";

const reproxyMap: WeakMap<TreeNode, TCustomProxy<TreeNode>> = new WeakMap();
const baseProxyMap: WeakMap<TreeNode, TCustomProxy<TreeNode>> = new WeakMap();

export function registerBaseProxy<T extends TreeNode = TreeNode>(
    unproxiedNode: T,
    baseProxy: TCustomProxy<T>
): void {
    baseProxyMap.set(unproxiedNode, baseProxy);
}

export function updateReproxyNode<T extends TreeNode = TreeNode>(
    node: TCustomProxy<T>
): TCustomProxy<T> {
    const handler = getCustomProxyHandler(node);
    if (!handler) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: cannot update a reproxy for an unproxied node. This is unexpected and likely a Retree bug if it came from a public Retree API. Fix: make sure callers pass Retree-managed proxies from Retree.root(...) or tree children; otherwise file a Retree issue with the operation that triggered this."
        );
    }
    const unproxiedNode = handler[unproxiedBaseNodeKey];
    const reproxy = buildReproxy<T>(node);
    reproxyMap.set(unproxiedNode, reproxy);
    return reproxy;
}

export function getReproxyNode<T extends TreeNode = TreeNode>(node: T): T {
    const handler = getCustomProxyHandler<T>(node);
    if (!handler) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: cannot get a reproxy for an unproxied node. This is unexpected and likely a Retree bug if it came from a public Retree API. Fix: make sure callers pass Retree-managed proxies from Retree.root(...) or tree children; otherwise file a Retree issue with the operation that triggered this."
        );
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

export function getManagedProxyForUnproxiedNode<T extends TreeNode = TreeNode>(
    unproxiedNode: T
): TCustomProxy<T> | undefined {
    return (
        getReproxyNodeForUnproxiedNode(unproxiedNode) ??
        (baseProxyMap.get(unproxiedNode) as TCustomProxy<T> | undefined)
    );
}

function buildReproxy<T extends TreeNode = TreeNode>(
    object: T
): TCustomProxy<T> {
    const handler = getCustomProxyHandler(object);
    if (!handler) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: cannot build a reproxy for an unproxied node. This is unexpected and likely a Retree bug if it came from a public Retree API. Fix: make sure callers pass Retree-managed proxies from Retree.root(...) or tree children; otherwise file a Retree issue with the operation that triggered this."
        );
    }
    const boundFunctionCache = new Map<
        string | symbol,
        { source: Function; bound: Function }
    >();
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
            if (target instanceof ReactiveNode) {
                // Check for ignore keys
                if (typeof prop === "string" && prop.startsWith("RETREE_")) {
                    return Reflect.get(target, prop, target);
                }
                if (target[COLLECTED_KEYS_SYMBOL].has(prop)) {
                    return getLatestIgnoredValue(
                        Reflect.get(target, prop, target)
                    );
                }
                if (target[LINKED_KEYS_SYMBOL].has(prop)) {
                    return getLatestLinkedValue(
                        Reflect.get(target, prop, target)
                    );
                }
            }
            if (
                typeof prop === "string" &&
                prop !== "constructor" &&
                handler[proxiedChildrenKey][prop]
            ) {
                const childProxy = handler[proxiedChildrenKey][prop];
                if (typeof childProxy !== "function") {
                    const reproxy = getReproxyNode(childProxy);
                    const baseProxy: TCustomProxy<T> = getBaseProxy(receiver);
                    return trackDependencyPropertyAccess(
                        baseProxy,
                        prop,
                        reproxy ?? childProxy
                    );
                }
            }
            const baseProxy: TCustomProxy<T> = getBaseProxy(receiver);
            const rawNode = getUnproxiedNode(baseProxy);
            // Some built-in methods need internal slots on `this`. Delegate property access to the
            // base proxy so the bind/wrap logic in buildProxy is reused (and mutations emit).
            if (isInternalSlotInstance(rawNode)) {
                return trackDependencyPropertyAccess(
                    baseProxy,
                    prop,
                    Reflect.get(baseProxy, prop, baseProxy)
                );
            }
            const reproxy = getReproxyNode(baseProxy);
            const evalTarget = rawNode ?? target;

            let value: any;
            if (
                evalTarget instanceof ReactiveNode &&
                getReactiveNodeGetter(evalTarget, prop)
            ) {
                // Mirror proxy.ts: track the active getter for keyless `this.memo(...)`.
                pushMemoGetter(evalTarget, prop);
                try {
                    value = Reflect.get(evalTarget, prop, receiver);
                } finally {
                    popMemoGetter(evalTarget);
                }
            } else {
                value = Reflect.get(evalTarget, prop, receiver);
            }

            if (typeof value === "function") {
                if (FUNCTION_NAMES_BIND_TO_RAW.includes(prop)) {
                    return trackDependencyAccess(
                        getCachedBoundFunction(
                            boundFunctionCache,
                            prop,
                            value,
                            rawNode
                        )
                    );
                }
                return trackDependencyAccess(
                    getCachedBoundFunction(
                        boundFunctionCache,
                        prop,
                        value,
                        reproxy
                    )
                );
            }
            if (value !== null && typeof value === "object") {
                const baseValue = Reflect.get(baseProxy, prop, baseProxy);
                if (isCustomProxy(baseValue)) {
                    return trackDependencyPropertyAccess(
                        baseProxy,
                        prop,
                        getReproxyNode(baseValue) ?? baseValue
                    );
                }
            }
            return trackDependencyPropertyAccess(baseProxy, prop, value);
        },
        set(target, prop, newValue, receiver) {
            if (target instanceof ReactiveNode) {
                if (
                    prop === COLLECTED_KEYS_SYMBOL ||
                    target[COLLECTED_KEYS_SYMBOL].has(prop)
                ) {
                    return Reflect.set(target, prop, newValue, target);
                }
            }
            return Reflect.set(target, prop, newValue, receiver);
        },
    };
    const proxy = new Proxy(object, proxyHandler);
    return proxy as TCustomProxy<T>;
}

function getLatestIgnoredValue(value: unknown) {
    if (isCustomProxy(value)) {
        return trackDependencyAccess(getReproxyNode(value));
    }
    return trackDependencyAccess(value);
}

function getLatestLinkedValue(value: unknown) {
    if (isCustomProxy(value)) {
        return trackDependencyAccess(getReproxyNode(value));
    }
    if (value !== null && typeof value === "object") {
        return trackDependencyAccess(
            getManagedProxyForUnproxiedNode(value as TreeNode) ?? value
        );
    }
    return trackDependencyAccess(value);
}
