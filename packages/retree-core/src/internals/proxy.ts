/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
} from "../ReactiveNode";
import { INodeFieldChanges, TreeNode } from "../types";
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
    proxyHandlerSentinel,
    proxyTargetKey,
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

export const FUNCTION_NAMES_BIND_TO_RAW: ReadonlySet<string | symbol> = new Set(
    ["valueOf", "toISOString", "toJSON"]
);

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

function trackPropertyWriteIfNeeded(
    owner: unknown,
    propertyKey: string | symbol
): void {
    if (!isDependencyTrackingActive()) {
        return;
    }
    trackDependencyPropertyWrite(owner, propertyKey);
}

function createNodeFieldChanges(
    key: string | symbol,
    previous: unknown,
    next: unknown
): INodeFieldChanges[] {
    return [{ key: String(key), previous, new: next }];
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
 * Proxy handler for a base (non-reproxy) Retree node.
 *
 * @remarks
 * Trap methods live on the prototype and per-node state lives in fields, so
 * creating a node allocates one handler instance instead of a handler object
 * literal plus one closure per trap. Materialization of large trees is
 * allocation-bound, so this shape matters.
 */
class BaseProxyHandler<T extends TreeNode>
    implements ProxyHandler<T>, ICustomProxyHandler<T>
{
    public [unproxiedBaseNodeKey]: T;
    public [proxiedChildrenKey]: Record<string | symbol, any> | null;
    public [proxiedParentKey]: IProxyParent | null;
    public [proxyTargetKey]?: T;
    public baseProxy!: TCustomProxy<T>;
    public readonly emitter: TreeChangeEmitter;
    public readonly reactiveObject: ReactiveNode | undefined;
    private readonly mapObject: Map<any, any> | undefined;
    private readonly setObject: Set<any> | undefined;
    private readonly dateObject: Date | undefined;
    private readonly hasInternalSlots: boolean;
    private isApplyingSet = false;
    private boundFunctionCache: Map<
        string | symbol,
        BoundFunctionCacheEntry
    > | null = null;
    /**
     * Raw purity: Map/Set targets store raw values only; their child proxies
     * live here, keyed by map key (Map) or raw member (Set). Lazily
     * allocated for collections with object values.
     */
    public collectionProxies: Map<any, TCustomProxy<any>> | null = null;

    constructor(
        object: T,
        emitter: TreeChangeEmitter,
        parent: IProxyParent<any> | null
    ) {
        this[unproxiedBaseNodeKey] = object;
        // Lazily allocated: leaf nodes never cache children.
        this[proxiedChildrenKey] = null;
        this[proxiedParentKey] = parent;
        this.emitter = emitter;
        this.reactiveObject =
            object instanceof ReactiveNode ? object : undefined;
        this.mapObject = object instanceof Map ? object : undefined;
        this.setObject = object instanceof Set ? object : undefined;
        this.dateObject = object instanceof Date ? object : undefined;
        this.hasInternalSlots =
            this.mapObject !== undefined ||
            this.setObject !== undefined ||
            this.dateObject !== undefined;
    }

    private getBoundFunction<TFunction extends Function>(
        prop: string | symbol,
        source: TFunction,
        thisArg: unknown
    ): TFunction {
        this.boundFunctionCache ??= new Map();
        return getCachedBoundFunction(
            this.boundFunctionCache,
            prop,
            source,
            thisArg
        );
    }

    public get(target: T, prop: string | symbol, receiver: any): any {
        if (prop === proxyHandlerSentinel) {
            return this;
        }
        if (prop === "[[Handler]]") {
            return this;
        }
        if (prop === "[[Target]]") {
            return this[unproxiedBaseNodeKey];
        }
        const reactiveObject = this.reactiveObject;
        const baseProxy = this.baseProxy;
        if (reactiveObject !== undefined) {
            // Collected/ignore keys are always strings; symbol props skip
            // these checks without paying a String(prop) allocation.
            if (typeof prop === "string") {
                if (prop.startsWith("RETREE_")) {
                    return Reflect.get(target, prop, target);
                }
                if (reactiveObject[COLLECTED_KEYS_SYMBOL].has(prop)) {
                    return trackPropertyAccessIfNeeded(
                        baseProxy,
                        prop,
                        getLatestIgnoredValue(Reflect.get(target, prop, target))
                    );
                }
            }
            if (reactiveObject[LINKED_KEYS_SYMBOL].has(prop)) {
                return trackPropertyAccessIfNeeded(
                    baseProxy,
                    prop,
                    getLatestLinkedValue(Reflect.get(target, prop, target))
                );
            }
        }
        const cachedChildren = this[proxiedChildrenKey];
        if (
            cachedChildren !== null &&
            typeof prop === "string" &&
            cachedChildren[prop]
        ) {
            const value = cachedChildren[prop];
            if (typeof value !== "function") {
                return trackPropertyAccessIfNeeded(baseProxy, prop, value);
            }
        }
        if (this.hasInternalSlots) {
            // Methods on Map/Set must run with the raw target as `this` because they read
            // internal slots that the proxy does not expose.
            const value = Reflect.get(target, prop, target);
            if (typeof value === "function") {
                const mapObject = this.mapObject;
                const setObject = this.setObject;
                const dateObject = this.dateObject;
                if (
                    mapObject !== undefined &&
                    typeof prop === "string" &&
                    MAP_MUTATING_METHODS.has(prop)
                ) {
                    return wrapMapMutation(
                        this,
                        prop,
                        mapObject,
                        baseProxy,
                        this.emitter
                    );
                }
                if (mapObject !== undefined) {
                    return wrapMapRead(
                        this,
                        prop,
                        mapObject,
                        baseProxy,
                        this.emitter
                    );
                }
                if (
                    setObject !== undefined &&
                    typeof prop === "string" &&
                    SET_MUTATING_METHODS.has(prop)
                ) {
                    return wrapSetMutation(
                        this,
                        prop,
                        setObject,
                        baseProxy,
                        this.emitter
                    );
                }
                if (setObject !== undefined) {
                    return wrapSetRead(
                        this,
                        prop,
                        setObject,
                        baseProxy,
                        this.emitter
                    );
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
                        this.emitter
                    );
                }
                return trackAccessIfNeeded(
                    this.getBoundFunction(prop, value, target)
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
            if (FUNCTION_NAMES_BIND_TO_RAW.has(prop)) {
                return trackAccessIfNeeded(
                    this.getBoundFunction(prop, value, target)
                );
            }
            return trackAccessIfNeeded(
                this.getBoundFunction(prop, value, baseProxy)
            );
        }
        if (shouldLazilyProxyProperty(target, prop, value)) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
            if (!descriptor || !descriptorHasValue(descriptor)) {
                return trackPropertyAccessIfNeeded(baseProxy, prop, value);
            }
            // shouldLazilyProxyProperty already established the value is a
            // proxyable non-proxy object; only the descriptor lock check
            // from shouldKeepRawPropertyValue remains.
            if (!descriptorRequiresExactDefinedValue(descriptor, descriptor)) {
                return trackPropertyAccessIfNeeded(
                    baseProxy,
                    prop,
                    getOrCreateProxiedChild(
                        this,
                        prop,
                        value,
                        baseProxy,
                        this.emitter
                    )
                );
            }
        }
        return trackPropertyAccessIfNeeded(baseProxy, prop, value);
    }

    public set(
        target: T,
        prop: string | symbol,
        newValue: any,
        receiver: any
    ): boolean {
        const baseProxy = this.baseProxy;
        const reactiveObject = this.reactiveObject;
        trackPropertyWriteIfNeeded(baseProxy, prop);
        // Raw purity: targets store raw values only; proxies live in the
        // children cache. Change payloads are raw on both sides.
        const rawNewValue =
            newValue !== null && typeof newValue === "object"
                ? getUnproxiedNode(newValue) ?? newValue
                : newValue;
        if (reactiveObject !== undefined) {
            const propString = String(prop);
            if (reactiveObject[LINKED_KEYS_SYMBOL].has(prop)) {
                assertValidLinkedValue(prop, newValue);
                const prev = Reflect.get(target, prop, target);
                if (prev === rawNewValue) {
                    return true;
                }
                let returnValue: boolean;
                this.isApplyingSet = true;
                try {
                    returnValue = Reflect.set(
                        target,
                        prop,
                        rawNewValue,
                        target
                    );
                } finally {
                    this.isApplyingSet = false;
                }
                if (!Transactions.skipReproxy) {
                    const reproxy = updateReproxyNode(baseProxy);
                    const changes = createNodeFieldChanges(
                        prop,
                        prev,
                        rawNewValue
                    );
                    this.emitter.emit(
                        "nodeChanged",
                        this[unproxiedBaseNodeKey],
                        baseProxy,
                        reproxy,
                        changes
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
        // Raw-to-raw comparison: reassigning the node already stored at this
        // property (via its base proxy or any reproxy) is a no-op.
        const hasChanged = prev !== rawNewValue;
        if (hasChanged) {
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
                    setProxiedChild(
                        this,
                        prop,
                        reparentProxy(newValue, parentToSet)
                    );
                } else if (
                    getManagedProxyForUnproxiedNode(newValue) !== undefined
                ) {
                    setProxiedChild(
                        this,
                        prop,
                        createStructuralProxyForValue(
                            newValue,
                            parentToSet,
                            this.emitter
                        )
                    );
                } else if (shouldCreatePlainObjectProxyLazily(newValue)) {
                    deleteProxiedChild(this, prop);
                } else {
                    setProxiedChild(
                        this,
                        prop,
                        createStructuralProxyForValue(
                            newValue,
                            parentToSet,
                            this.emitter
                        )
                    );
                }
            } else {
                deleteProxiedChild(this, prop);
            }
            let returnValue: boolean;
            this.isApplyingSet = true;
            try {
                returnValue = Reflect.set(target, prop, rawNewValue, receiver);
            } finally {
                this.isApplyingSet = false;
            }
            // If in a skip reproxy transaction, do not reproxy node
            if (!Transactions.skipReproxy) {
                const reproxy = updateReproxyNode(baseProxy);
                const changes = createNodeFieldChanges(prop, prev, rawNewValue);
                // Still emit here if in a `skipEmit` transaction so that parents get reproxied
                this.emitter.emit(
                    "nodeChanged",
                    this[unproxiedBaseNodeKey],
                    baseProxy,
                    reproxy,
                    changes
                );
                // nodeRemoved events do not reproxy parents, so we skip
                if (nodeRemoved && !Transactions.skipEmit) {
                    const removedUnproxied = getUnproxiedNode(nodeRemoved);
                    this.emitter.emit(
                        "nodeRemoved",
                        removedUnproxied ?? nodeRemoved,
                        nodeRemoved
                    );
                }
            }

            return returnValue;
        }
        return true;
    }

    public defineProperty(
        target: T,
        prop: string | symbol,
        descriptor: PropertyDescriptor
    ): boolean {
        const reactiveObject = this.reactiveObject;
        if (this.isApplyingSet) {
            return Reflect.defineProperty(target, prop, descriptor);
        }
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
        const currentProxy = currentProxyForWrite;
        const baseProxy = currentProxy
            ? getBaseProxy(currentProxy)
            : currentProxy;
        const descriptorToDefine: PropertyDescriptor = { ...descriptor };
        const currentDescriptor = Reflect.getOwnPropertyDescriptor(
            target,
            prop
        );
        const previousValue = currentDescriptorHasValue(currentDescriptor)
            ? currentDescriptor.value
            : undefined;
        // Raw purity: payload values are raw on both sides (§9.1 of the raw
        // spec); the defined value stored in the target is raw as well.
        const rawNextValue = descriptorHasValue(descriptor)
            ? descriptor.value !== null && typeof descriptor.value === "object"
                ? getUnproxiedNode(descriptor.value) ?? descriptor.value
                : descriptor.value
            : descriptor;
        const nextValue = rawNextValue;
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
                deleteProxiedChild(this, prop);
            } else {
                descriptorToDefine.value = preparePropertyValue(
                    descriptorToDefine.value,
                    prop,
                    baseProxy,
                    this.emitter,
                    this
                );
            }
        } else if (descriptorHasAccessor(descriptorToDefine)) {
            if (baseProxy) {
                nodeRemoved = handleNodeRemoved(baseProxy, prop);
            }
            deleteProxiedChild(this, prop);
        } else if (currentDescriptorHasValue(currentDescriptor)) {
            // Attribute-only redefinition of a data property: the target
            // already stores the raw child; keep it in place.
            descriptorToDefine.value = currentDescriptor.value;
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
                this.emitter.emit(
                    "nodeChanged",
                    this[unproxiedBaseNodeKey],
                    baseProxy,
                    reproxy,
                    createNodeFieldChanges(prop, previousValue, nextValue)
                );
            } else {
                console.warn(
                    `buildProxy.defineProperty: cannot find baseProxy for target`
                );
            }
            // nodeRemoved events do not reproxy parents, so we skip
            if (nodeRemoved && !Transactions.skipEmit) {
                const removedUnproxied = getUnproxiedNode(nodeRemoved);
                this.emitter.emit(
                    "nodeRemoved",
                    removedUnproxied ?? nodeRemoved,
                    nodeRemoved
                );
            }
        }
        return returnValue;
    }

    public deleteProperty(target: T, prop: string | symbol): boolean {
        const reactiveObject = this.reactiveObject;
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
        const previousValue = Reflect.get(target, prop, target);
        const returnValue = Reflect.deleteProperty(target, prop);
        if (returnValue) {
            deleteProxiedChild(this, prop);
        }
        // If in a skip reproxy transaction, do not reproxy node
        if (!Transactions.skipReproxy) {
            if (baseProxy) {
                const reproxy = updateReproxyNode(baseProxy);
                // Still emit here if in a `skipEmit` transaction so that parents get reproxied
                this.emitter.emit(
                    "nodeChanged",
                    this[unproxiedBaseNodeKey],
                    baseProxy,
                    reproxy,
                    createNodeFieldChanges(prop, previousValue, undefined)
                );
            } else {
                console.warn(
                    `buildProxy.deleteProperty: cannot find baseProxy for target`
                );
            }
            // nodeRemoved events do not reproxy parents, so we skip
            if (nodeRemoved && !Transactions.skipEmit) {
                const removedUnproxied = getUnproxiedNode(nodeRemoved);
                this.emitter.emit(
                    "nodeRemoved",
                    removedUnproxied ?? nodeRemoved,
                    nodeRemoved
                );
            }
        }
        return returnValue;
    }
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
    if (object === null) return object;
    if (isCustomProxy(object)) return getBaseProxy(object);
    const proxyHandler = new BaseProxyHandler<T>(
        object,
        emitter,
        parent ?? null
    );
    const proxy = new Proxy(object, proxyHandler) as TCustomProxy<T>;
    proxyHandler.baseProxy = proxy;
    const reactiveObject = proxyHandler.reactiveObject;
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
                cacheCollectionChildProxy(proxyHandler, key, childProxy);
                // Raw purity: the raw map stores the raw node.
                Map.prototype.set.call(
                    object,
                    key,
                    getUnproxiedNode(childProxy)
                );
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
                const rawChild = getUnproxiedNode(childProxy);
                cacheCollectionChildProxy(proxyHandler, rawChild, childProxy);
                // Raw purity: the raw set stores the raw node.
                if (rawChild !== value) {
                    replacements.push({
                        previous: value,
                        next: rawChild,
                    });
                }
            }
        }
        for (const replacement of replacements) {
            Set.prototype.delete.call(object, replacement.previous);
            Set.prototype.add.call(object, replacement.next);
        }
    } else {
        // The children record was created empty just above, so deferred
        // children need no bookkeeping here; they resolve through the lazy
        // read path. Checking laziness before descriptors keeps this walk
        // free of per-property descriptor allocations for plain data.
        for (const prop of Object.keys(object)) {
            const value = (object as Record<string, unknown>)[prop];
            if (
                value === null ||
                (reactiveObject !== undefined &&
                    (prop === COLLECTED_KEYS_SYMBOL ||
                        reactiveObject[COLLECTED_KEYS_SYMBOL].has(prop) ||
                        reactiveObject[LINKED_KEYS_SYMBOL].has(prop)))
            ) {
                setProxiedChild(proxyHandler, prop, value);
            } else if (typeof value === "object") {
                if (shouldCreatePlainObjectProxyLazily(value)) {
                    continue;
                }
                const descriptor = Reflect.getOwnPropertyDescriptor(
                    object,
                    prop
                );
                if (shouldKeepRawPropertyValue(descriptor, value)) {
                    continue;
                }
                const cProxy = buildProxy(value, emitter, {
                    proxyNode: proxy,
                    propName: prop,
                });
                setProxiedChild(proxyHandler, prop, getBaseProxy(cProxy));
            }
        }
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
    const children = proxyHandler[proxiedChildrenKey];
    if (children === null) {
        return;
    }
    Reflect.deleteProperty(children, prop);
}

function setProxiedChild(
    proxyHandler: ICustomProxyHandler<any>,
    prop: string | symbol,
    value: unknown
) {
    (proxyHandler[proxiedChildrenKey] ??= {})[prop] = value;
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
    // Cheap shape checks first; isCustomProxy costs a WeakMap lookup.
    if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype
    ) {
        return false;
    }
    return !isCustomProxy(value);
}

function getOrCreateProxiedChild(
    proxyHandler: ICustomProxyHandler<any>,
    prop: string | symbol,
    value: object,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
): object {
    const cachedChild = proxyHandler[proxiedChildrenKey]?.[prop];
    if (cachedChild) {
        return cachedChild;
    }
    const parentToSet: IProxyParent<any> = {
        proxyNode: baseProxy,
        propName: prop,
    };
    // Callers guarantee `value` is a raw (non-proxy) object, so a managed
    // proxy can only exist if this same raw node was proxied elsewhere first.
    const existingManagedProxy = getManagedProxyForUnproxiedNode(value);
    if (existingManagedProxy === undefined) {
        // buildProxy returns the base proxy for a fresh raw object.
        const builtChildProxy = buildProxy(value, emitter, parentToSet);
        setProxiedChild(proxyHandler, prop, builtChildProxy);
        return builtChildProxy;
    }
    const baseChildProxy = getBaseProxy(existingManagedProxy);
    setProxiedChild(proxyHandler, prop, baseChildProxy);
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

/**
 * Prepare a value being defined onto a node: parent/cache its proxy and
 * return the **raw** value to store in the target (raw purity).
 */
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
    setProxiedChild(proxyHandler, prop, valueToSet);
    return getUnproxiedNode(valueToSet as TreeNode) ?? valueToSet;
}

/**
 * @internal
 * Force-materialize the direct children of a managed node by reading each
 * object-valued child through the proxy once. Used by `useRaw`'s `toManaged`
 * to guarantee raw direct children (including Map values and Set members)
 * resolve to managed nodes. Idempotent: already-materialized children are
 * cache hits.
 */
export function materializeDirectChildren(node: TreeNode): void {
    const baseProxy = getBaseProxy(node);
    const rawNode = getUnproxiedNode(baseProxy);
    if (rawNode === undefined) {
        return;
    }
    if (rawNode instanceof Map) {
        const mapProxy = baseProxy as unknown as Map<unknown, unknown>;
        for (const key of Map.prototype.keys.call(rawNode)) {
            void mapProxy.get(key);
        }
        return;
    }
    if (rawNode instanceof Set) {
        const setProxy = baseProxy as unknown as Set<unknown>;
        for (const value of setProxy.values()) {
            void value;
        }
        return;
    }
    if (rawNode instanceof Date) {
        return;
    }
    const record = baseProxy as unknown as Record<string, unknown>;
    for (const key of Object.keys(rawNode)) {
        const rawValue = (rawNode as Record<string, unknown>)[key];
        if (rawValue !== null && typeof rawValue === "object") {
            void record[key];
        }
    }
}

function unwrapCollectionValue(value: any): any {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return getUnproxiedNode(value) ?? value;
}

function resolveCollectionChildProxy(
    handler: ICustomProxyHandler<any>,
    cacheKey: any,
    rawValue: unknown
): TCustomProxy<any> | undefined {
    const cached = handler.collectionProxies?.get(cacheKey);
    if (
        cached !== undefined &&
        getUnproxiedNodeFromProxy(cached) === rawValue
    ) {
        return cached;
    }
    if (rawValue === null || typeof rawValue !== "object") {
        return undefined;
    }
    return getManagedProxyForUnproxiedNode(rawValue as TreeNode);
}

function cacheCollectionChildProxy(
    handler: ICustomProxyHandler<any>,
    cacheKey: any,
    childProxy: object
): void {
    (handler.collectionProxies ??= new Map()).set(
        cacheKey,
        getBaseProxy(childProxy as TreeNode)
    );
}

function wrapMapRead(
    handler: ICustomProxyHandler<any>,
    prop: string | symbol,
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
): Function {
    if (prop === "get") {
        return function getWrapper(key: any) {
            const value = Map.prototype.get.call(target, key);
            return getOrCreateMapValueProxy(
                handler,
                key,
                value,
                baseProxy,
                emitter
            );
        };
    }
    if (prop === "values") {
        return function valuesWrapper() {
            return mapValuesIterator(handler, target, baseProxy, emitter);
        };
    }
    if (prop === "entries" || prop === Symbol.iterator) {
        return function entriesWrapper() {
            return mapEntriesIterator(handler, target, baseProxy, emitter);
        };
    }
    if (prop === "forEach") {
        return function forEachWrapper(
            callback: (value: any, key: any, map: Map<any, any>) => void,
            thisArg?: any
        ) {
            Map.prototype.forEach.call(target, (value, key) => {
                const valueToRead = getOrCreateMapValueProxy(
                    handler,
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
    handler: ICustomProxyHandler<any>,
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    for (const [key, value] of Map.prototype.entries.call(target)) {
        yield getOrCreateMapValueProxy(handler, key, value, baseProxy, emitter);
    }
}

function* mapEntriesIterator(
    handler: ICustomProxyHandler<any>,
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    for (const [key, value] of Map.prototype.entries.call(target)) {
        yield [
            key,
            getOrCreateMapValueProxy(handler, key, value, baseProxy, emitter),
        ];
    }
}

function getOrCreateMapValueProxy(
    handler: ICustomProxyHandler<any>,
    key: any,
    value: any,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    // Raw purity: the raw map stores raw values; the child proxy lives in
    // the handler's side cache keyed by map key.
    const cached = handler.collectionProxies?.get(key);
    if (cached !== undefined && getUnproxiedNodeFromProxy(cached) === value) {
        return cached;
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
    cacheCollectionChildProxy(handler, key, valueToRead);
    return valueToRead;
}

function wrapMapMutation(
    handler: ICustomProxyHandler<any>,
    prop: string,
    target: Map<any, any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (prop === "set") {
        return function setWrapper(key: any, value: any) {
            const previous = target.get(key);
            const rawValue = unwrapCollectionValue(value);
            const removedNodes: object[] = [];
            // If we are replacing an existing object child of this map, detach it.
            if (
                previous !== rawValue &&
                previous !== null &&
                typeof previous === "object"
            ) {
                const previousProxy = resolveCollectionChildProxy(
                    handler,
                    key,
                    previous
                );
                if (previousProxy !== undefined) {
                    const removed = detachCollectionChild(
                        previousProxy,
                        baseProxy
                    );
                    if (removed) removedNodes.push(removed);
                }
            }
            if (value !== null && typeof value === "object") {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: baseProxy,
                    propName: mapKeyAsPropName(key),
                };
                if (isCustomProxy(value)) {
                    cacheCollectionChildProxy(
                        handler,
                        key,
                        reparentProxy(value, parentToSet)
                    );
                } else {
                    // Plain or managed-raw values resolve lazily on read.
                    handler.collectionProxies?.delete(key);
                }
            } else {
                handler.collectionProxies?.delete(key);
            }
            Map.prototype.set.call(target, key, rawValue);
            emitCollectionChange(
                target,
                baseProxy,
                emitter,
                removedNodes,
                createNodeFieldChanges(key, previous, rawValue)
            );
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
                const previousProxy = resolveCollectionChildProxy(
                    handler,
                    key,
                    previous
                );
                if (previousProxy !== undefined) {
                    const removed = detachCollectionChild(
                        previousProxy,
                        baseProxy
                    );
                    if (removed) removedNodes.push(removed);
                }
            }
            const result = Map.prototype.delete.call(target, key);
            if (result) {
                handler.collectionProxies?.delete(key);
                emitCollectionChange(
                    target,
                    baseProxy,
                    emitter,
                    removedNodes,
                    createNodeFieldChanges(key, previous, undefined)
                );
            }
            return result;
        };
    }
    if (prop === "clear") {
        return function clearWrapper() {
            if (target.size === 0) return;
            const removedNodes: object[] = [];
            Map.prototype.forEach.call(target, (value, key) => {
                if (value !== null && typeof value === "object") {
                    const valueProxy = resolveCollectionChildProxy(
                        handler,
                        key,
                        value
                    );
                    if (valueProxy !== undefined) {
                        const removed = detachCollectionChild(
                            valueProxy,
                            baseProxy
                        );
                        if (removed) removedNodes.push(removed);
                    }
                }
            });
            const previousSize = target.size;
            Map.prototype.clear.call(target);
            handler.collectionProxies?.clear();
            emitCollectionChange(
                target,
                baseProxy,
                emitter,
                removedNodes,
                createNodeFieldChanges("clear", previousSize, 0)
            );
        };
    }
    // @retree-throws
    throw new Error(
        `Retree internal invariant failed: unsupported Map mutation '${prop}'. This is unexpected and likely a Retree bug because this wrapper should only receive set, delete, or clear. Please file a Retree issue with the Map operation that triggered this.`
    );
}

function wrapSetRead(
    handler: ICustomProxyHandler<any>,
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
            return setValuesIterator(handler, target, baseProxy, emitter);
        };
    }
    if (prop === "entries") {
        return function entriesWrapper() {
            return setEntriesIterator(handler, target, baseProxy, emitter);
        };
    }
    if (prop === "forEach") {
        return function forEachWrapper(
            callback: (value: any, valueAgain: any, set: Set<any>) => void,
            thisArg?: any
        ) {
            for (const value of Set.prototype.values.call(target)) {
                const valueToRead = getOrCreateSetValueProxy(
                    handler,
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

// Raw purity removed the read-time write-backs that used to mutate the set
// during iteration, so these iterators no longer need an Array.from copy.
function* setValuesIterator(
    handler: ICustomProxyHandler<any>,
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    for (const value of Set.prototype.values.call(target)) {
        yield getOrCreateSetValueProxy(handler, value, baseProxy, emitter);
    }
}

function* setEntriesIterator(
    handler: ICustomProxyHandler<any>,
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    for (const value of Set.prototype.values.call(target)) {
        const valueToRead = getOrCreateSetValueProxy(
            handler,
            value,
            baseProxy,
            emitter
        );
        yield [valueToRead, valueToRead];
    }
}

function getOrCreateSetValueProxy(
    handler: ICustomProxyHandler<any>,
    value: any,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    // Raw purity: the raw set stores raw members; the child proxy lives in
    // the handler's side cache keyed by the raw member.
    const cached = handler.collectionProxies?.get(value);
    if (cached !== undefined) {
        return cached;
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
    cacheCollectionChildProxy(handler, value, valueToRead);
    return valueToRead;
}

function wrapSetMutation(
    handler: ICustomProxyHandler<any>,
    prop: string,
    target: Set<any>,
    baseProxy: TCustomProxy<any>,
    emitter: TreeChangeEmitter
) {
    if (prop === "add") {
        return function addWrapper(value: any) {
            const rawValue = unwrapCollectionValue(value);
            if (findSetStoredValue(target, rawValue) !== undefined) {
                return baseProxy;
            }
            if (value !== null && typeof value === "object") {
                const parentToSet: IProxyParent<any> = {
                    proxyNode: baseProxy,
                    propName: null,
                };
                if (isCustomProxy(value)) {
                    cacheCollectionChildProxy(
                        handler,
                        rawValue,
                        reparentProxy(value, parentToSet)
                    );
                }
            }
            Set.prototype.add.call(target, rawValue);
            emitCollectionChange(
                target,
                baseProxy,
                emitter,
                [],
                createNodeFieldChanges("add", undefined, rawValue)
            );
            return baseProxy;
        };
    }
    if (prop === "delete") {
        return function deleteWrapper(value: any) {
            const valueToDelete = findSetStoredValue(target, value);
            const removedNodes: object[] = [];
            if (
                valueToDelete !== undefined &&
                valueToDelete !== null &&
                typeof valueToDelete === "object"
            ) {
                const valueProxy = resolveCollectionChildProxy(
                    handler,
                    valueToDelete,
                    valueToDelete
                );
                if (valueProxy !== undefined) {
                    const removed = detachCollectionChild(
                        valueProxy,
                        baseProxy
                    );
                    if (removed) removedNodes.push(removed);
                }
            }
            const result =
                valueToDelete === undefined
                    ? false
                    : Set.prototype.delete.call(target, valueToDelete);
            if (result) {
                handler.collectionProxies?.delete(valueToDelete);
                emitCollectionChange(
                    target,
                    baseProxy,
                    emitter,
                    removedNodes,
                    createNodeFieldChanges("delete", valueToDelete, undefined)
                );
            }
            return result;
        };
    }
    if (prop === "clear") {
        return function clearWrapper() {
            if (target.size === 0) return;
            const removedNodes: object[] = [];
            Set.prototype.forEach.call(target, (value) => {
                if (value !== null && typeof value === "object") {
                    const valueProxy = resolveCollectionChildProxy(
                        handler,
                        value,
                        value
                    );
                    if (valueProxy !== undefined) {
                        const removed = detachCollectionChild(
                            valueProxy,
                            baseProxy
                        );
                        if (removed) removedNodes.push(removed);
                    }
                }
            });
            const previousSize = target.size;
            Set.prototype.clear.call(target);
            handler.collectionProxies?.clear();
            emitCollectionChange(
                target,
                baseProxy,
                emitter,
                removedNodes,
                createNodeFieldChanges("clear", previousSize, 0)
            );
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

/**
 * Raw purity: sets store raw members, so membership checks reduce to at most
 * two `Set.prototype.has` calls (the value as given, then its raw node).
 */
function findSetStoredValue(target: Set<any>, value: any) {
    if (Set.prototype.has.call(target, value)) {
        return value;
    }
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    const rawValue = getUnproxiedNode(value);
    if (
        rawValue !== undefined &&
        rawValue !== value &&
        Set.prototype.has.call(target, rawValue)
    ) {
        return rawValue;
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
            emitCollectionChange(
                target,
                baseProxy,
                emitter,
                [],
                createNodeFieldChanges(prop, previousTime, nextTime)
            );
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
    removedNodes: object[],
    changes: INodeFieldChanges[]
) {
    if (Transactions.skipReproxy) return;
    const reproxy = updateReproxyNode(baseProxy);
    emitter.emit("nodeChanged", target, baseProxy, reproxy, changes);
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
