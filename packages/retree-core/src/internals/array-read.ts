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
    every: Array.prototype.every,
    filter: Array.prototype.filter,
    find: Array.prototype.find,
    findIndex: Array.prototype.findIndex,
    forEach: Array.prototype.forEach,
    map: Array.prototype.map,
    reduce: Array.prototype.reduce,
    some: Array.prototype.some,
    values: Array.prototype.values,
    [Symbol.iterator]: Array.prototype[Symbol.iterator],
} as const;

export type ArrayReadMethodName = keyof typeof ARRAY_READ_METHODS;

function isArrayReadMethod(prop: string | symbol): prop is ArrayReadMethodName {
    return Object.prototype.hasOwnProperty.call(ARRAY_READ_METHODS, prop);
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
 * returns true to stop early.
 */
function walkArray(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    asView: boolean,
    visit: (element: unknown, index: number) => boolean
): void {
    const tracking = isDependencyTrackingActive();
    const length = target.length;
    if (tracking) {
        trackLengthRead(handler, length);
    }
    for (let index = 0; index < length; index++) {
        if (!(index in target)) {
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

/**
 * An iterator over the raw array's elements resolved like the get trap.
 * Mirrors the native array iterator: the length is re-read on every step
 * and holes yield `undefined`.
 */
function createArrayReadIterator(
    handler: BaseProxyHandler<TreeNode>,
    target: unknown[],
    asView: boolean
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
            const element = readArrayElement(handler, target, index, asView);
            if (tracking) {
                trackElementRead(handler, index, element);
            }
            index++;
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
        case "values":
        case Symbol.iterator:
            return function valuesWrapper(): IterableIterator<unknown> {
                return createArrayReadIterator(handler, target, asView);
            };
    }
}
