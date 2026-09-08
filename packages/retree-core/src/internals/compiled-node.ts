/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    COLLECTED_KEYS_SYMBOL,
    IRetreeNodeOptions,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
    SELECT_GETTERS_SYMBOL,
} from "../ReactiveNode.js";
import { TreeNode } from "../types.js";
import { trackPropertyAccessIfNeeded } from "./dependency-tracking.js";
import { isDevMode } from "./dev.js";
import {
    isKeylessMemoFrameRequestFor,
    popMemoGetter,
    pushMemoGetter,
} from "./memo.js";
import {
    BaseProxyHandler,
    FUNCTION_NAMES_BIND_TO_RAW,
    getCachedBoundFunction,
    getLatestIgnoredValue,
    getLatestLinkedValue,
} from "./proxy.js";
import {
    IProxyParent,
    proxiedChildrenKey,
    proxyHandlerSentinel,
    TCustomProxy,
    unproxiedBaseNodeKey,
} from "./proxy-types.js";
import { latestIdentity, latestIdentityOfHandler } from "./reproxy.js";
import { TreeChangeEmitter } from "./NodeChangeEmitter.js";
import { registerHandlerFactory } from "./handler-factories.js";

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
}

export interface ManagedNodeConstructor {
    new (raw: TreeNode, handler: CompiledProxyHandler): TCustomProxy<TreeNode>;
    prototype: object;
}

export interface CompiledClassInfo {
    managed: ManagedNodeConstructor;
    view: ManagedNodeConstructor;
    /** Reactive fields in declaration order across the class chain, then any learned from the first instance. */
    reactiveFields: string[];
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

export class CompiledProxyHandler extends BaseProxyHandler<TreeNode> {
    public keyless: boolean;
    public viewBoundFunctions: Map<
        string | symbol,
        { source: Function; bound: Function }
    > | null = null;

    constructor(
        node: TreeNode,
        emitter: TreeChangeEmitter,
        parent: IProxyParent | null,
        public readonly compiled: CompiledClassInfo
    ) {
        super(node, emitter, parent, compiled.reactiveFields);
        this.keyless = compiled.keyless;
    }

    public override get reactiveFields(): readonly string[] {
        return this.compiled.reactiveFields;
    }

    public override createBaseProxy(): TCustomProxy<TreeNode> {
        return new this.compiled.managed(this[unproxiedBaseNodeKey], this);
    }

    public override createView(): TCustomProxy<TreeNode> {
        if (isDevMode()) warnDynamicKeys(this.compiled, this.baseProxy);
        this.viewBoundFunctions = null;
        return new this.compiled.view(this[unproxiedBaseNodeKey], this);
    }

    public override clearChild(prop: string | symbol): void {
        const children = this[proxiedChildrenKey];
        if (children !== null) children[prop] = undefined;
    }

    public override assertWritableKey(
        key: string | symbol,
        apiName: string
    ): void {
        if (typeof key === "string" && this.compiled.knownKeys.has(key)) return;
        if (key in this.baseProxy) return;
        throw new Error(
            `${apiName}: the destination is a compiled ${
                this.baseProxy.constructor.name
            } and has no field "${String(
                key
            )}". Declare the field on the class so the compiler emits it, or move into a plain object.`
        );
    }
}

type ManagedNode = { [R]: TreeNode; [H]: CompiledProxyHandler };

const compiledPrototypes = new WeakMap<object, CompiledClassInfo>();
let reactiveNodeOwnKeys: readonly string[] | undefined;
/** Collected keys the ReactiveNode constructor adds: "options" and the two bookkeeping symbols. */
const REACTIVE_NODE_COLLECTED_KEYS = 3;

/** Own keys every ReactiveNode instance carries. */
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
    }
    for (const key of Object.keys(schema.fields)) {
        roles.set(key, schema.fields[key]);
    }
    for (const [key, role] of roles) {
        if (role === CompiledFieldRole.Reactive) reactiveFields.push(key);
    }
    const knownKeys = new Set<string>(getReactiveNodeOwnKeys());
    let collectedSize = REACTIVE_NODE_COLLECTED_KEYS;
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
    if (!("toJSON" in prototype)) {
        Object.defineProperty(managedPrototype, "toJSON", {
            configurable: true,
            writable: true,
            value: toJSON,
        });
    }
    Object.setPrototypeOf(managedPrototype, prototype);
    const view = class extends managed {};
    Object.defineProperty(view.prototype, V, { value: true });
    compiledPrototypes.set(prototype, {
        managed,
        view,
        reactiveFields,
        knownKeys,
        roles,
        collectedSize,
        linkedSize,
        keyless: false,
        validated: false,
    });
    registerHandlerFactory(prototype, (node, emitter, parent) => {
        if (!(node instanceof ReactiveNode)) return undefined;
        const info = resolveCompiledNode(node);
        return info === undefined
            ? undefined
            : new CompiledProxyHandler(node, emitter, parent, info);
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

/**
 * ReactiveNode's own members as literal accessors. Each member gets its own
 * code so its read site stays monomorphic; one closure shared across keys
 * would serve every member from a single keyed-load site.
 */
class ReactiveNodeAccessors {
    declare [R]: ReactiveNode;
    declare [H]: CompiledProxyHandler;
    declare [V]: boolean;

    get options(): IRetreeNodeOptions {
        const options = this[R].options;
        readIgnored(this[H], "options", options);
        return options;
    }
    set options(value: IRetreeNodeOptions) {
        writeField(this[H], "options", value);
    }
    get dependencies() {
        return readPrototypeGetter(this, "dependencies", dependenciesGetter);
    }
    get moveTo() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.moveTo;
        }
        return readFunction(this[H], this, "moveTo", this[R].moveTo, this[V]);
    }
    set moveTo(value: unknown) {
        writeField(this[H], "moveTo", value);
    }
    get link() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.link;
        }
        return readFunction(this[H], this, "link", this[R].link, this[V]);
    }
    set link(value: unknown) {
        writeField(this[H], "link", value);
    }
    get raw() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.raw;
        }
        return readFunction(this[H], this, "raw", this[R].raw, this[V]);
    }
    set raw(value: unknown) {
        writeField(this[H], "raw", value);
    }
    get untracked() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.untracked;
        }
        return readFunction(
            this[H],
            this,
            "untracked",
            this[R].untracked,
            this[V]
        );
    }
    set untracked(value: unknown) {
        writeField(this[H], "untracked", value);
    }
    get peekInto() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.peekInto;
        }
        return readFunction(
            this[H],
            this,
            "peekInto",
            this[R].peekInto,
            this[V]
        );
    }
    set peekInto(value: unknown) {
        writeField(this[H], "peekInto", value);
    }
    get onObserved() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype["onObserved"];
        }
        return readFunction(
            this[H],
            this,
            "onObserved",
            this[R]["onObserved"],
            this[V]
        );
    }
    set onObserved(value: unknown) {
        writeField(this[H], "onObserved", value);
    }
    get onUnobserved() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype["onUnobserved"];
        }
        return readFunction(
            this[H],
            this,
            "onUnobserved",
            this[R]["onUnobserved"],
            this[V]
        );
    }
    set onUnobserved(value: unknown) {
        writeField(this[H], "onUnobserved", value);
    }
    get onChanged() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype["onChanged"];
        }
        return readFunction(
            this[H],
            this,
            "onChanged",
            this[R]["onChanged"],
            this[V]
        );
    }
    set onChanged(value: unknown) {
        writeField(this[H], "onChanged", value);
    }
    get dependency() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.dependency;
        }
        return readFunction(
            this[H],
            this,
            "dependency",
            this[R].dependency,
            this[V]
        );
    }
    set dependency(value: unknown) {
        writeField(this[H], "dependency", value);
    }
    get prepareTree() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype.prepareTree;
        }
        return readFunction(
            this[H],
            this,
            "prepareTree",
            this[R].prepareTree,
            this[V]
        );
    }
    set prepareTree(value: unknown) {
        writeField(this[H], "prepareTree", value);
    }
    get memo() {
        if (this === undefined || this[R] === undefined) {
            return ReactiveNode.prototype["memo"];
        }
        return readFunction(this[H], this, "memo", this[R]["memo"], this[V]);
    }
    set memo(value: unknown) {
        writeField(this[H], "memo", value);
    }
}

// Shared by the literal accessor for ReactiveNode.dependencies.
let dependenciesGetter: (() => unknown) | undefined;

function defineReactiveNodeAccessors(target: object): void {
    dependenciesGetter ??= Object.getOwnPropertyDescriptor(
        ReactiveNode.prototype,
        "dependencies"
    )?.get;
    copyAccessors(ReactiveNodeAccessors.prototype, target);
    // Bookkeeping keys pass through to the raw node.
    for (const key of [
        COLLECTED_KEYS_SYMBOL,
        LINKED_KEYS_SYMBOL,
        SELECT_GETTERS_SYMBOL,
    ]) {
        Object.defineProperty(target, key, {
            configurable: true,
            get(this: ManagedNode) {
                return Reflect.get(this[R], key);
            },
        });
    }
    // Any member added to ReactiveNode after this class was written still
    // resolves through the reflected path rather than the raw prototype.
    defineReflectedAccessors(ReactiveNode.prototype, target);
}

/** Prototype getter read with the managed receiver; mirrors the emitted getter accessor. */
function readPrototypeGetter(
    self: ManagedNode & { [V]: boolean },
    key: string,
    getter: (() => unknown) | undefined
): unknown {
    const handler = self[H];
    if (handler.keyless) {
        return readGetterWithFrame(handler, self, key, self[V]);
    }
    let value: unknown;
    try {
        value = getter === undefined ? undefined : getter.call(self);
    } catch (error) {
        return recoverGetterRead(handler, self, key, error, self[V]);
    }
    return readGetterValue(handler, self, key, value, self[V]);
}

/** Default `toJSON` for compiled classes: a plain snapshot read through the accessors. */
function toJSON(this: ManagedNode): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of this[H].compiled.knownKeys) {
        out[key] = Reflect.get(this, key);
    }
    return out;
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
                    writeField(this[H], key, value);
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
                          return readPrototypeGetter(this, key, getter);
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
    if (Object.getOwnPropertySymbols(node).length > 0) {
        warnCompiledFallback(node, "it has symbol-keyed own properties");
        return undefined;
    }
    if (!info.validated) return learnInstanceShape(node, info);
    const collected = node[COLLECTED_KEYS_SYMBOL];
    const linked = node[LINKED_KEYS_SYMBOL];
    if (collected.size !== info.collectedSize) {
        warnCompiledFallback(
            node,
            `its @ignore keys (${
                collected.size - REACTIVE_NODE_COLLECTED_KEYS
            }) differ from the compiled schema (${
                info.collectedSize - REACTIVE_NODE_COLLECTED_KEYS
            })`
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
                writeField(this[H], key, value);
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
                writeField(this[H], key, value);
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
            writeField(this[H], key, value);
        },
    });
}

const warnedDynamicKeys = new WeakSet<object>();

function warnDynamicKeys(info: CompiledClassInfo, base: object): void {
    const prototype = info.managed.prototype;
    if (warnedDynamicKeys.has(prototype)) return;
    for (const key of Object.keys(base)) {
        warnedDynamicKeys.add(prototype);
        console.warn(
            `Retree compiler: "${key}" was assigned to a compiled ${
                base.constructor?.name ?? "ReactiveNode"
            } instance but is not a declared field, so the raw node and later views never see it. Fix: declare it as a class field, or assign it on Retree.raw(node).`
        );
        return;
    }
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
    handler: CompiledProxyHandler,
    prop: string,
    value: T
): T {
    return trackPropertyAccessIfNeeded(handler, handler.baseProxy, prop, value);
}

export function readObject(
    handler: CompiledProxyHandler,
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
    handler: CompiledProxyHandler,
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
    // Resolving a new view resets its cache before binding, just like ReproxyHandler.
    const target = latestIdentityOfHandler(handler);
    return getCachedBoundFunction(
        (handler.viewBoundFunctions ??= new Map()),
        prop,
        fn,
        target
    );
}

/**
 * What a reactive field accessor returns to a receiver-less read (a test spy
 * reading the prototype descriptor): a function that resolves the field on
 * whichever instance it is later called on.
 */
export function fieldTrampoline(key: string): Function {
    return function (this: ManagedNode, ...args: unknown[]) {
        const value: unknown = Reflect.get(this[R], key);
        if (typeof value !== "function") {
            throw new Error(
                `Retree compiler: "${key}" was read without an instance and later called, but it is not a function on the instance it was called on.`
            );
        }
        return value.apply(this, args);
    };
}

// Emitted @ignore / @link field accessors:
//   get cache() { return readIgnored(this[H], "cache", this[R].cache); }
//   set cache(v) { writeField(this[H], "cache", v); }
//   get other() { return readLinked(this[H], "other", this[R].other); }
//   set other(v) { writeField(this[H], "other", v); }

export function readIgnored(
    handler: CompiledProxyHandler,
    prop: string,
    value: unknown
): unknown {
    return readPrimitive(handler, prop, getLatestIgnoredValue(value));
}

export function readLinked(
    handler: CompiledProxyHandler,
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
    handler: CompiledProxyHandler,
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
    handler: CompiledProxyHandler,
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
    handler: CompiledProxyHandler,
    self: object,
    prop: string,
    error: unknown,
    isView: boolean
): unknown {
    const raw = handler[unproxiedBaseNodeKey];
    if (!(raw instanceof ReactiveNode)) throw error;
    if (!isKeylessMemoFrameRequestFor(error, raw)) throw error;
    handler.keyless = true;
    handler.compiled.keyless = true;
    return readGetterWithFrame(handler, self, prop, isView);
}

// ------------------------------------------------------------------ writes
//
// Emitted reactive field setter:
//   set a(v) { writeField(this[H], "a", v); }
// Proxies and compiled accessors both call BaseProxyHandler.set.

export function writeField(
    handler: CompiledProxyHandler,
    prop: string,
    value: unknown
): void {
    const raw = handler[unproxiedBaseNodeKey];
    if (!handler.set(raw, prop, value, raw)) {
        throw new TypeError(`Retree: could not assign property "${prop}".`);
    }
}
