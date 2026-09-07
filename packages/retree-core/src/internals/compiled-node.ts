/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
    SELECT_GETTERS_SYMBOL,
} from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import {
    isDependencyTrackingActive,
    runMemoBody,
    trackDependencyPropertyAccess,
    trackDependencyPropertyWrite,
} from "./dependency-tracking.js";
import { isDevMode } from "./dev.js";
import {
    isKeylessMemoFrameRequestFor,
    popMemoGetter,
    pushMemoGetter,
} from "./memo.js";
import {
    BaseProxyHandler,
    FUNCTION_NAMES_BIND_TO_RAW,
    getLatestIgnoredValue,
    getLatestLinkedValue,
    writeField,
    writeLinked,
} from "./proxy.js";
import {
    proxiedChildrenKey,
    proxyHandlerSentinel,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";
import { latestIdentity, latestIdentityOfHandler } from "./reproxy.js";
import { bumpGlobalWriteVersion } from "./write-version.js";

/**
 * Runtime half of the Retree compiler. The compiler rewrites every
 * `ReactiveNode` subclass into a "managed class": a class whose prototype
 * carries one literal accessor per member, reading and writing the raw
 * instance through the node's handler. Instances of the managed class stand
 * in for the base proxy and for each per-change view, so member access on a
 * compiled node is a monomorphic accessor call instead of a Proxy trap.
 *
 * Emitted code references only the symbols and helpers exported here; the
 * accessor shapes are documented next to each helper.
 */

/** Own slot of a managed instance holding the raw node. */
export const R: unique symbol = Symbol("retree-compiled-raw");
/** Own slot of a managed instance holding the node's base handler. */
export const H: unique symbol = Symbol("retree-compiled-handler");
/** Prototype flag: `true` on view prototypes, `false` on base prototypes. */
export const V: unique symbol = Symbol("retree-compiled-view");
/** The handler's children cache record, keyed by field name. */
export const C: typeof proxiedChildrenKey = proxiedChildrenKey;
/** The proxy metadata sentinel; managed prototypes expose the handler on it. */
export const S: typeof proxyHandlerSentinel = proxyHandlerSentinel;

export enum CompiledFieldRole {
    Reactive,
    Ignore,
    Link,
}

export interface CompiledNodeSchema {
    fields: Record<string, CompiledFieldRole>;
    memos?: string[];
}

export interface ManagedNodeConstructor {
    new (
        raw: TreeNode,
        handler: BaseProxyHandler<TreeNode>
    ): TCustomProxy<TreeNode>;
    prototype: object;
}

export interface CompiledClassInfo {
    managed: ManagedNodeConstructor;
    view: ManagedNodeConstructor;
    /** Reactive fields in declaration order across the class chain, then any learned from the first instance. */
    reactiveFields: string[];
    /** Compiled memo getters across the class chain. */
    memos: readonly string[];
    /** Every own key an instance may carry: fields plus ReactiveNode's own. */
    knownKeys: Set<string>;
    roles: Map<string, CompiledFieldRole>;
    collectedSize: number;
    linkedSize: number;
    /** Set once a keyless `this.memo(fn)` call has been seen on the class. */
    keyless: boolean;
    /** Set once the first instance has been checked against (and folded into) the schema. */
    validated: boolean;
}

export interface CompiledMemoCell {
    value: unknown;
    version: number;
}

type ManagedNode = { [R]: TreeNode; [H]: BaseProxyHandler<TreeNode> };

const compiledPrototypes = new WeakMap<object, CompiledClassInfo>();
let reactiveNodeOwnKeys: readonly string[] | undefined;

/** Own keys every ReactiveNode instance carries; resolved lazily because ReactiveNode.ts imports this module. */
function getReactiveNodeOwnKeys(): readonly string[] {
    return (reactiveNodeOwnKeys ??= [
        "options",
        COLLECTED_KEYS_SYMBOL,
        LINKED_KEYS_SYMBOL,
        SELECT_GETTERS_SYMBOL,
    ]);
}

function isManagedNodeConstructor(
    value: unknown
): value is ManagedNodeConstructor {
    return typeof value === "function";
}

/**
 * Registers the managed class the compiler emitted for `ctor`. Called once
 * per compiled class at module evaluation, right after the class definition.
 * Base-class accessors are copied onto the managed prototype so a single
 * prototype serves the whole chain, and the prototype is re-parented under
 * `ctor.prototype` so `instanceof` and `super` keep working.
 */
export function defineCompiledNode(
    ctor: Function,
    schema: CompiledNodeSchema,
    managed: unknown
): void {
    if (!isManagedNodeConstructor(managed)) {
        throw new Error(
            `Retree compiler runtime: defineCompiledNode for ${
                ctor.name
            } received a managed class of type ${typeof managed}. This is expected when compiled output is edited by hand or two @retreejs/babel-plugin-compiler versions disagree. Fix: regenerate the build with matching @retreejs/babel-plugin-compiler and @retreejs/core versions.`
        );
    }
    const prototype = ctor.prototype;
    if (compiledPrototypes.has(prototype)) {
        throw new Error(
            `Retree compiler runtime: ${ctor.name} was defined twice. This is expected when the compiler runs on the same class in two build steps. Fix: apply @retreejs/babel-plugin-compiler once per file.`
        );
    }
    const managedPrototype = managed.prototype;
    const roles = new Map<string, CompiledFieldRole>();
    const reactiveFields: string[] = [];
    const memos: string[] = [];
    // Nearest base first: an accessor already on the managed prototype
    // wins, so the subclass overrides its bases and each base its own.
    const chain = collectChain(prototype);
    for (const base of chain) {
        const baseInfo = compiledPrototypes.get(base);
        if (baseInfo !== undefined) {
            copyAccessors(baseInfo.managed.prototype, managedPrototype);
            continue;
        }
        if (base === ReactiveNode.prototype) {
            defineReactiveNodeAccessors(managedPrototype);
            continue;
        }
        defineReflectedAccessors(base, managedPrototype);
    }
    for (let index = chain.length - 1; index >= 0; index--) {
        const baseInfo = compiledPrototypes.get(chain[index]);
        if (baseInfo === undefined) continue;
        for (const [key, role] of baseInfo.roles) roles.set(key, role);
        for (const memo of baseInfo.memos) {
            if (!memos.includes(memo)) memos.push(memo);
        }
    }
    for (const key of Object.keys(schema.fields)) {
        roles.set(key, schema.fields[key]);
    }
    for (const [key, role] of roles) {
        if (role === CompiledFieldRole.Reactive) reactiveFields.push(key);
    }
    for (const memo of schema.memos ?? []) {
        if (!memos.includes(memo)) memos.push(memo);
    }
    const knownKeys = new Set<string>(getReactiveNodeOwnKeys());
    let collectedSize = 3;
    let linkedSize = 0;
    for (const [key, role] of roles) {
        knownKeys.add(key);
        if (role === CompiledFieldRole.Ignore) collectedSize++;
        if (role === CompiledFieldRole.Link) linkedSize++;
    }
    Object.defineProperty(managedPrototype, "constructor", {
        configurable: true,
        writable: true,
        value: ctor,
    });
    Object.defineProperty(managedPrototype, V, { value: false });
    Object.defineProperty(managedPrototype, S, {
        get(this: ManagedNode) {
            return this[H];
        },
    });
    Object.defineProperty(managedPrototype, "[[Handler]]", {
        get(this: ManagedNode) {
            return this[H];
        },
    });
    Object.defineProperty(managedPrototype, "[[Target]]", {
        get(this: ManagedNode) {
            return this[R];
        },
    });
    Object.setPrototypeOf(managedPrototype, prototype);
    const view = class extends managed {};
    Object.defineProperty(view.prototype, V, { value: true });
    compiledPrototypes.set(prototype, {
        managed,
        view,
        reactiveFields,
        memos,
        knownKeys,
        roles,
        collectedSize,
        linkedSize,
        keyless: false,
        validated: false,
    });
}

/** Prototype chain from the nearest base up to (and including) ReactiveNode. */
function collectChain(prototype: object): object[] {
    const chain: object[] = [];
    let current: object | null = Object.getPrototypeOf(prototype);
    while (current !== null && current !== Object.prototype) {
        chain.push(current);
        if (current === ReactiveNode.prototype) break;
        current = Object.getPrototypeOf(current);
    }
    return chain;
}

function copyAccessors(source: object, target: object): void {
    for (const key of Reflect.ownKeys(source)) {
        if (key === "constructor" || key === V || key === S) continue;
        if (key === "[[Handler]]" || key === "[[Target]]") continue;
        if (Object.prototype.hasOwnProperty.call(target, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (descriptor === undefined) continue;
        Object.defineProperty(target, key, descriptor);
    }
}

function defineRawPassthrough(target: object, key: string): void {
    Object.defineProperty(target, key, {
        configurable: true,
        get(this: ManagedNode) {
            return Reflect.get(this[R], key);
        },
        set(this: ManagedNode, value: unknown) {
            Reflect.set(this[R], key, value);
        },
    });
}

/**
 * ReactiveNode's own members: its bookkeeping fields pass straight through,
 * `options` reads as an ignored field, and its methods bind like any method.
 */
function defineReactiveNodeAccessors(target: object): void {
    defineRawPassthrough(target, COLLECTED_KEYS_SYMBOL);
    defineRawPassthrough(target, LINKED_KEYS_SYMBOL);
    defineRawPassthrough(target, SELECT_GETTERS_SYMBOL);
    Object.defineProperty(target, "options", {
        configurable: true,
        get(this: ManagedNode) {
            return readIgnored(
                this[H],
                "options",
                Reflect.get(this[R], "options")
            );
        },
        set(this: ManagedNode, value: unknown) {
            writeIgnored(this[H], "options");
            Reflect.set(this[R], "options", value);
        },
    });
    defineReflectedAccessors(ReactiveNode.prototype, target);
}

/**
 * Members of a base class the compiler did not see (ReactiveNode itself or
 * a base from another package): getters run with the managed receiver and
 * methods bind through the handler, mirroring the proxy get trap.
 */
function defineReflectedAccessors(source: object, target: object): void {
    for (const key of Reflect.ownKeys(source)) {
        if (typeof key !== "string" || key === "constructor") continue;
        if (Object.prototype.hasOwnProperty.call(target, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (descriptor === undefined) continue;
        if (typeof descriptor.value === "function") {
            const method = descriptor.value;
            Object.defineProperty(target, key, {
                configurable: true,
                get(this: ManagedNode & { [V]: boolean }) {
                    if (this === undefined || this[R] === undefined) {
                        return method;
                    }
                    return readFunction(
                        this[H],
                        this,
                        key,
                        Reflect.get(this[R], key),
                        this[V]
                    );
                },
                set(this: ManagedNode, value: unknown) {
                    writeField(this[H], key, Reflect.get(this[R], key), value);
                },
            });
            continue;
        }
        const getter = descriptor.get;
        const setter = descriptor.set;
        if (getter === undefined && setter === undefined) continue;
        Object.defineProperty(target, key, {
            configurable: true,
            get:
                getter === undefined
                    ? undefined
                    : function (this: ManagedNode & { [V]: boolean }) {
                          const handler = this[H];
                          if (handler.keyless) {
                              return readGetterWithFrame(
                                  handler,
                                  this,
                                  key,
                                  this[V]
                              );
                          }
                          let value: unknown;
                          try {
                              value = getter.call(this);
                          } catch (error) {
                              return recoverGetterRead(
                                  handler,
                                  this,
                                  key,
                                  error,
                                  this[V]
                              );
                          }
                          return readGetterValue(
                              handler,
                              this,
                              key,
                              value,
                              this[V]
                          );
                      },
            set:
                setter === undefined
                    ? undefined
                    : function (this: ManagedNode, value: unknown) {
                          setter.call(this, value);
                      },
        });
    }
}

function warnCompiledFallback(node: ReactiveNode, reason: string): void {
    if (!isDevMode()) return;
    const name = node.constructor?.name ?? "ReactiveNode";
    console.warn(
        `Retree compiler: an instance of ${name} fell back to the proxy path because ${reason}. Reads and writes on it stay correct but skip the compiled fast path.`
    );
}

/**
 * Resolves the compiled class for a raw node about to be managed, or
 * `undefined` when the instance must take the proxy path. The first
 * instance of a class completes the schema: keys the compiler could not
 * see (fields of an uncompiled base, constructor-assigned properties) get
 * accessors on the managed prototype. Later instances must match it.
 */
export function resolveCompiledNode(
    node: ReactiveNode
): CompiledClassInfo | undefined {
    const info = compiledPrototypes.get(Object.getPrototypeOf(node));
    if (info === undefined) return undefined;
    if (!info.validated) return learnInstanceShape(node, info);
    const collected = node[COLLECTED_KEYS_SYMBOL];
    const linked = node[LINKED_KEYS_SYMBOL];
    if (collected.size !== info.collectedSize) {
        warnCompiledFallback(
            node,
            `its @ignore keys (${
                collected.size - 3
            }) differ from the compiled schema (${info.collectedSize - 3})`
        );
        return undefined;
    }
    if (linked.size !== info.linkedSize) {
        warnCompiledFallback(
            node,
            `its @link keys (${linked.size}) differ from the compiled schema (${info.linkedSize})`
        );
        return undefined;
    }
    const known = info.knownKeys;
    for (const key of Object.keys(node)) {
        if (!known.has(key)) {
            warnCompiledFallback(
                node,
                `it has an own property "${key}" the first instance of the class did not (assign it in the constructor unconditionally, or declare it as a class field)`
            );
            return undefined;
        }
    }
    return info;
}

function learnInstanceShape(
    node: ReactiveNode,
    info: CompiledClassInfo
): CompiledClassInfo | undefined {
    const collected = node[COLLECTED_KEYS_SYMBOL];
    const linked = node[LINKED_KEYS_SYMBOL];
    for (const key of collected) {
        if (typeof key !== "string") continue;
        if (getReactiveNodeOwnKeys().includes(key)) continue;
        const role = info.roles.get(key);
        if (role === undefined) {
            if (!learnField(node, info, key, CompiledFieldRole.Ignore)) {
                return undefined;
            }
            continue;
        }
        if (role !== CompiledFieldRole.Ignore) {
            warnCompiledFallback(
                node,
                `"${key}" is an @ignore key at runtime but the compiled schema saw it as a different role`
            );
            return undefined;
        }
    }
    for (const key of linked) {
        if (typeof key !== "string") continue;
        const role = info.roles.get(key);
        if (role === undefined) {
            if (!learnField(node, info, key, CompiledFieldRole.Link)) {
                return undefined;
            }
            continue;
        }
        if (role !== CompiledFieldRole.Link) {
            warnCompiledFallback(
                node,
                `"${key}" is a @link key at runtime but the compiled schema saw it as a different role`
            );
            return undefined;
        }
    }
    for (const key of Object.keys(node)) {
        if (info.knownKeys.has(key)) continue;
        if (!learnField(node, info, key, CompiledFieldRole.Reactive)) {
            return undefined;
        }
    }
    info.collectedSize = collected.size;
    info.linkedSize = linked.size;
    info.validated = true;
    return info;
}

/** Adds an accessor for a key the compiler did not see; false when the managed prototype already claims it. */
function learnField(
    node: ReactiveNode,
    info: CompiledClassInfo,
    key: string,
    role: CompiledFieldRole
): boolean {
    const managedPrototype = info.managed.prototype;
    if (Object.prototype.hasOwnProperty.call(managedPrototype, key)) {
        warnCompiledFallback(
            node,
            `its own property "${key}" shadows a prototype member the compiler emitted`
        );
        return false;
    }
    defineLearnedAccessor(managedPrototype, key, role);
    info.roles.set(key, role);
    info.knownKeys.add(key);
    if (role === CompiledFieldRole.Reactive) info.reactiveFields.push(key);
    return true;
}

/** Runtime twin of the field accessors the compiler emits (see the read section below). */
function defineLearnedAccessor(
    target: object,
    key: string,
    role: CompiledFieldRole
): void {
    if (role === CompiledFieldRole.Ignore) {
        Object.defineProperty(target, key, {
            configurable: true,
            get(this: ManagedNode) {
                return readIgnored(this[H], key, Reflect.get(this[R], key));
            },
            set(this: ManagedNode, value: unknown) {
                writeIgnored(this[H], key);
                Reflect.set(this[R], key, value);
            },
        });
        return;
    }
    if (role === CompiledFieldRole.Link) {
        Object.defineProperty(target, key, {
            configurable: true,
            get(this: ManagedNode) {
                return readLinked(this[H], key, Reflect.get(this[R], key));
            },
            set(this: ManagedNode, value: unknown) {
                writeLinked(this[H], key, value);
            },
        });
        return;
    }
    Object.defineProperty(target, key, {
        configurable: true,
        get(this: ManagedNode & { [V]: boolean }) {
            const handler = this[H];
            const value = Reflect.get(this[R], key);
            if (value === null || typeof value !== "object") {
                return typeof value === "function"
                    ? readFunction(handler, this, key, value, this[V])
                    : readPrimitive(handler, key, value);
            }
            const children = handler[C];
            return readObject(
                handler,
                key,
                value,
                children === null ? undefined : children[key],
                this[V]
            );
        },
        set(this: ManagedNode, value: unknown) {
            writeField(this[H], key, Reflect.get(this[R], key), value);
        },
    });
}

const warnedDynamicKeys = new WeakSet<object>();

/**
 * Builds the view for a compiled handler. In dev mode the first view of a
 * class flags own keys assigned to the base managed instance: without a
 * trap they never reach the raw node, so views and serialization miss them.
 */
export function createCompiledView(
    info: CompiledClassInfo,
    handler: BaseProxyHandler<TreeNode>
): TCustomProxy<TreeNode> {
    if (isDevMode()) warnDynamicKeys(info, handler.baseProxy);
    return new info.view(handler[unproxiedBaseNodeKey], handler);
}

function warnDynamicKeys(info: CompiledClassInfo, base: object): void {
    const prototype = info.managed.prototype;
    if (warnedDynamicKeys.has(prototype)) return;
    for (const key in base) {
        warnedDynamicKeys.add(prototype);
        console.warn(
            `Retree compiler: "${key}" was assigned to a compiled ${
                base.constructor?.name ?? "ReactiveNode"
            } instance but is not a declared field, so the raw node and later views never see it. Fix: declare it as a class field, or assign it on Retree.raw(node).`
        );
        return;
    }
}

export function isCompiledNodeInfo(
    value: CompiledClassInfo | null
): value is CompiledClassInfo {
    return value !== null;
}

/** Reactive fields of a compiled managed node, for walks that must not touch its slots. */
export function getCompiledReactiveFields(
    node: object
): readonly string[] | undefined {
    const handler = Reflect.get(node, S);
    if (!(handler instanceof BaseProxyHandler)) return undefined;
    const info = handler.compiled;
    if (info === null) return undefined;
    return info.reactiveFields;
}

export { writeField, writeLinked };

export function createCompiledChildren(
    info: CompiledClassInfo
): Record<string | symbol, BaseProxyHandler<TreeNode> | undefined> {
    const children: Record<string, BaseProxyHandler<TreeNode> | undefined> =
        Object.create(null);
    for (const key of info.reactiveFields) children[key] = undefined;
    return children;
}

export function createCompiledCells(
    info: CompiledClassInfo
): Record<string, CompiledMemoCell | undefined> | null {
    if (info.memos.length === 0) return null;
    const cells: Record<string, CompiledMemoCell | undefined> =
        Object.create(null);
    for (const key of info.memos) cells[key] = undefined;
    return cells;
}

// ------------------------------------------------------------------ reads
//
// Emitted reactive field accessor:
//   get a() {
//       const v = this[R].a;
//       if (v === null || typeof v !== "object")
//           return typeof v === "function"
//               ? readFunction(this[H], this, "a", v, this[V])
//               : readPrimitive(this[H], "a", v);
//       return readObject(this[H], "a", v, this[H][C].a, this[V]);
//   }

export function readPrimitive<T>(
    handler: BaseProxyHandler<TreeNode>,
    prop: string,
    value: T
): T {
    if (!isDependencyTrackingActive()) return value;
    return trackDependencyPropertyAccess(
        handler,
        handler.baseProxy,
        prop,
        value
    );
}

export function readObject(
    handler: BaseProxyHandler<TreeNode>,
    prop: string,
    value: object,
    child: BaseProxyHandler<TreeNode> | undefined,
    isView: boolean
): object {
    let resolved: object;
    if (child !== undefined) {
        resolved = isView ? latestIdentityOfHandler(child) : child.baseProxy;
    } else {
        resolved = handler.resolveStoredObject(
            handler[unproxiedBaseNodeKey],
            prop,
            value
        );
        if (isView) resolved = latestIdentity(resolved);
    }
    return readPrimitive(handler, prop, resolved);
}

export function readFunction<TFunction extends Function>(
    handler: BaseProxyHandler<TreeNode>,
    self: object,
    prop: string,
    fn: TFunction,
    isView: boolean
): TFunction {
    if (FUNCTION_NAMES_BIND_TO_RAW.has(prop)) {
        return handler.getBoundFunction(
            prop,
            fn,
            handler[unproxiedBaseNodeKey]
        );
    }
    if (!isView) return handler.getBoundFunction(prop, fn, handler.baseProxy);
    // Bound to the view current at read time, like reproxy reads; the cache
    // entry is reused until the view or the source function changes.
    const cache = (handler.viewBoundFunctions ??= new Map());
    const target = latestIdentityOfHandler(handler);
    const cached = cache.get(prop);
    if (
        cached !== undefined &&
        cached.source === fn &&
        cached.target === target
    ) {
        return cached.bound as TFunction;
    }
    const bound = fn.bind(target) as TFunction;
    cache.set(prop, { source: fn, bound, target });
    return bound;
}

// Emitted @ignore / @link field accessors:
//   get cache() { return readIgnored(this[H], "cache", this[R].cache); }
//   set cache(v) { writeIgnored(this[H], "cache"); this[R].cache = v; }
//   get other() { return readLinked(this[H], "other", this[R].other); }
//   set other(v) { writeLinked(this[H], "other", v); }

export function readIgnored(
    handler: BaseProxyHandler<TreeNode>,
    prop: string,
    value: unknown
): unknown {
    return readPrimitive(handler, prop, getLatestIgnoredValue(value));
}

export function readLinked(
    handler: BaseProxyHandler<TreeNode>,
    prop: string,
    value: unknown
): unknown {
    return readPrimitive(handler, prop, getLatestLinkedValue(value));
}

// Emitted prototype getter accessor (methods use readFunction with
// `this[R].name`; setters forward with `super.name = v`):
//   get total() {
//       const h = this[H];
//       if (h.keyless) return readGetterWithFrame(h, this, "total", this[V]);
//       let v;
//       try { v = super.total; }
//       catch (e) { return recoverGetterRead(h, this, "total", e, this[V]); }
//       return readGetterValue(h, this, "total", v, this[V]);
//   }

export function readGetterValue(
    handler: BaseProxyHandler<TreeNode>,
    self: object,
    prop: string,
    value: unknown,
    isView: boolean
): unknown {
    if (typeof value === "function") {
        return readFunction(handler, self, prop, value, isView);
    }
    if (isView && value !== null && typeof value === "object") {
        return readPrimitive(handler, prop, latestIdentity(value));
    }
    return readPrimitive(handler, prop, value);
}

export function readGetterWithFrame(
    handler: BaseProxyHandler<TreeNode>,
    self: object,
    prop: string,
    isView: boolean
): unknown {
    const raw = handler[unproxiedBaseNodeKey];
    if (!(raw instanceof ReactiveNode)) {
        throw new Error(
            "Retree internal invariant failed: a compiled getter frame was requested for a node that is not a ReactiveNode. This is unexpected and likely a Retree bug. Please file a Retree issue with the getter that triggered this."
        );
    }
    pushMemoGetter(raw, prop);
    let value: unknown;
    try {
        value = Reflect.get(raw, prop, self);
    } finally {
        popMemoGetter(raw);
    }
    return readGetterValue(handler, self, prop, value, isView);
}

export function recoverGetterRead(
    handler: BaseProxyHandler<TreeNode>,
    self: object,
    prop: string,
    error: unknown,
    isView: boolean
): unknown {
    const raw = handler[unproxiedBaseNodeKey];
    if (!(raw instanceof ReactiveNode)) throw error;
    if (!isKeylessMemoFrameRequestFor(error, raw)) throw error;
    handler.keyless = true;
    const info = handler.compiled;
    if (info !== null) info.keyless = true;
    return readGetterWithFrame(handler, self, prop, isView);
}

// ------------------------------------------------------------------ writes
//
// Emitted reactive field setter:
//   set a(v) { writeField(this[H], "a", this[R].a, v); }
// The heavy lifting lives in proxy.ts next to the set trap it mirrors.

export function writeIgnored(
    handler: BaseProxyHandler<TreeNode>,
    prop: string
): void {
    if (isDependencyTrackingActive()) {
        trackDependencyPropertyWrite(handler.baseProxy, prop);
    }
    bumpGlobalWriteVersion(handler[unproxiedBaseNodeKey]);
}

// ------------------------------------------------------------------ memo
//
// Emitted accessor for `@memo((s) => [s.a, s.list]) get expensive()` whose
// body the compiler hoisted to `expensive$retreeMemo()`:
//   get expensive() {
//       const h = this[H], c = h.cells.expensive, k0 = this.a, k1 = this.list;
//       if (c !== undefined) {
//           if (c.version === currentWriteVersion()) return readGetterValue(...c.value);
//           if (sameKey(c.k0, k0) && sameKey(c.k1, k1)) {
//               c.version = currentWriteVersion();
//               return readGetterValue(h, this, "expensive", c.value, this[V]);
//           }
//       }
//       const value = runCompiledMemoBody(this, this[R].expensive$retreeMemo);
//       h.cells.expensive = { value, version: currentWriteVersion(), k0: normalizeKey(k0), k1: normalizeKey(k1) };
//       return readGetterValue(h, this, "expensive", value, this[V]);
//   }

export { getGlobalWriteVersion as currentWriteVersion } from "./write-version.js";

/** Key cells compare by latest managed identity, like runtime memo keys. */
export function normalizeKey<T>(value: T): T {
    if (value === null || typeof value !== "object") return value;
    return latestIdentity(value);
}

/**
 * A stored key matches when the next read resolves to the same latest
 * identity. A base proxy read is normalized every time: it is the same
 * object before and after a change, so identity alone cannot answer.
 */
export function sameKey(previous: unknown, next: unknown): boolean {
    if (next === null || typeof next !== "object") {
        return Object.is(previous, next);
    }
    return latestIdentity(next) === previous;
}

export function runCompiledMemoBody<T>(self: object, body: () => T): T {
    return runMemoBody(() => body.call(self));
}
