/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
} from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import {
    getCustomProxyHandler,
    getBaseProxy,
    getUnproxiedNode,
    FUNCTION_NAMES_BIND_TO_RAW,
    getCachedBoundFunction,
    isInternalSlotInstance,
    isNativeArrayMutatorAccess,
} from "./proxy.js";
import {
    isDependencyTrackingActive,
    trackDependencyAccess,
    trackDependencyPropertyAccess,
} from "./dependency-tracking.js";
import { readReactiveNodeProperty } from "./memo.js";
import {
    ICustomProxyHandler,
    IProxyParent,
    ISnapshotVersionRecord,
    isCustomProxy,
    proxiedChildrenKey,
    unproxiedBaseNodeKey,
    proxiedParentKey,
    proxyHandlerSentinel,
    proxyTargetKey,
    registerCustomProxyMetadata,
    TCustomProxy,
} from "./proxy-types.js";
import { advanceSnapshotVersions } from "./snapshot-version.js";

const reproxyMap: WeakMap<TreeNode, TCustomProxy<TreeNode>> = new WeakMap();
/**
 * Registry mapping raw nodes to their base proxies.
 */
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
    // Note: a symbol property on the raw node was measured as 4-5x faster
    // than WeakMap.set, but non-enumerable definitions cost the same as the
    // WeakMap and enumerable ones leak into deep-equality assertions on raw
    // nodes (vitest/jest toEqual compares symbol props). WeakMap stays.
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
    const reproxy = buildReproxy<T>(node, handler);
    reproxyMap.set(unproxiedNode, reproxy);
    return reproxy;
}

/**
 * Reproxy a node for a logical `nodeChanged` event and advance its React
 * external-store versions before any listener can observe the change.
 *
 * @internal
 */
export function updateReproxyNodeForChange<T extends TreeNode = TreeNode>(
    node: TCustomProxy<T>
): TCustomProxy<T> {
    const reproxy = updateReproxyNode(node);
    advanceSnapshotVersions(node);
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
        getBaseProxyForUnproxiedNode(unproxiedNode)
    );
}

function getBaseProxyForUnproxiedNode<T extends TreeNode = TreeNode>(
    unproxiedNode: T
): TCustomProxy<T> | undefined {
    return baseProxyMap.get(unproxiedNode) as TCustomProxy<T> | undefined;
}

/**
 * @internal
 * Proxy handler for a reproxy (fresh-identity wrapper around a base proxy).
 *
 * @remarks
 * A reproxy is built on every observable mutation, so this is a write-path
 * allocation. Trap methods live on the prototype and per-reproxy state lives
 * in fields, mirroring the base handler class in proxy.ts.
 */
class ReproxyHandler<T extends TreeNode>
    implements ProxyHandler<TCustomProxy<T>>, ICustomProxyHandler<T>
{
    public [unproxiedBaseNodeKey]: T;
    public [proxiedParentKey]: IProxyParent | null;
    public [proxyTargetKey]?: T;
    /** The base proxy this reproxy wraps. */
    private readonly baseProxyObject: TCustomProxy<T>;
    private readonly baseHandler: ICustomProxyHandler<T>;
    private boundFunctionCache: Map<
        string | symbol,
        { source: Function; bound: Function }
    > | null = null;

    constructor(
        baseProxyObject: TCustomProxy<T>,
        baseHandler: ICustomProxyHandler<T>
    ) {
        this[unproxiedBaseNodeKey] = baseHandler[unproxiedBaseNodeKey];
        this[proxiedParentKey] = baseHandler[proxiedParentKey];
        this.baseProxyObject = baseProxyObject;
        this.baseHandler = baseHandler;
    }

    /**
     * The children cache belongs to the base handler and is allocated lazily,
     * so delegate instead of copying a reference at construction time.
     */
    public get [proxiedChildrenKey](): Record<string | symbol, any> | null {
        return this.baseHandler[proxiedChildrenKey];
    }

    public set [proxiedChildrenKey](
        value: Record<string | symbol, any> | null
    ) {
        this.baseHandler[proxiedChildrenKey] = value;
    }

    /**
     * Snapshot versions belong to the base handler so every proxy of a node
     * shares one in-place-mutated record; delegate both directions.
     */
    public get snapshotVersionsRecord(): ISnapshotVersionRecord | null {
        return this.baseHandler.snapshotVersionsRecord;
    }

    public set snapshotVersionsRecord(value: ISnapshotVersionRecord | null) {
        this.baseHandler.snapshotVersionsRecord = value;
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

    /**
     * Wrap a base-proxy array mutator so callers holding a reproxy receive
     * the latest reproxy back when the mutator returns the array itself
     * (sort/reverse/fill/copyWithin). The wrapper is cached on the BASE
     * handler, not this reproxy handler: reproxies are rebuilt on every
     * mutation, and `arr.push === arr.push` must hold across generations so
     * tracked selectors reading a mutator method do not re-run forever.
     */
    private getReproxyAwareArrayMutator(
        prop: string | symbol,
        baseMutator: Function
    ): Function {
        const cache = (this.baseHandler.reproxyArrayMutatorCache ??= new Map());
        const cached = cache.get(prop);
        if (cached !== undefined) {
            return cached;
        }
        const object = this.baseProxyObject;
        const reproxyAwareMutator = (...args: unknown[]) => {
            const result = baseMutator(...args);
            if (result === object) {
                return getReproxyNode(object);
            }
            return result;
        };
        cache.set(prop, reproxyAwareMutator);
        return reproxyAwareMutator;
    }

    public get(
        target: TCustomProxy<T>,
        prop: string | symbol,
        receiver: any
    ): any {
        if (prop === proxyHandlerSentinel) {
            return this;
        }
        if (prop === "[[Handler]]") {
            return this;
        }
        const object = this.baseProxyObject;
        if (prop === "[[Target]]") {
            return object;
        }
        if (target instanceof ReactiveNode) {
            // Check for ignore keys
            if (typeof prop === "string" && prop.startsWith("RETREE_")) {
                return Reflect.get(target, prop, target);
            }
            if (target[COLLECTED_KEYS_SYMBOL].has(prop)) {
                return getLatestIgnoredValue(Reflect.get(target, prop, target));
            }
            if (target[LINKED_KEYS_SYMBOL].has(prop)) {
                return getLatestLinkedValue(Reflect.get(target, prop, target));
            }
        }
        // The children cache has a null prototype, so prototype members like
        // "constructor" can never appear as phantom cache hits here.
        const children = this.baseHandler[proxiedChildrenKey];
        if (children !== null && typeof prop === "string" && children[prop]) {
            const childProxy = children[prop];
            if (typeof childProxy !== "function") {
                const reproxy = getReproxyNode(childProxy);
                return trackPropertyAccessIfNeeded(
                    object,
                    prop,
                    reproxy ?? childProxy
                );
            }
        }
        const rawNode = this.baseHandler[unproxiedBaseNodeKey];
        // Some built-in methods need internal slots on `this`. Delegate property access to the
        // base proxy so the bind/wrap logic in buildProxy is reused (and mutations emit).
        if (isInternalSlotInstance(rawNode)) {
            return trackPropertyAccessIfNeeded(
                object,
                prop,
                Reflect.get(object, prop, object)
            );
        }
        // Native array mutators must resolve through the base proxy so
        // wrapArrayMutation handles the whole call as one coherent
        // nodeChanged emission. Reading the native method off the raw node
        // here and binding it to the reproxy would replay the per-element
        // write pipeline (one emission per shifted index).
        if (isNativeArrayMutatorAccess(rawNode, prop)) {
            const baseMutator: unknown = Reflect.get(object, prop, object);
            if (typeof baseMutator !== "function") {
                // @retree-throws
                throw new Error(
                    `Retree internal invariant failed: expected the base proxy to resolve the native array mutator '${String(
                        prop
                    )}' to its batching wrapper function, but it resolved to type '${typeof baseMutator}'. This is unexpected and likely a Retree bug. Please file a Retree issue with the array operation that triggered this.`
                );
            }
            // Same dependency-tracking treatment as any other function read,
            // and a wrapper cached on the base handler so the mutator's
            // identity is stable across reads and reproxy generations.
            return trackAccessIfNeeded(
                this.getReproxyAwareArrayMutator(prop, baseMutator)
            );
        }
        const evalTarget = rawNode ?? target;

        let value: any;
        if (evalTarget instanceof ReactiveNode) {
            // Mirror proxy.ts: track the active getter for keyless
            // `this.memo(...)` only on classes known to use it.
            value = readReactiveNodeProperty(evalTarget, prop, receiver);
        } else {
            value = Reflect.get(evalTarget, prop, receiver);
        }

        if (typeof value === "function") {
            if (FUNCTION_NAMES_BIND_TO_RAW.has(prop)) {
                return trackAccessIfNeeded(
                    this.getBoundFunction(prop, value, rawNode)
                );
            }
            const reproxy = getReproxyNode(object);
            return trackAccessIfNeeded(
                this.getBoundFunction(prop, value, reproxy)
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
    }

    public set(
        target: TCustomProxy<T>,
        prop: string | symbol,
        newValue: any,
        receiver: any
    ): boolean {
        if (target instanceof ReactiveNode) {
            if (
                prop === COLLECTED_KEYS_SYMBOL ||
                target[COLLECTED_KEYS_SYMBOL].has(prop)
            ) {
                return Reflect.set(target, prop, newValue, target);
            }
        }
        return Reflect.set(target, prop, newValue, receiver);
    }
}

function buildReproxy<T extends TreeNode = TreeNode>(
    object: TCustomProxy<T>,
    knownHandler?: ICustomProxyHandler<T>
): TCustomProxy<T> {
    const handler = knownHandler ?? getCustomProxyHandler(object);
    if (!handler) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: cannot build a reproxy for an unproxied node. This is unexpected and likely a Retree bug if it came from a public Retree API. Fix: make sure callers pass Retree-managed proxies from Retree.root(...) or tree children; otherwise file a Retree issue with the operation that triggered this."
        );
    }
    const proxyHandler = new ReproxyHandler<T>(object, handler);
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
