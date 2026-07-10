import { TreeNode } from "../types";

export const unproxiedBaseNodeKey = Symbol("retree-base-node");
export const proxiedParentKey = Symbol("retree-parent");
export const proxiedChildrenKey = Symbol("retree-children");
export const proxyTargetKey = Symbol("retree-proxy-target");
/**
 * @internal
 * Sentinel symbol intercepted first in Retree proxy get traps. Reading it on
 * a Retree proxy returns the proxy's handler; on any other value it misses.
 * This lets proxy-identity checks work without a per-proxy `WeakMap.set`
 * registration, which was ~14% of large-tree materialization.
 */
export const proxyHandlerSentinel = Symbol("retree-proxy-sentinel");

/**
 * @internal
 */
export interface IProxyParent<T extends TreeNode = TreeNode> {
    proxyNode: ICustomProxy<T> | null;
    propName: string | symbol | null;
}

/**
 * @internal
 * We use the ["Handler"] to store references to helpful metadata.
 */
export interface ICustomProxyHandler<TNode extends TreeNode = TreeNode> {
    [unproxiedBaseNodeKey]: TNode;
    [proxiedChildrenKey]: Record<string | symbol, any> | null;
    [proxiedParentKey]: IProxyParent | null;
    /**
     * The proxy's direct target when it differs from the raw node. Base proxy
     * handlers omit this (their target is the raw node); reproxy handlers set
     * it to the base proxy they wrap.
     */
    [proxyTargetKey]?: TNode;
}

/**
 * @internal
 */
export function isCustomProxyHandler<TNode extends TreeNode = TreeNode>(
    value: any
): value is ICustomProxyHandler<TNode> {
    return value?.[unproxiedBaseNodeKey] !== undefined;
}

/**
 * @internal
 * Custom proxy instance that is using {@link ICustomProxyHandler}.
 */
export interface ICustomProxy<TNode extends TreeNode = TreeNode> {
    ["[[Handler]]"]: ICustomProxyHandler<TNode>;
    ["[[Target]]"]: TNode;
}
/**
 * @internal
 */
export type TCustomProxy<TNode extends TreeNode = TreeNode> =
    ICustomProxy<TNode> & TNode;

export function registerCustomProxyMetadata<TNode extends TreeNode = TreeNode>(
    proxy: TCustomProxy<TNode>,
    handler: ICustomProxyHandler<TNode>,
    target: TNode
): void {
    // No registry write happens here: the proxy's get trap answers
    // proxyHandlerSentinel reads with its handler, so proxy identity is
    // discoverable without a per-proxy WeakMap.set. Only reproxies need the
    // wrapped target recorded (base proxies target their raw node).
    if (target !== handler[unproxiedBaseNodeKey]) {
        handler[proxyTargetKey] = target;
    }
    void proxy;
}

export function getCustomProxyHandlerFromMetadata<
    TNode extends TreeNode = TreeNode
>(value: unknown): ICustomProxyHandler<TNode> | undefined {
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    let handler: unknown;
    try {
        // Retree proxies intercept this sentinel and return their handler.
        // Plain objects miss. Foreign proxies see one unknown-symbol read,
        // which well-behaved traps answer with undefined.
        handler = (value as { [proxyHandlerSentinel]?: unknown })[
            proxyHandlerSentinel
        ];
    } catch {
        // Revoked proxies throw on any property read.
        return undefined;
    }
    if (handler === undefined) {
        return undefined;
    }
    // Guard against foreign proxies that answer arbitrary keys.
    if (!isCustomProxyHandler<TNode>(handler)) {
        return undefined;
    }
    return handler;
}

export function getCustomProxyTargetFromMetadata<
    TNode extends TreeNode = TreeNode
>(value: unknown): TNode | undefined {
    const handler = getCustomProxyHandlerFromMetadata(value);
    if (handler === undefined) {
        return undefined;
    }
    return (handler[proxyTargetKey] ?? handler[unproxiedBaseNodeKey]) as TNode;
}

/**
 * @internal
 * Checks to see if a value is an {@link ICustomProxy} instance
 */
export function isCustomProxy<TNode extends TreeNode = TreeNode>(
    value: any
): value is TCustomProxy<TNode> {
    return getCustomProxyHandlerFromMetadata<TNode>(value) !== undefined;
}
