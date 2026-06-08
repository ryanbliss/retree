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
import { TreeChangeEmitter } from "./NodeChangeEmitter";
import {
    ICustomProxy,
    ICustomProxyHandler,
    IProxyParent,
    getCustomProxyHandlerFromMetadata,
    getCustomProxyTargetFromMetadata,
    isCustomProxy,
    isCustomProxyHandler,
    proxiedChildrenKey,
    proxiedParentKey,
    registerCustomProxyMetadata,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types";
import { getReactiveNodeGetter, popMemoGetter, pushMemoGetter } from "./memo";
import {
    getManagedProxyForUnproxiedNode,
    getReproxyNode,
    registerBaseProxy,
    updateReproxyNode,
} from "./reproxy";
import {
    isDependencyTrackingActive,
    trackDependencyAccess,
    trackDependencyPropertyAccess,
    trackDependencyPropertyWrite,
} from "./dependency-tracking";
import { Transactions } from "./transactions";

export const FUNCTION_NAMES_BIND_TO_RAW: (string | symbol)[] = [
    "valueOf",
    "toISOString",
    "toJSON",
];

const MAP_MUTATING_METHODS = new Set(["set", "delete", "clear"]);
const SET_MUTATING_METHODS = new Set(["add", "delete", "clear"]);

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

function trackReceiverPropertyAccessIfNeeded<T>(
    receiver: TreeNode,
    propertyKey: string | symbol,
    value: T
): T {
    if (!isDependencyTrackingActive()) {
        return value;
    }
    return trackDependencyPropertyAccess(
        getBaseProxy(receiver),
        propertyKey,
        value
    );
}

function trackPropertyWriteIfNeeded(
    owner: unknown,
    propertyKey: string | symbol
): void {
    if (!isDependencyTrackingActive()) {
        return;
    }
    trackDependencyPropertyWrite(owner, propertyKey);
}

type DateMutatingMethodName =
    | "setDate"
    | "setFullYear"
    | "setHours"
    | "setMilliseconds"
    | "setMinutes"
    | "setMonth"
    | "setSeconds"
    | "setTime"
    | "setUTCDate"
    | "setUTCFullYear"
    | "setUTCHours"
    | "setUTCMilliseconds"
    | "setUTCMinutes"
    | "setUTCMonth"
    | "setUTCSeconds";
const DATE_MUTATING_METHODS: Record<
    DateMutatingMethodName,
    (this: Date, ...args: number[]) => number
> = {
    setDate: Date.prototype.setDate,
    setFullYear: Date.prototype.setFullYear,
    setHours: Date.prototype.setHours,
    setMilliseconds: Date.prototype.setMilliseconds,
    setMinutes: Date.prototype.setMinutes,
    setMonth: Date.prototype.setMonth,
    setSeconds: Date.prototype.setSeconds,
    setTime: Date.prototype.setTime,
    setUTCDate: Date.prototype.setUTCDate,
    setUTCFullYear: Date.prototype.setUTCFullYear,
    setUTCHours: Date.prototype.setUTCHours,
    setUTCMilliseconds: Date.prototype.setUTCMilliseconds,
    setUTCMinutes: Date.prototype.setUTCMinutes,
    setUTCMonth: Date.prototype.setUTCMonth,
    setUTCSeconds: Date.prototype.setUTCSeconds,
};

interface BoundFunctionCacheEntry {
    source: Function;
    bound: Function;
}

export function getCachedBoundFunction<TFunction extends Function>(
    cache: Map<string | symbol, BoundFunctionCacheEntry>,
    prop: string | symbol,
    source: TFunction,
    thisArg: unknown
): TFunction {
    const cached = cache.get(prop);
    if (cached !== undefined && cached.source === source) {
        return cached.bound as TFunction;
    }
    const bound = source.bind(thisArg);
    cache.set(prop, { source, bound });
    return bound as TFunction;
}

/**
 * Built-ins like {@link Date}, {@link Map}, and {@link Set} rely on internal slots, so calling their methods
 * with a Proxy as the `this` value throws "incompatible receiver". For those instances we bind
 * methods to the raw target and wrap mutating methods so they still emit change events.
 */
export function isInternalSlotInstance(
    target: any
): target is Date | Map<any, any> | Set<any> {
    return (
        target instanceof Date || target instanceof Map || target instanceof Set
    );
}

function isDateMutatingMethod(prop: string): prop is DateMutatingMethodName {
    return Object.prototype.hasOwnProperty.call(DATE_MUTATING_METHODS, prop);
}

function getLatestIgnoredValue(value: unknown) {
    if (isCustomProxy(value)) {
        return getReproxyNode(value);
    }
    return value;
}

function getLatestLinkedValue(value: unknown) {
    if (isCustomProxy(value)) {
        return getReproxyNode(value);
    }
    if (value !== null && typeof value === "object") {
        return getManagedProxyForUnproxiedNode(value as TreeNode) ?? value;
    }
    return value;
}

function assertValidLinkedValue(prop: string | symbol, value: unknown) {
    if (value === null || value === undefined) {
        return;
    }
    if (typeof value !== "object") {
        return;
    }
    if (isCustomProxy(value)) {
        return;
    }
    if (getManagedProxyForUnproxiedNode(value as TreeNode) !== undefined) {
        return;
    }
    // @retree-throws
    throw new Error(
        `@link field ${String(
            prop
        )} can only store a Retree-managed node, a raw node that already belongs to a Retree tree, null, undefined, or a non-object leaf value. This is expected when assigning a plain object to @link. Fix: pass the object through Retree.root(...) or read it from an existing Retree tree first; use @ignore for non-reactive objects that should not be managed by Retree.`
    );
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
    let isApplyingSet = false;
    if (object === null) return object;
    const reactiveObject = object instanceof ReactiveNode ? object : undefined;
    const mapObject = object instanceof Map ? object : undefined;
    const setObject = object instanceof Set ? object : undefined;
    const dateObject = object instanceof Date ? object : undefined;
    const hasInternalSlots =
        mapObject !== undefined ||
        setObject !== undefined ||
        dateObject !== undefined;
    let boundFunctionCache: Map<
        string | symbol,
        BoundFunctionCacheEntry
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
            if (reactiveObject !== undefined) {
                const propString = String(prop);
                // Check for ignore keys
                if (propString.startsWith("RETREE_")) {
                    return Reflect.get(target, prop, target);
                }
                if (reactiveObject[COLLECTED_KEYS_SYMBOL].has(propString)) {
                    return trackReceiverPropertyAccessIfNeeded(
                        receiver,
                        prop,
                        getLatestIgnoredValue(Reflect.get(target, prop, target))
                    );
                }
                if (reactiveObject[LINKED_KEYS_SYMBOL].has(prop)) {
                    return trackReceiverPropertyAccessIfNeeded(
                        receiver,
                        prop,
                        getLatestLinkedValue(Reflect.get(target, prop, target))
                    );
                }
            }
            if (
                typeof prop === "string" &&
                proxyHandler[proxiedChildrenKey][prop]
            ) {
                const value = proxyHandler[proxiedChildrenKey][prop];
                if (typeof value !== "function") {
                    return trackReceiverPropertyAccessIfNeeded(
                        receiver,
                        prop,
                        value
                    );
                }
            }
            if (hasInternalSlots) {
                const baseProxy = getBaseProxy(receiver);
                // Methods on Map/Set must run with the raw target as `this` because they read
                // internal slots that the proxy does not expose.
                const value = Reflect.get(target, prop, target);
                if (typeof value === "function") {
                    if (
                        mapObject !== undefined &&
                        typeof prop === "string" &&
                        MAP_MUTATING_METHODS.has(prop)
                    ) {
                        return wrapMapMutation(
                            prop,
                            mapObject,
                            baseProxy,
                            emitter
                        );
                    }
                    if (mapObject !== undefined) {
                        return wrapMapRead(prop, mapObject, baseProxy, emitter);
                    }
                    if (
                        setObject !== undefined &&
                        typeof prop === "string" &&
                        SET_MUTATING_METHODS.has(prop)
                    ) {
                        return wrapSetMutation(
                            prop,
                            setObject,
                            baseProxy,
                            emitter
                        );
                    }
                    if (setObject !== undefined) {
                        return wrapSetRead(prop, setObject, baseProxy, emitter);
                    }
                    if (
                        dateObject !== undefined &&
                        typeof prop === "string" &&
                        isDateMutatingMethod(prop)
                    ) {
                        return wrapDateMutation(
                            prop,
                            dateObject,
                            baseProxy,
                            emitter
                        );
                    }
                    return trackAccessIfNeeded(
                        getBoundFunction(prop, value, target)
                    );
                }
                return trackPropertyAccessIfNeeded(baseProxy, prop, value);
            }
            let value: any;
            if (
                reactiveObject !== undefined &&
                getReactiveNodeGetter(reactiveObject, prop)
            ) {
                // For ReactiveNode getters, push the getter name onto the memo-getter
                // stack so a keyless `this.memo(fn, deps)` inside the getter can derive
                // its cache key from `prop`. Pop in `finally` so a throwing getter
                pushMemoGetter(reactiveObject, prop);
                try {
                    value = Reflect.get(target, prop, receiver);
                } finally {
                    popMemoGetter(reactiveObject);
                }
            } else {
                value = Reflect.get(target, prop, receiver);
            }
            if (typeof value === "function") {
                if (FUNCTION_NAMES_BIND_TO_RAW.includes(prop)) {
                    return trackAccessIfNeeded(
                        getBoundFunction(prop, value, target)
                    );
                }
                const baseProxy = getBaseProxy(receiver);
                return trackAccessIfNeeded(
                    getBoundFunction(prop, value, baseProxy)
                );
            }
            if (shouldLazilyProxyProperty(target, prop, value)) {
                const descriptor = Reflect.getOwnPropertyDescriptor(
                    target,
                    prop
                );
                if (!descriptor || !descriptorHasValue(descriptor)) {
                    return trackReceiverPropertyAccessIfNeeded(
                        receiver,
                        prop,
                        value
                    );
                }
                if (!shouldKeepRawPropertyValue(descriptor, value)) {
                    const baseProxy = getBaseProxy(receiver);
                    return trackPropertyAccessIfNeeded(
                        baseProxy,
                        prop,
                        getOrCreateProxiedChild(
                            proxyHandler,
                            prop,
                            value,
                            baseProxy,
                            emitter
                        )
                    );
                }
            }
            return trackReceiverPropertyAccessIfNeeded(receiver, prop, value);
        },
        set(target, prop, newValue, receiver) {
            trackPropertyWriteIfNeeded(getBaseProxy<T>(receiver), prop);
            if (reactiveObject !== undefined) {
                const propString = String(prop);
                if (reactiveObject[LINKED_KEYS_SYMBOL].has(prop)) {
                    assertValidLinkedValue(prop, newValue);
                    const prev = Reflect.get(target, prop, target);
                    if (prev === newValue) {
                        return true;
                    }
                    const baseProxy = getBaseProxy<T>(receiver);
                    let returnValue: boolean;
                    isApplyingSet = true;
                    try {
                        returnValue = Reflect.set(
                            target,
                            prop,
                            newValue,
                            target
                        );
                    } finally {
                        isApplyingSet = false;
                    }
                    if (!Transactions.skipReproxy) {
                        const reproxy = updateReproxyNode(baseProxy);
                        emitter.emit(
                            "nodeChanged",
                            proxyHandler[unproxiedBaseNodeKey],
                            baseProxy,
                            reproxy
                        );
                    }
                    return returnValue;
                }
                // Check for ignore keys
                if (
                    propString === COLLECTED_KEYS_SYMBOL ||
                    reactiveObject[COLLECTED_KEYS_SYMBOL].has(propString)
                ) {
                    return Reflect.set(target, prop, newValue, target);
                }
            }
            const prev = (target as any)[prop];
            const hasChanged = prev !== newValue;
            const baseProxy = getBaseProxy<T>(receiver);
            if (hasChanged) {
                let valueToSet = newValue;
                const nodeRemoved = handleNodeRemoved(baseProxy, prop);
                if (newValue !== null && typeof newValue === "object") {
                    if (prop === "constructor")
                        return Reflect.set(target, prop, newValue, receiver);

                    // If already a proxied object, we simply reparent
                    // Otherwise, build a new proxy object, unless this is a plain
                    // object/array child that can be proxied lazily on first read.
                    const parentToSet: IProxyParent<any> = {
                        proxyNode: baseProxy,
                        propName: prop,
                    };
                    if (isCustomProxy(newValue)) {
                        valueToSet = reparentProxy(newValue, parentToSet);
                        proxyHandler[proxiedChildrenKey][prop] = valueToSet;
                    } else if (
                        getManagedProxyForUnproxiedNode(newValue) !== undefined
                    ) {
                        valueToSet = createStructuralProxyForValue(
                            newValue,
                            parentToSet,
                            emitter
                        );
                        proxyHandler[proxiedChildrenKey][prop] = valueToSet;
                    } else if (shouldCreatePlainObjectProxyLazily(newValue)) {
                        deleteProxiedChild(proxyHandler, prop);
                    } else {
                        valueToSet = createStructuralProxyForValue(
                            newValue,
                            parentToSet,
                            emitter
                        );
                        proxyHandler[proxiedChildrenKey][prop] = valueToSet;
                    }
                } else {
                    deleteProxiedChild(proxyHandler, prop);
                }
                let returnValue: boolean;
                isApplyingSet = true;
                try {
                    returnValue = Reflect.set(
                        target,
                        prop,
                        valueToSet,
                        receiver
                    );
                } finally {
                    isApplyingSet = false;
                }
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
        defineProperty(target, prop, descriptor) {
            const currentProxyForWrite = isCustomProxy(target)
                ? target
                : getManagedProxyForUnproxiedNode(target);
            const baseProxyForWrite = currentProxyForWrite
                ? getBaseProxy(currentProxyForWrite)
                : undefined;
            if (baseProxyForWrite !== undefined) {
                trackPropertyWriteIfNeeded(baseProxyForWrite, prop);
            }
            if (reactiveObject !== undefined) {
                const propString = String(prop);
                // Check for ignore keys
                if (
                    propString === COLLECTED_KEYS_SYMBOL ||
                    reactiveObject[COLLECTED_KEYS_SYMBOL].has(propString)
                ) {
                    return Reflect.defineProperty(target, prop, descriptor);
                }
            }
            if (isApplyingSet) {
                return Reflect.defineProperty(target, prop, descriptor);
            }
            const currentProxy = currentProxyForWrite;
            const baseProxy = currentProxy
                ? getBaseProxy(currentProxy)
                : currentProxy;
            const descriptorToDefine: PropertyDescriptor = { ...descriptor };
            const currentDescriptor = Reflect.getOwnPropertyDescriptor(
                target,
                prop
            );
            let nodeRemoved: object | undefined;

            if (descriptorHasValue(descriptorToDefine)) {
                const shouldKeepRawValue =
                    isProxyableObject(descriptorToDefine.value) &&
                    !isCustomProxy(descriptorToDefine.value) &&
                    descriptorRequiresExactDefinedValue(
                        currentDescriptor,
                        descriptorToDefine
                    );
                if (
                    baseProxy &&
                    Reflect.get(baseProxy, prop) !== descriptorToDefine.value
                ) {
                    nodeRemoved = handleNodeRemoved(baseProxy, prop);
                }
                if (shouldKeepRawValue) {
                    deleteProxiedChild(proxyHandler, prop);
                } else {
                    descriptorToDefine.value = preparePropertyValue(
                        descriptorToDefine.value,
                        prop,
                        baseProxy,
                        emitter,
                        proxyHandler
                    );
                }
            } else if (descriptorHasAccessor(descriptorToDefine)) {
                if (baseProxy) {
                    nodeRemoved = handleNodeRemoved(baseProxy, prop);
                }
                deleteProxiedChild(proxyHandler, prop);
            } else {
                const cachedChild = proxyHandler[proxiedChildrenKey][prop];
                if (
                    cachedChild &&
                    currentDescriptorHasValue(currentDescriptor)
                ) {
                    descriptorToDefine.value = cachedChild;
                }
            }

            const returnValue = Reflect.defineProperty(
                target,
                prop,
                descriptorToDefine
            );
            // If in a skip reproxy transaction, do not reproxy node
            if (returnValue && !Transactions.skipReproxy) {
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
                        `buildProxy.defineProperty: cannot find baseProxy for target`
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
        deleteProperty(target, prop) {
            if (reactiveObject !== undefined) {
                const propString = String(prop);
                // Check for ignore keys
                if (
                    propString === COLLECTED_KEYS_SYMBOL ||
                    reactiveObject[COLLECTED_KEYS_SYMBOL].has(propString)
                ) {
                    return Reflect.deleteProperty(target, prop);
                }
            }
            // Good example of `deleteProperty` is when an item is removed / moved in a list.
            // `deleteProperty` does not expose the receiver...get the latest reproxy instead.
            // TODO: should revisit this at some point...
            const currentProxy = isCustomProxy(target)
                ? target
                : getManagedProxyForUnproxiedNode(target);
            const baseProxy = currentProxy
                ? getBaseProxy(currentProxy)
                : currentProxy;
            const nodeRemoved = handleNodeRemoved(baseProxy, prop);
            const returnValue = Reflect.deleteProperty(target, prop);
            if (returnValue) {
                deleteProxiedChild(proxyHandler, prop);
            }
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
    if (isCustomProxy(object)) return getBaseProxy(object);
    const proxy = new Proxy(object, proxyHandler) as TCustomProxy<T>;
    registerCustomProxyMetadata(proxy, proxyHandler, object);
    registerBaseProxy(object, proxy);
    if (object instanceof Map) {
        for (const [key, value] of object.entries()) {
            if (isCustomProxy(value)) {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: proxy,
                    propName: mapKeyAsPropName(key),
                };
                const childProxy = reparentProxy(value, parentToSet);
                Map.prototype.set.call(object, key, childProxy);
            }
        }
    } else if (object instanceof Set) {
        const replacements: { previous: unknown; next: unknown }[] = [];
        for (const value of object.values()) {
            if (isCustomProxy(value)) {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: proxy,
                    propName: null,
                };
                const childProxy = reparentProxy(value, parentToSet);
                if (childProxy !== value) {
                    replacements.push({
                        previous: value,
                        next: childProxy,
                    });
                }
            }
        }
        for (const replacement of replacements) {
            Set.prototype.delete.call(object, replacement.previous);
            Set.prototype.add.call(object, replacement.next);
        }
    } else {
        Object.entries(object).forEach(([prop, value]) => {
            const propString = String(prop);
            if (
                value === null ||
                (object instanceof ReactiveNode &&
                    (propString === COLLECTED_KEYS_SYMBOL ||
                        object[COLLECTED_KEYS_SYMBOL].has(propString) ||
                        object[LINKED_KEYS_SYMBOL].has(prop)))
            ) {
                proxyHandler[proxiedChildrenKey][prop] = value;
            } else if (typeof value === "object") {
                const descriptor = Reflect.getOwnPropertyDescriptor(
                    object,
                    prop
                );
                if (shouldKeepRawPropertyValue(descriptor, value)) {
                    deleteProxiedChild(proxyHandler, prop);
                    return;
                }
                if (shouldCreatePlainObjectProxyLazily(value)) {
                    deleteProxiedChild(proxyHandler, prop);
                    return;
                }
                const cProxy = buildProxy(value, emitter, {
                    proxyNode: proxy,
                    propName: prop,
                });
                proxyHandler[proxiedChildrenKey][prop] = getBaseProxy(cProxy);
            }
        });
    }
    if (
        object instanceof ReactiveNode &&
        object.options.prepare?.autoPrepare &&
        isReactiveNodeProxy(proxy)
    ) {
        proxy.prepareTree({
            depth: object.options.prepare.depth,
        });
    }
    return proxy;
}

function mapKeyAsPropName(key: unknown): string | symbol | null {
    if (typeof key === "string" || typeof key === "symbol") return key;
    return null;
}

function deleteProxiedChild(
    proxyHandler: ICustomProxyHandler<any>,
    prop: string | symbol
) {
    Reflect.deleteProperty(proxyHandler[proxiedChildrenKey], prop);
}

function isReactiveNodeProxy(node: object): node is TCustomProxy<ReactiveNode> {
    if (!(node instanceof ReactiveNode)) {
        return false;
    }
    return isCustomProxy(node);
}

function descriptorHasValue(
    descriptor: PropertyDescriptor
): descriptor is PropertyDescriptor & { value: unknown } {
    return Object.prototype.hasOwnProperty.call(descriptor, "value");
}

function currentDescriptorHasValue(
    descriptor: PropertyDescriptor | undefined
): descriptor is PropertyDescriptor & { value: unknown } {
    if (!descriptor) return false;
    return descriptorHasValue(descriptor);
}

function descriptorHasAccessor(descriptor: PropertyDescriptor): boolean {
    if (Object.prototype.hasOwnProperty.call(descriptor, "get")) {
        return true;
    }
    return Object.prototype.hasOwnProperty.call(descriptor, "set");
}

function descriptorRequiresExactDefinedValue(
    currentDescriptor: PropertyDescriptor | undefined,
    descriptor: PropertyDescriptor
): boolean {
    if (descriptor.configurable === true) {
        return false;
    }
    if (descriptor.writable === true) {
        return false;
    }
    if (!currentDescriptor) {
        return true;
    }
    if (descriptor.configurable === false) {
        if (descriptor.writable === false) {
            return true;
        }
        if (
            currentDescriptorHasValue(currentDescriptor) &&
            currentDescriptor.writable === false
        ) {
            return true;
        }
    }
    if (currentDescriptor.configurable !== false) {
        return false;
    }
    if (!currentDescriptorHasValue(currentDescriptor)) {
        return false;
    }
    if (descriptor.writable === false) {
        return true;
    }
    return currentDescriptor.writable === false;
}

function shouldKeepRawPropertyValue(
    descriptor: PropertyDescriptor | undefined,
    value: unknown
): boolean {
    if (!isProxyableObject(value)) {
        return false;
    }
    if (isCustomProxy(value)) {
        return false;
    }
    if (!descriptor) {
        return false;
    }
    return descriptorRequiresExactDefinedValue(descriptor, descriptor);
}

function shouldLazilyProxyProperty(
    target: object,
    prop: string | symbol,
    value: unknown
): value is object {
    if (prop === "constructor") {
        return false;
    }
    if (!shouldCreatePlainObjectProxyLazily(value)) {
        return false;
    }
    return true;
}

function shouldCreatePlainObjectProxyLazily(value: unknown): value is object {
    if (!isProxyableObject(value)) {
        return false;
    }
    if (isCustomProxy(value)) {
        return false;
    }
    if (value instanceof ReactiveNode) {
        return false;
    }
    if (isInternalSlotInstance(value)) {
        return false;
    }
    return (
        Array.isArray(value) ||
        Object.getPrototypeOf(value) === Object.prototype
    );
}

function getOrCreateProxiedChild(
    proxyHandler: ICustomProxyHandler<any>,
    prop: string | symbol,
    value: object,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
): object {
    const cachedChild = proxyHandler[proxiedChildrenKey][prop];
    if (cachedChild) {
        return cachedChild;
    }
    const parentToSet: IProxyParent<any> = {
        proxyNode: baseProxy,
        propName: prop,
    };
    const existingManagedProxy = getManagedProxyForUnproxiedNode(value);
    const childProxy =
        existingManagedProxy === undefined
            ? createStructuralProxyForValue(value, parentToSet, emitter)
            : existingManagedProxy;
    const baseChildProxy = getBaseProxy(childProxy);
    proxyHandler[proxiedChildrenKey][prop] = baseChildProxy;
    return baseChildProxy;
}

function createStructuralProxyForValue(
    value: object,
    parentToSet: IProxyParent<any>,
    emitter: TreeChangeEmitter
): object {
    if (isCustomProxy(value)) {
        return reparentProxy(value, parentToSet);
    }
    const existingManagedProxy = getManagedProxyForUnproxiedNode(value);
    if (existingManagedProxy !== undefined) {
        return reparentProxy(existingManagedProxy, parentToSet);
    }
    return buildProxy(value, emitter, parentToSet);
}

function isProxyableObject(value: unknown): value is object {
    if (value === null) {
        return false;
    }
    return typeof value === "object";
}

function preparePropertyValue(
    value: unknown,
    prop: string | symbol,
    baseProxy: TCustomProxy<any> | undefined,
    emitter: TreeChangeEmitter,
    proxyHandler: ICustomProxyHandler<any>
): unknown {
    if (value === null) {
        deleteProxiedChild(proxyHandler, prop);
        return value;
    }
    if (typeof value !== "object") {
        deleteProxiedChild(proxyHandler, prop);
        return value;
    }
    if (prop === "constructor") {
        deleteProxiedChild(proxyHandler, prop);
        return value;
    }
    if (!baseProxy) return value;

    const parentToSet: IProxyParent<any> = {
        proxyNode: baseProxy,
        propName: prop,
    };
    const valueToSet = createStructuralProxyForValue(
        value,
        parentToSet,
        emitter
    );
    proxyHandler[proxiedChildrenKey][prop] = valueToSet;
    return valueToSet;
}

function wrapMapRead(
    prop: string | symbol,
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
): Function {
    if (prop === "get") {
        return function getWrapper(key: any) {
            const value = Map.prototype.get.call(target, key);
            return getOrCreateMapValueProxy(
                target,
                key,
                value,
                baseProxy,
                emitter
            );
        };
    }
    if (prop === "values") {
        return function valuesWrapper() {
            return mapValuesIterator(target, baseProxy, emitter);
        };
    }
    if (prop === "entries" || prop === Symbol.iterator) {
        return function entriesWrapper() {
            return mapEntriesIterator(target, baseProxy, emitter);
        };
    }
    if (prop === "forEach") {
        return function forEachWrapper(
            callback: (value: any, key: any, map: Map<any, any>) => void,
            thisArg?: any
        ) {
            Map.prototype.forEach.call(target, (value, key) => {
                const valueToRead = getOrCreateMapValueProxy(
                    target,
                    key,
                    value,
                    baseProxy,
                    emitter
                );
                callback.call(thisArg, valueToRead, key, baseProxy);
            });
        };
    }
    return (Reflect.get(target, prop, target) as Function).bind(target);
}

function* mapValuesIterator(
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    for (const [key, value] of Map.prototype.entries.call(target)) {
        yield getOrCreateMapValueProxy(target, key, value, baseProxy, emitter);
    }
}

function* mapEntriesIterator(
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    for (const [key, value] of Map.prototype.entries.call(target)) {
        yield [
            key,
            getOrCreateMapValueProxy(target, key, value, baseProxy, emitter),
        ];
    }
}

function getOrCreateMapValueProxy(
    target: Map<any, any>,
    key: any,
    value: any,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    const parentToSet: IProxyParent<any> = {
        proxyNode: baseProxy,
        propName: mapKeyAsPropName(key),
    };
    const valueToRead = createStructuralProxyForValue(
        value,
        parentToSet,
        emitter
    );
    if (valueToRead !== value) {
        Map.prototype.set.call(target, key, valueToRead);
    }
    return valueToRead;
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
                if (isCustomProxy(value)) {
                    valueToStore = reparentProxy(value, parentToSet);
                }
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
    // @retree-throws
    throw new Error(
        `Retree internal invariant failed: unsupported Map mutation '${prop}'. This is unexpected and likely a Retree bug because this wrapper should only receive set, delete, or clear. Please file a Retree issue with the Map operation that triggered this.`
    );
}

function wrapSetRead(
    prop: string | symbol,
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
): Function {
    if (prop === "has") {
        return wrapSetHas(target);
    }
    if (prop === "values" || prop === "keys" || prop === Symbol.iterator) {
        return function valuesWrapper() {
            return setValuesIterator(target, baseProxy, emitter);
        };
    }
    if (prop === "entries") {
        return function entriesWrapper() {
            return setEntriesIterator(target, baseProxy, emitter);
        };
    }
    if (prop === "forEach") {
        return function forEachWrapper(
            callback: (value: any, valueAgain: any, set: Set<any>) => void,
            thisArg?: any
        ) {
            for (const value of Set.prototype.values.call(target)) {
                const valueToRead = getOrCreateSetValueProxy(
                    target,
                    value,
                    baseProxy,
                    emitter
                );
                callback.call(thisArg, valueToRead, valueToRead, baseProxy);
            }
        };
    }
    return (Reflect.get(target, prop, target) as Function).bind(target);
}

function* setValuesIterator(
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    const values = Array.from(Set.prototype.values.call(target));
    for (const value of values) {
        yield getOrCreateSetValueProxy(target, value, baseProxy, emitter);
    }
}

function* setEntriesIterator(
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    const values = Array.from(Set.prototype.values.call(target));
    for (const value of values) {
        const valueToRead = getOrCreateSetValueProxy(
            target,
            value,
            baseProxy,
            emitter
        );
        yield [valueToRead, valueToRead];
    }
}

function getOrCreateSetValueProxy(
    target: Set<any>,
    value: any,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    const parentToSet: IProxyParent<any> = {
        proxyNode: baseProxy,
        propName: null,
    };
    const valueToRead = createStructuralProxyForValue(
        value,
        parentToSet,
        emitter
    );
    if (valueToRead !== value) {
        Set.prototype.delete.call(target, value);
        Set.prototype.add.call(target, valueToRead);
    }
    return valueToRead;
}

function wrapSetMutation(
    prop: string,
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (prop === "add") {
        return function addWrapper(value: any) {
            const hadValue = findSetStoredValue(target, value) !== undefined;
            if (hadValue) {
                return baseProxy;
            }
            let valueToStore = value;
            if (value !== null && typeof value === "object") {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: baseProxy,
                    propName: null,
                };
                if (isCustomProxy(value)) {
                    valueToStore = reparentProxy(value, parentToSet);
                }
            }
            Set.prototype.add.call(target, valueToStore);
            emitCollectionChange(target, baseProxy, emitter, []);
            return baseProxy;
        };
    }
    if (prop === "delete") {
        return function deleteWrapper(value: any) {
            const valueToDelete = findSetStoredValue(target, value);
            const removedNodes: object[] = [];
            if (
                valueToDelete !== undefined &&
                typeof valueToDelete === "object"
            ) {
                const removed = detachCollectionChild(valueToDelete, baseProxy);
                if (removed) removedNodes.push(removed);
            }
            const result =
                valueToDelete === undefined
                    ? false
                    : Set.prototype.delete.call(target, valueToDelete);
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
            Set.prototype.clear.call(target);
            emitCollectionChange(target, baseProxy, emitter, removedNodes);
        };
    }
    // @retree-throws
    throw new Error(
        `Retree internal invariant failed: unsupported Set mutation '${prop}'. This is unexpected and likely a Retree bug because this wrapper should only receive add, delete, or clear. Please file a Retree issue with the Set operation that triggered this.`
    );
}

function wrapSetHas(target: Set<any>) {
    return function hasWrapper(value: any) {
        return findSetStoredValue(target, value) !== undefined;
    };
}

function findSetStoredValue(target: Set<any>, value: any) {
    if (Set.prototype.has.call(target, value)) {
        return value;
    }
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    const rawValue = getUnproxiedNode(value);
    for (const storedValue of target.values()) {
        if (storedValue === value) {
            return storedValue;
        }
        if (
            storedValue !== null &&
            typeof storedValue === "object" &&
            getUnproxiedNode(storedValue) === rawValue
        ) {
            return storedValue;
        }
    }
    return undefined;
}

function wrapDateMutation(
    prop: DateMutatingMethodName,
    target: Date,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    return function dateMutationWrapper(...args: number[]) {
        const previousTime = Date.prototype.getTime.call(target);
        const result = DATE_MUTATING_METHODS[prop].call(target, ...args);
        const nextTime = Date.prototype.getTime.call(target);
        if (!Object.is(previousTime, nextTime)) {
            emitCollectionChange(target, baseProxy, emitter, []);
        }
        return result;
    };
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
    const handler = getCustomProxyHandlerFromMetadata<TNode>(proxy);
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
    const handler = getCustomProxyHandler(proxy);
    if (handler === undefined) {
        throw new Error(
            "Retree internal invariant failed: cannot reparent a proxy without Retree metadata."
        );
    }
    const currentParent = handler[proxiedParentKey];
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
            // @retree-throws
            throw new Error(
                [
                    "Retree cannot assign this node because it already has a structural parent.",
                    "This is expected when the same object is inserted into two different places in the tree.",
                    `Current parent: ${describeParentEdge(currentParent)}.`,
                    `Requested parent: ${describeParentEdge(newParent)}.`,
                    "Fix: choose one explicit ownership operation: move it with Retree.move(node, destination, key), store a reactive pointer with Retree.link(node) or @link, ignore it via @ignore, or duplicate it with Retree.clone(node).",
                ].join(" ")
            );
        }
        currentParent.propName = newParent.propName;
        currentParent.proxyNode = newParent.proxyNode;
    } else {
        handler[proxiedParentKey] = newParent;
    }
    return proxy;
}

function describeParentEdge(parent: IProxyParent<any>) {
    const parentNode =
        parent.proxyNode === null ? null : getUnproxiedNode(parent.proxyNode);
    const parentKind =
        parent.proxyNode === null
            ? "none"
            : Array.isArray(parent.proxyNode)
            ? "Array"
            : parent.proxyNode instanceof Map
            ? "Map"
            : parent.proxyNode instanceof Set
            ? "Set"
            : parentNode?.constructor?.name || "Object";
    const propName =
        parent.propName === null ? "unknown" : String(parent.propName);
    return `${parentKind} at key ${propName}`;
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
    if (nodeRemoved === null) {
        return undefined;
    }
    if (typeof nodeRemoved !== "object") {
        return undefined;
    }
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
    const handler = getCustomProxyHandler(proxy);
    if (handler === undefined) {
        throw new Error(
            "Retree internal invariant failed: cannot get a raw node from a proxy without Retree metadata."
        );
    }
    return handler[unproxiedBaseNodeKey];
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
        const target = getCustomProxyTargetFromMetadata<T>(node);
        if (target === undefined) {
            throw new Error(
                "Retree internal invariant failed: cannot get a base proxy from a proxy without Retree target metadata."
            );
        }
        if (isCustomProxy<T>(target)) {
            return getBaseProxy<T>(target as T);
        }
        return node;
    }
    // @retree-throws
    throw new Error(
        "Retree internal invariant failed: expected a Retree-managed proxy but received an unproxied object. This is unexpected if it came from a public Retree API. Fix: pass objects returned by Retree.root(...) or children read from a Retree tree; if that is already true, file a Retree issue with the operation that triggered this."
    );
}
