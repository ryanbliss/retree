/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { TreeNode } from "../types.js";
import {
    isDependencyTrackingActive,
    trackDependencyPropertyAccess,
} from "./dependency-tracking.js";
import { BaseProxyHandler } from "./proxy.js";
import { proxiedChildrenKey, TCustomProxy } from "./proxy-types.js";
import { latestIdentity, latestIdentityOfHandler } from "./reproxy.js";

/**
 * Native array read methods served by a wrapper instead of the bound native.
 * The native, bound to a proxy, dispatches a `has` and a `get` trap per
 * element; the wrapper walks the raw array and resolves each element the
 * way the get trap would, so callers see the same values and identities
 * without the per-element dispatch.
 */
const ARRAY_READ_METHODS = {
    at: Array.prototype.at,
    entries: Array.prototype.entries,
    every: Array.prototype.every,
    filter: Array.prototype.filter,
    find: Array.prototype.find,
    findIndex: Array.prototype.findIndex,
    flatMap: Array.prototype.flatMap,
    forEach: Array.prototype.forEach,
    includes: Array.prototype.includes,
    indexOf: Array.prototype.indexOf,
    keys: Array.prototype.keys,
    map: Array.prototype.map,
    reduce: Array.prototype.reduce,
    slice: Array.prototype.slice,
    some: Array.prototype.some,
    values: Array.prototype.values,
    [Symbol.iterator]: Array.prototype[Symbol.iterator],
} as const;

export type ArrayReadMethodName = keyof typeof ARRAY_READ_METHODS;

function isArrayReadMethod(prop: string | symbol): prop is ArrayReadMethodName {
    return Object.prototype.hasOwnProperty.call(ARRAY_READ_METHODS, prop);
}

/**
 * @internal
 * True for keys that start with a digit: element indexes and never method
 * names, so index reads skip the method tables entirely.
 */
export function isDigitLedKey(prop: string | symbol): boolean {
    if (typeof prop !== "string") return false;
    const code = prop.charCodeAt(0);
    return code >= 48 && code <= 57;
}

/**
 * True when reading `prop` on the raw array `node` resolves to one of the
 * native read methods in {@link ARRAY_READ_METHODS}. Overridden methods and
 * array subclasses stay on the bound-native path so species and overrides
 * keep their native behavior.
 */
export function isNativeArrayReadAccess(
    node: TreeNode,
    prop: string | symbol
): prop is ArrayReadMethodName {
    if (!Array.isArray(node)) {
        return false;
    }
    if (Object.getPrototypeOf(node) !== Array.prototype) {
        return false;
    }
    if (!isArrayReadMethod(prop)) {
        return false;
    }
    return Reflect.get(node, prop, node) === ARRAY_READ_METHODS[prop];
}

/**
 * Element `index` of the raw array as the get trap would serve it: a cached
 * child as its base proxy or latest view, an uncached object through the
 * handler's stored-object resolver, and a primitive as-is.
 */
function readArrayElement(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    index: number,
    asView: boolean
): unknown {
    const value = target[index];
    if (value === null || typeof value !== "object") {
        return value;
    }
    const children = handler[proxiedChildrenKey];
    const child = children === null ? undefined : children[index];
    if (child !== undefined) {
        return asView ? latestIdentityOfHandler(child) : child.baseProxy;
    }
    const resolved = handler.resolveStoredObject(target, String(index), value);
    return asView ? latestIdentity(resolved) : resolved;
}

function trackLengthRead(
    handler: BaseProxyHandler<TreeNode>,
    length: number
): void {
    trackDependencyPropertyAccess(handler, handler.baseProxy, "length", length);
}

function trackElementRead(
    handler: BaseProxyHandler<TreeNode>,
    index: number,
    element: unknown
): void {
    trackDependencyPropertyAccess(
        handler,
        handler.baseProxy,
        String(index),
        element
    );
}

function assertCallable(
    method: ArrayReadMethodName,
    callback: unknown
): asserts callback is Function {
    if (typeof callback !== "function") {
        // @retree-throws
        throw new TypeError(
            `Array.prototype.${String(
                method
            )}: expected a callback function but received type '${typeof callback}'.`
        );
    }
}

type ArrayReadCallback = (
    element: unknown,
    index: number,
    array: TCustomProxy<TreeNode>
) => unknown;

/**
 * Walk the raw array like the native callback methods do: the length is
 * read once up front, holes are skipped, and elements are read live so a
 * callback that writes to the array observes its own writes. `visit`
 * returns true to stop early. Walks in `[from, to)`.
 */
function walkArray(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    asView: boolean,
    visit: (element: unknown, index: number) => boolean,
    from = 0,
    to = target.length
): void {
    const tracking = isDependencyTrackingActive();
    if (tracking) {
        trackLengthRead(handler, target.length);
    }
    for (let index = from; index < to; index++) {
        if (!(index in target)) {
            if (tracking) {
                // A filled hole changes this read, so record it.
                trackElementRead(handler, index, undefined);
            }
            continue;
        }
        const element = readArrayElement(handler, target, index, asView);
        if (tracking) {
            trackElementRead(handler, index, element);
        }
        if (visit(element, index)) {
            return;
        }
    }
}

/** `ToIntegerOrInfinity` from the spec: the integer an index argument means. */
function toIntegerOrInfinity(value: unknown): number {
    const integer = Math.trunc(Number(value));
    return Number.isNaN(integer) ? 0 : integer;
}

/** A relative index clamped into `[0, length]`; negative counts from the end. */
function clampRelativeIndex(relative: number, length: number): number {
    if (relative < 0) {
        return Math.max(length + relative, 0);
    }
    return Math.min(relative, length);
}

/**
 * Whether element `index` matches `search` the way `indexOf` (strict
 * equality) or `includes` (SameValueZero) sees it through the proxy. A
 * primitive slot compares raw. An object slot can only match an object,
 * through the identity the read path serves, so it is resolved only when
 * `search` is an object or the read is being tracked.
 */
function elementMatches(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    index: number,
    asView: boolean,
    search: unknown,
    sameValueZero: boolean,
    tracking: boolean
): boolean {
    const raw = target[index];
    if (raw === null || typeof raw !== "object") {
        if (tracking) {
            trackElementRead(handler, index, raw);
        }
        if (raw === search) {
            return true;
        }
        return sameValueZero && raw !== raw && search !== search;
    }
    const searchIsObject = search !== null && typeof search === "object";
    if (!tracking && !searchIsObject) {
        return false;
    }
    const element = readArrayElement(handler, target, index, asView);
    if (tracking) {
        trackElementRead(handler, index, element);
    }
    return element === search;
}

/**
 * The first index at or after `from` whose element matches `search`, or
 * -1. `indexOf` skips holes; `includes` reads them as `undefined`.
 */
function searchArray(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    asView: boolean,
    search: unknown,
    fromIndex: unknown,
    sameValueZero: boolean
): number {
    const tracking = isDependencyTrackingActive();
    const length = target.length;
    if (tracking) {
        trackLengthRead(handler, length);
    }
    const from = clampRelativeIndex(toIntegerOrInfinity(fromIndex), length);
    for (let index = from; index < length; index++) {
        if (!sameValueZero && !(index in target)) {
            continue;
        }
        if (
            elementMatches(
                handler,
                target,
                index,
                asView,
                search,
                sameValueZero,
                tracking
            )
        ) {
            return index;
        }
    }
    return -1;
}

const enum ArrayIteratorKind {
    Keys,
    Values,
    Entries,
}

/**
 * An iterator over the raw array resolved like the get trap. Mirrors the
 * native array iterator: the length is re-read on every step and holes
 * yield `undefined`.
 */
function createArrayReadIterator(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    asView: boolean,
    kind: ArrayIteratorKind
): IterableIterator<unknown> {
    let index = 0;
    return {
        next(): IteratorResult<unknown> {
            const tracking = isDependencyTrackingActive();
            if (tracking && index === 0) {
                trackLengthRead(handler, target.length);
            }
            if (index >= target.length) {
                return { value: undefined, done: true };
            }
            const current = index++;
            if (kind === ArrayIteratorKind.Keys) {
                return { value: current, done: false };
            }
            const element = readArrayElement(handler, target, current, asView);
            if (tracking) {
                trackElementRead(handler, current, element);
            }
            if (kind === ArrayIteratorKind.Entries) {
                return { value: [current, element], done: false };
            }
            return { value: element, done: false };
        },
        [Symbol.iterator]() {
            return this;
        },
    };
}

/**
 * The wrapper served for a native array read method. `self` is the proxy
 * the method was read from; it is the callback's array argument and the
 * value `find`-style methods never return but `map`-style callbacks may
 * capture. `asView` resolves elements to their latest views, as the view
 * get trap does, instead of their base proxies.
 */
export function wrapArrayRead(
    handler: BaseProxyHandler<TreeNode>,
    prop: ArrayReadMethodName,
    target: unknown[],
    self: TCustomProxy<TreeNode>,
    asView: boolean
): Function {
    switch (prop) {
        case "forEach":
            return function forEachWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): void {
                assertCallable(prop, callback);
                walkArray(handler, target, asView, (element, index) => {
                    callback.call(thisArg, element, index, self);
                    return false;
                });
            };
        case "map":
            return function mapWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): unknown[] {
                assertCallable(prop, callback);
                const result: unknown[] = new Array(target.length);
                walkArray(handler, target, asView, (element, index) => {
                    result[index] = callback.call(
                        thisArg,
                        element,
                        index,
                        self
                    );
                    return false;
                });
                return result;
            };
        case "filter":
            return function filterWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): unknown[] {
                assertCallable(prop, callback);
                const result: unknown[] = [];
                walkArray(handler, target, asView, (element, index) => {
                    if (callback.call(thisArg, element, index, self)) {
                        result.push(element);
                    }
                    return false;
                });
                return result;
            };
        case "find":
            return function findWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): unknown {
                assertCallable(prop, callback);
                let found: unknown = undefined;
                walkArray(handler, target, asView, (element, index) => {
                    if (!callback.call(thisArg, element, index, self)) {
                        return false;
                    }
                    found = element;
                    return true;
                });
                return found;
            };
        case "findIndex":
            return function findIndexWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): number {
                assertCallable(prop, callback);
                let found = -1;
                walkArray(handler, target, asView, (element, index) => {
                    if (!callback.call(thisArg, element, index, self)) {
                        return false;
                    }
                    found = index;
                    return true;
                });
                return found;
            };
        case "some":
            return function someWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): boolean {
                assertCallable(prop, callback);
                let result = false;
                walkArray(handler, target, asView, (element, index) => {
                    if (!callback.call(thisArg, element, index, self)) {
                        return false;
                    }
                    result = true;
                    return true;
                });
                return result;
            };
        case "every":
            return function everyWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): boolean {
                assertCallable(prop, callback);
                let result = true;
                walkArray(handler, target, asView, (element, index) => {
                    if (callback.call(thisArg, element, index, self)) {
                        return false;
                    }
                    result = false;
                    return true;
                });
                return result;
            };
        case "reduce":
            return function reduceWrapper(
                callback: (
                    accumulator: unknown,
                    element: unknown,
                    index: number,
                    array: TCustomProxy<TreeNode>
                ) => unknown,
                ...initial: unknown[]
            ): unknown {
                assertCallable(prop, callback);
                let hasAccumulator = initial.length > 0;
                let accumulator: unknown = initial[0];
                walkArray(handler, target, asView, (element, index) => {
                    if (hasAccumulator) {
                        accumulator = callback(
                            accumulator,
                            element,
                            index,
                            self
                        );
                        return false;
                    }
                    accumulator = element;
                    hasAccumulator = true;
                    return false;
                });
                if (!hasAccumulator) {
                    // @retree-throws
                    throw new TypeError(
                        "Array.prototype.reduce: reduce of an empty array with no initial value."
                    );
                }
                return accumulator;
            };
        case "flatMap":
            return function flatMapWrapper(
                callback: ArrayReadCallback,
                thisArg?: unknown
            ): unknown[] {
                assertCallable(prop, callback);
                const result: unknown[] = [];
                walkArray(handler, target, asView, (element, index) => {
                    const mapped = callback.call(thisArg, element, index, self);
                    if (!Array.isArray(mapped)) {
                        result.push(mapped);
                        return false;
                    }
                    // One level, like the native: present inner elements
                    // are read through whatever `mapped` is.
                    for (let inner = 0; inner < mapped.length; inner++) {
                        if (inner in mapped) {
                            result.push(mapped[inner]);
                        }
                    }
                    return false;
                });
                return result;
            };
        case "indexOf":
            return function indexOfWrapper(
                search: unknown,
                fromIndex?: unknown
            ): number {
                return searchArray(
                    handler,
                    target,
                    asView,
                    search,
                    fromIndex,
                    false
                );
            };
        case "includes":
            return function includesWrapper(
                search: unknown,
                fromIndex?: unknown
            ): boolean {
                return (
                    searchArray(
                        handler,
                        target,
                        asView,
                        search,
                        fromIndex,
                        true
                    ) !== -1
                );
            };
        case "at":
            return function atWrapper(index: unknown): unknown {
                const tracking = isDependencyTrackingActive();
                const length = target.length;
                if (tracking) {
                    trackLengthRead(handler, length);
                }
                const relative = toIntegerOrInfinity(index);
                const resolved = relative < 0 ? length + relative : relative;
                if (resolved < 0 || resolved >= length) {
                    return undefined;
                }
                const element = readArrayElement(
                    handler,
                    target,
                    resolved,
                    asView
                );
                if (tracking) {
                    trackElementRead(handler, resolved, element);
                }
                return element;
            };
        case "slice":
            return function sliceWrapper(
                start?: unknown,
                end?: unknown
            ): unknown[] {
                const length = target.length;
                const from = clampRelativeIndex(
                    toIntegerOrInfinity(start),
                    length
                );
                const to =
                    end === undefined
                        ? length
                        : clampRelativeIndex(toIntegerOrInfinity(end), length);
                const result: unknown[] = new Array(Math.max(to - from, 0));
                walkArray(
                    handler,
                    target,
                    asView,
                    (element, index) => {
                        result[index - from] = element;
                        return false;
                    },
                    from,
                    to
                );
                return result;
            };
        case "keys":
            return function keysWrapper(): IterableIterator<unknown> {
                return createArrayReadIterator(
                    handler,
                    target,
                    asView,
                    ArrayIteratorKind.Keys
                );
            };
        case "entries":
            return function entriesWrapper(): IterableIterator<unknown> {
                return createArrayReadIterator(
                    handler,
                    target,
                    asView,
                    ArrayIteratorKind.Entries
                );
            };
        case "values":
        case Symbol.iterator:
            return function valuesWrapper(): IterableIterator<unknown> {
                return createArrayReadIterator(
                    handler,
                    target,
                    asView,
                    ArrayIteratorKind.Values
                );
            };
    }
}
