/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { COLLECTED_KEYS_SYMBOL, LINKED_KEYS_SYMBOL } from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import {
    BaseProxyHandler,
    NodeKind,
    getCustomProxyHandler,
    FUNCTION_NAMES_BIND_TO_RAW,
    getCachedBoundFunction,
    getLatestIgnoredValue,
    getLatestLinkedValue,
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
    getCustomProxyHandlerFromMetadata,
    proxiedChildrenKey,
    unproxiedBaseNodeKey,
    proxiedParentKey,
    proxyHandlerSentinel,
    TCustomProxy,
    TProxiedChildren,
} from "./proxy-types.js";
import { advanceSnapshotVersions } from "./snapshot-version.js";
import { bumpGlobalWriteVersion } from "./write-version.js";

/**
 * Raw node to its base handler. The handler carries the node's view state
 * (`view`, `viewDirty`), so this is the only per-node registry.
 */
const managedHandlers = new WeakMap<TreeNode, BaseProxyHandler<TreeNode>>();

function currentView<T extends TreeNode>(
    handler: BaseProxyHandler<T>
): TCustomProxy<T> | null {
    if (handler.viewDirty) {
        handler.view = buildReproxy(handler);
        handler.viewDirty = false;
    }
    return handler.view;
}

/**
 * The base handler behind any Retree proxy handler. Base proxies answer with
 * their own handler; views answer with a {@link ReproxyHandler}, whose raw
 * node resolves the base handler through the registry.
 */
export function resolveBaseHandler<T extends TreeNode>(
    handler: ICustomProxyHandler<T>
): BaseProxyHandler<T> {
    if (handler instanceof BaseProxyHandler) {
        return handler;
    }
    const base = managedHandlers.get(handler[unproxiedBaseNodeKey]);
    if (base === undefined) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: a Retree proxy has no registered base handler. This is unexpected and likely a Retree bug. Please file a Retree issue with the operation that triggered this."
        );
    }
    return base as BaseProxyHandler<T>;
}

/**
 * The latest identity of a value read off a raw node: the current view of a
 * managed node, or the value itself when it is not managed.
 */
function latestIdentity<T>(value: T): T {
    const handler = getCustomProxyHandlerFromMetadata(value);
    if (handler === undefined) {
        return value;
    }
    return (currentView(resolveBaseHandler(handler)) ?? value) as T;
}

/** A node's latest identity from its handler: its view, or its base proxy before the first change. */
export function latestIdentityOfHandler<T extends TreeNode>(
    handler: ICustomProxyHandler<T>
): TCustomProxy<T> {
    return currentView(resolveBaseHandler(handler)) ?? handler.baseProxy;
}

/** The base handler behind a base proxy or a view. */
export function getBaseHandlerOfProxy(
    proxy: object
): BaseProxyHandler<TreeNode> {
    const handler = getCustomProxyHandlerFromMetadata(proxy);
    if (handler === undefined) {
        // @retree-throws
        throw new Error(
            "Retree internal invariant failed: expected a Retree proxy but the value has no proxy metadata. This is unexpected and likely a Retree bug. Please file a Retree issue with the operation that triggered this."
        );
    }
    return resolveBaseHandler(handler);
}

function trackAccessIfNeeded<T>(value: T): T {
    if (!isDependencyTrackingActive()) {
        return value;
    }
    return trackDependencyAccess(value);
}

function trackPropertyAccessIfNeeded<T>(
    ownerHandler: ICustomProxyHandler<TreeNode>,
    owner: TCustomProxy<TreeNode>,
    propertyKey: string | symbol,
    value: T
): T {
    if (!isDependencyTrackingActive()) {
        return value;
    }
    return trackDependencyPropertyAccess(
        ownerHandler,
        owner,
        propertyKey,
        value
    );
}

export function registerBaseProxy<T extends TreeNode = TreeNode>(
    unproxiedNode: T,
    handler: BaseProxyHandler<T>
): void {
    managedHandlers.set(unproxiedNode, handler);
}

/** Base handler of a managed raw node, without a proxy trap. */
export function getBaseHandlerForUnproxiedNode(
    unproxiedNode: TreeNode
): BaseProxyHandler<TreeNode> | undefined {
    return managedHandlers.get(unproxiedNode);
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
    const base = resolveBaseHandler(handler);
    const view = buildReproxy(base);
    base.view = view;
    base.viewDirty = false;
    bumpGlobalWriteVersion(base[unproxiedBaseNodeKey]);
    return view;
}

/**
 * Invalidate an ancestor identity without allocating a view until it is
 * read. Keyed by raw node so ancestor walks that already hold handler
 * metadata skip the sentinel trap a proxy lookup would pay.
 */
export function invalidateReproxyNodeForUnproxiedNode(raw: TreeNode): void {
    const base = managedHandlers.get(raw);
    if (base === undefined)
        throw new Error(
            "invalidateReproxyNodeForUnproxiedNode: missing managed node record."
        );
    base.viewDirty = true;
    bumpGlobalWriteVersion(raw);
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
    // If we haven't reproxied, we return the original TreeNode
    return (currentView(resolveBaseHandler(handler)) ?? node) as T;
}

export function getReproxyNodeForUnproxiedNode<T extends TreeNode = TreeNode>(
    unproxiedNode: T
): TCustomProxy<T> | undefined {
    const base = managedHandlers.get(unproxiedNode);
    if (base === undefined) return undefined;
    return (currentView(base) ?? undefined) as TCustomProxy<T> | undefined;
}

export function getManagedProxyForUnproxiedNode<T extends TreeNode = TreeNode>(
    unproxiedNode: T
): TCustomProxy<T> | undefined {
    const base = managedHandlers.get(unproxiedNode);
    if (base === undefined) return undefined;
    return (currentView(base) ?? base.baseProxy) as TCustomProxy<T>;
}

/**
 * @internal
 * Proxy handler for a reproxy: a fresh identity over the same raw node.
 *
 * @remarks
 * A view shares its raw target with the base proxy, so every trap runs once:
 * reads resolve against the raw node here and child identities come back as
 * their latest views; writes, presence, keys, and deletes call the base
 * handler's traps directly with the same target. A reproxy is built on every
 * observable mutation, so this is a write-path allocation. Trap methods live
 * on the prototype and per-reproxy state lives in fields, mirroring the base
 * handler class in proxy.ts.
 */
class ReproxyHandler<T extends TreeNode>
    implements ProxyHandler<T>, ICustomProxyHandler<T>
{
    public [unproxiedBaseNodeKey]: T;
    /** The base proxy this reproxy is a view of. */
    public readonly baseProxy: TCustomProxy<T>;
    private readonly baseHandler: BaseProxyHandler<T>;
    private boundFunctionCache: Map<
        string | symbol,
        { source: Function; bound: Function }
    > | null = null;

    constructor(baseHandler: BaseProxyHandler<T>) {
        this[unproxiedBaseNodeKey] = baseHandler[unproxiedBaseNodeKey];
        this.baseProxy = baseHandler.baseProxy;
        this.baseHandler = baseHandler;
    }

    public get [proxiedParentKey](): IProxyParent | null {
        return this.baseHandler[proxiedParentKey];
    }
    public set [proxiedParentKey](parent: IProxyParent | null) {
        this.baseHandler[proxiedParentKey] = parent;
    }

    /**
     * The children cache belongs to the base handler and is allocated lazily,
     * so delegate instead of copying a reference at construction time.
     */
    public get [proxiedChildrenKey](): TProxiedChildren | null {
        return this.baseHandler[proxiedChildrenKey];
    }

    public set [proxiedChildrenKey](value: TProxiedChildren | null) {
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
        const cache = (this.baseHandler.ensureCaches().reproxyArrayMutators ??=
            new Map());
        const cached = cache.get(prop);
        if (cached !== undefined) {
            return cached;
        }
        const object = this.baseProxy;
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

    public get(target: T, prop: string | symbol, receiver: any): any {
        if (prop === proxyHandlerSentinel) {
            return this;
        }
        if (prop === "[[Handler]]") {
            return this;
        }
        if (prop === "[[Target]]") {
            return target;
        }
        const base = this.baseHandler;
        const baseProxy = base.baseProxy;
        const reactiveObject = base.reactiveObject;
        if (reactiveObject !== undefined) {
            if (typeof prop === "string") {
                if (prop.startsWith("RETREE_")) {
                    return Reflect.get(target, prop, target);
                }
                if (reactiveObject[COLLECTED_KEYS_SYMBOL].has(prop)) {
                    return trackPropertyAccessIfNeeded(
                        base,
                        baseProxy,
                        prop,
                        getLatestIgnoredValue(Reflect.get(target, prop, target))
                    );
                }
            }
            if (reactiveObject[LINKED_KEYS_SYMBOL].has(prop)) {
                return trackPropertyAccessIfNeeded(
                    base,
                    baseProxy,
                    prop,
                    getLatestLinkedValue(Reflect.get(target, prop, target))
                );
            }
        }
        // The children cache has a null prototype, so prototype members like
        // "constructor" can never appear as phantom cache hits here.
        const children = base[proxiedChildrenKey];
        if (children !== null && typeof prop === "string") {
            const child = children[prop];
            if (child !== undefined) {
                return trackPropertyAccessIfNeeded(
                    base,
                    baseProxy,
                    prop,
                    latestIdentityOfHandler(child)
                );
            }
        }
        // Map/Set/Date methods need the raw target as `this`, and native
        // array mutators must run as one batched write; the base trap owns
        // both wrappers, so ask it directly instead of dispatching through
        // the base proxy.
        const kind = base.kind;
        if (kind >= NodeKind.Map) {
            return base.get(target, prop, baseProxy);
        }
        if (
            kind === NodeKind.Array &&
            isNativeArrayMutatorAccess(target, prop)
        ) {
            const baseMutator: unknown = base.get(target, prop, baseProxy);
            if (typeof baseMutator !== "function") {
                // @retree-throws
                throw new Error(
                    `Retree internal invariant failed: expected the base proxy to resolve the native array mutator '${String(
                        prop
                    )}' to its batching wrapper function, but it resolved to type '${typeof baseMutator}'. This is unexpected and likely a Retree bug. Please file a Retree issue with the array operation that triggered this.`
                );
            }
            return this.getReproxyAwareArrayMutator(prop, baseMutator);
        }
        let value: any;
        if (reactiveObject !== undefined) {
            // Mirror proxy.ts: track the active getter for keyless
            // `this.memo(...)` only on classes known to use it.
            value = readReactiveNodeProperty(reactiveObject, prop, receiver);
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
                this.getBoundFunction(
                    prop,
                    value,
                    currentView(base) ?? baseProxy
                )
            );
        }
        if (
            value !== null &&
            typeof value === "object" &&
            prop !== "constructor"
        ) {
            return trackPropertyAccessIfNeeded(
                base,
                baseProxy,
                prop,
                latestIdentity(base.resolveStoredObject(target, prop, value))
            );
        }
        return trackPropertyAccessIfNeeded(base, baseProxy, prop, value);
    }

    public set(
        target: T,
        prop: string | symbol,
        newValue: any,
        receiver: any
    ): boolean {
        return this.baseHandler.set(target, prop, newValue, receiver);
    }

    public defineProperty(
        target: T,
        prop: string | symbol,
        descriptor: PropertyDescriptor
    ): boolean {
        return this.baseHandler.defineProperty(target, prop, descriptor);
    }

    public has(target: T, prop: string | symbol): boolean {
        return this.baseHandler.has(target, prop);
    }

    public ownKeys(target: T): ArrayLike<string | symbol> {
        return this.baseHandler.ownKeys(target);
    }

    public deleteProperty(target: T, prop: string | symbol): boolean {
        return this.baseHandler.deleteProperty(target, prop);
    }
}

function buildReproxy<T extends TreeNode>(
    handler: BaseProxyHandler<T>
): TCustomProxy<T> {
    return new Proxy(
        handler[unproxiedBaseNodeKey],
        new ReproxyHandler<T>(handler)
    ) as TCustomProxy<T>;
}
