import { BaseProxyHandler } from "../../packages/retree-core/src/internals/proxy.js";
import { registerHandlerFactory } from "../../packages/retree-core/src/internals/handler-factories.js";
import { readObject, readPrimitive } from "../../packages/retree-core/src/internals/compiled-node.js";
import { proxyHandlerSentinel, unproxiedBaseNodeKey, proxiedChildrenKey, type TCustomProxy } from "../../packages/retree-core/src/internals/proxy-types.js";
import type { TreeNode } from "../../packages/retree-core/src/types.js";

// Fixed-shape, data-only research prototype. Arrays and exotic objects stay
// proxied. Adding/deleting properties on a facade is deliberately unsupported.
// Shape discovery simulates schemas a compiler/query adapter could supply.
const owner = Symbol("facade-handler");
const isView = Symbol("facade-view");
interface Facade {
    [owner]: BaseProxyHandler<TreeNode>;
    [isView]: boolean;
}
const shapes = new Map<string, PropertyDescriptorMap>();
let created = 0;
class PlainHandler extends BaseProxyHandler<TreeNode> {
    descriptors!: PropertyDescriptorMap;
    override createBaseProxy(): TCustomProxy<TreeNode> { return this.make(false); }
    override createView(): TCustomProxy<TreeNode> { return this.make(true); }
    private make(view: boolean): TCustomProxy<TreeNode> {
        created++;
        const result: TreeNode = { [owner]: this, [isView]: view };
        Object.defineProperties(result, this.descriptors);
        return result as TCustomProxy<TreeNode>;
    }
}
export function installPlainFacades() {
    registerHandlerFactory(Object.prototype, (raw, emitter, parent) => {
        const ownKeys = Reflect.ownKeys(raw);
        const keys = ownKeys.filter((key): key is string => typeof key === "string");
        if (keys.length !== ownKeys.length) return undefined;
        for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
            if (!("value" in descriptor) || !descriptor.enumerable || !descriptor.configurable || !descriptor.writable || typeof descriptor.value === "function") return undefined;
        }
        const signature = JSON.stringify(keys);
        let descriptors = shapes.get(signature);
        if (descriptors === undefined) {
            descriptors = Object.create(null) as PropertyDescriptorMap;
            descriptors[proxyHandlerSentinel] = {
                get(this: Facade) { return this[owner]; },
            };
            for (const key of keys) {
                descriptors[key] = {
                    enumerable: true,
                    configurable: true,
                    get(this: Facade) {
                        const handler = this[owner];
                        const value: unknown = Reflect.get(handler[unproxiedBaseNodeKey], key);
                        return value !== null && typeof value === "object"
                            ? readObject(handler, key, value, handler[proxiedChildrenKey]?.[key], this[isView])
                            : readPrimitive(handler, key, value);
                    },
                    set(this: Facade, value: unknown) {
                        const handler = this[owner];
                        if (!handler.set(handler[unproxiedBaseNodeKey], key, value, handler[unproxiedBaseNodeKey])) throw new TypeError(`Facade could not write ${String(key)}`);
                    },
                };
            }
            shapes.set(signature, descriptors);
        }
        const handler = new PlainHandler(raw, emitter, parent);
        handler.descriptors = descriptors;
        return handler;
    });
}
export function facadeCount() { return created; }
