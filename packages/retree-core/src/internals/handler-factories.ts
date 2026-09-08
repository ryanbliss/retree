import type { TreeNode } from "../types.js";
import type { BaseProxyHandler } from "./proxy.js";
import type { IProxyParent } from "./proxy-types.js";
import type { TreeChangeEmitter } from "./NodeChangeEmitter.js";

type HandlerFactory = (
    node: TreeNode,
    emitter: TreeChangeEmitter,
    parent: IProxyParent | null
) => BaseProxyHandler<TreeNode> | undefined;

// Allocated only when an optional runtime registers a class.
let factories: WeakMap<object, HandlerFactory> | undefined;

export function registerHandlerFactory(
    prototype: object,
    factory: HandlerFactory
): void {
    (factories ??= new WeakMap()).set(prototype, factory);
}

export function createRegisteredHandler<T extends TreeNode>(
    node: T,
    emitter: TreeChangeEmitter,
    parent: IProxyParent | null
): BaseProxyHandler<T> | undefined {
    return factories?.get(Object.getPrototypeOf(node))?.(
        node,
        emitter,
        parent
    ) as BaseProxyHandler<T> | undefined;
}
