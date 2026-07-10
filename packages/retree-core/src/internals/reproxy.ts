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
    isDependencyTrackingActive,
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
    registerCustomProxyMetadata,
    TCustomProxy,
} from "./proxy-types";

const reproxyMap: WeakMap<TreeNode, TCustomProxy<TreeNode>> = new WeakMap();
const baseProxyMap: WeakMap<TreeNode, TCustomProxy<TreeNode>> = new WeakMap();

function trackAccessIfNeeded<T>(value: T): T {
    if (!isDependencyTrackingActive()) {
        return value;
    }
    return trackDependencyAccess(value);
}

function trackPropertyAccessIfNeeded<T>(
    owner: unknown,
    propertyKey: string | symbol,
    value: T
): T {
    if (!isDependencyTrackingActive()) {
        return value;
    }
    return trackDependencyPropertyAccess(owner, propertyKey, value);
}

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
    object: TCustomProxy<T>
): TCustomProxy<T> {
    const handler = getCustomProxyHandler(object);
    if (!handler) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: cannot build a reproxy for an unproxied node. This is unexpected and likely a Retree bug if it came from a public Retree API. Fix: make sure callers pass Retree-managed proxies from Retree.root(...) or tree children; otherwise file a Retree issue with the operation that triggered this."
        );
    }
    let boundFunctionCache: Map<
        string | symbol,
        { source: Function; bound: Function }
    > | null = null;
    const getBoundFunction = <TFunction extends Function>(
        prop: string | symbol,
        source: TFunction,
        thisArg: unknown
    ): TFunction => {
        boundFunctionCache ??= new Map();
        return getCachedBoundFunction(
            boundFunctionCache,
            prop,
            source,
            thisArg
        );
    };
    const proxyHandler: ProxyHandler<TCustomProxy<T>> & ICustomProxyHandler<T> =
        {
            // Add some extra stuff into the handler so we can store the original TreeNode and access it later
            // Without overriding the rest of the getters in the object.
            [unproxiedBaseNodeKey]: handler[unproxiedBaseNodeKey],
            [proxiedChildrenKey]: handler[proxiedChildrenKey],
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
                    if (
                        typeof prop === "string" &&
                        prop.startsWith("RETREE_")
                    ) {
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
                        return trackPropertyAccessIfNeeded(
                            object,
                            prop,
                            reproxy ?? childProxy
                        );
                    }
                }
                const rawNode = handler[unproxiedBaseNodeKey];
                // Some built-in methods need internal slots on `this`. Delegate property access to the
                // base proxy so the bind/wrap logic in buildProxy is reused (and mutations emit).
                if (isInternalSlotInstance(rawNode)) {
                    return trackPropertyAccessIfNeeded(
                        object,
                        prop,
                        Reflect.get(object, prop, object)
                    );
                }
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
                    if (FUNCTION_NAMES_BIND_TO_RAW.has(prop)) {
                        return trackAccessIfNeeded(
                            getBoundFunction(prop, value, rawNode)
                        );
                    }
                    const reproxy = getReproxyNode(object);
                    return trackAccessIfNeeded(
                        getBoundFunction(prop, value, reproxy)
                    );
                }
                if (value !== null && typeof value === "object") {
                    const baseValue = Reflect.get(object, prop, object);
                    if (isCustomProxy(baseValue)) {
                        return trackPropertyAccessIfNeeded(
                            object,
                            prop,
                            getReproxyNode(baseValue) ?? baseValue
                        );
                    }
                }
                return trackPropertyAccessIfNeeded(object, prop, value);
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
    const proxy = new Proxy(object, proxyHandler) as TCustomProxy<T>;
    registerCustomProxyMetadata(proxy, proxyHandler, object);
    return proxy as TCustomProxy<T>;
}

function getLatestIgnoredValue(value: unknown) {
    if (isCustomProxy(value)) {
        return trackAccessIfNeeded(getReproxyNode(value));
    }
    return trackAccessIfNeeded(value);
}

function getLatestLinkedValue(value: unknown) {
    if (isCustomProxy(value)) {
        return trackAccessIfNeeded(getReproxyNode(value));
    }
    if (value !== null && typeof value === "object") {
        return trackAccessIfNeeded(
            getManagedProxyForUnproxiedNode(value as TreeNode) ?? value
        );
    }
    return trackAccessIfNeeded(value);
}
