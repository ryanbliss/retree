/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Built-ins whose state lives in internal slots or private fields. Their
 * methods and accessors brand-check `this`, so a proxy receiver throws
 * ("Illegal invocation"). Map, Set, and Date have the same constraint but
 * are proxied with dedicated method wrappers instead.
 */
const OPAQUE_CONSTRUCTOR_NAMES = [
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "RegExp",
    "Promise",
    "WeakMap",
    "WeakSet",
    "WeakRef",
    "DOMException",
    "URL",
    "URLSearchParams",
    "Blob",
    "EventTarget",
    "AbortController",
    "Headers",
    "Request",
    "Response",
    "FormData",
] as const;

const opaquePrototypes = collectOpaquePrototypes();
const opaqueByPrototype = new WeakMap<object, boolean>();

function collectOpaquePrototypes(): ReadonlySet<object> {
    // %TypedArray%.prototype covers every typed array.
    const prototypes = new Set<object>([
        Object.getPrototypeOf(Uint8Array.prototype),
    ]);
    for (const name of OPAQUE_CONSTRUCTOR_NAMES) {
        const ctor: unknown = Reflect.get(globalThis, name);
        if (typeof ctor !== "function") continue;
        const prototype: unknown = Reflect.get(ctor, "prototype");
        if (typeof prototype === "object" && prototype !== null) {
            prototypes.add(prototype);
        }
    }
    return prototypes;
}

function inheritsOpaquePrototype(prototype: object): boolean {
    for (
        let current: object | null = prototype;
        current !== null;
        current = Object.getPrototypeOf(current)
    ) {
        if (opaquePrototypes.has(current)) return true;
    }
    return false;
}

/**
 * Whether `value` is a built-in that cannot work behind a proxy, such as a
 * `DOMException`, `URL`, `Blob`, `RegExp`, or typed array. Decided once per
 * prototype.
 */
export function isOpaqueBuiltin(value: object): boolean {
    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype === Object.prototype) return false;
    if (prototype === Array.prototype) return false;
    if (prototype === null) return false;
    let opaque = opaqueByPrototype.get(prototype);
    if (opaque === undefined) {
        opaque = inheritsOpaquePrototype(prototype);
        opaqueByPrototype.set(prototype, opaque);
    }
    return opaque;
}

/**
 * A leaf is stored and returned as-is, never proxied, and replacing it is
 * the change: a frozen object, or a built-in that cannot work behind a proxy.
 */
export function isLeafObject(value: object): boolean {
    if (Object.isFrozen(value)) return true;
    return isOpaqueBuiltin(value);
}
