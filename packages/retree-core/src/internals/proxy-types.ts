import { TreeNode } from "../types";

export const unproxiedBaseNodeKey = Symbol("retree-base-node");
export const proxiedParentKey = Symbol("retree-parent");
export const proxiedChildrenKey = Symbol("retree-children");
export const proxyTargetKey = Symbol("retree-proxy-target");

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
    [proxiedChildrenKey]: Record<string | symbol, any>;
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

// Keyed by proxy, valued by the proxy's handler. The handler already knows the
// raw node and (for reproxies) the wrapped target, so storing it directly
// avoids allocating a metadata record per proxy — a measurable share of
// materialization cost.
const customProxyMetadata = new WeakMap<
    object,
    ICustomProxyHandler<TreeNode>
>();

export function registerCustomProxyMetadata<TNode extends TreeNode = TreeNode>(
    proxy: TCustomProxy<TNode>,
    handler: ICustomProxyHandler<TNode>,
    target: TNode
): void {
    if (target !== handler[unproxiedBaseNodeKey]) {
        handler[proxyTargetKey] = target;
    }
    customProxyMetadata.set(proxy, handler as ICustomProxyHandler<TreeNode>);
}

export function getCustomProxyHandlerFromMetadata<
    TNode extends TreeNode = TreeNode
>(value: unknown): ICustomProxyHandler<TNode> | undefined {
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    return customProxyMetadata.get(value) as
        | ICustomProxyHandler<TNode>
        | undefined;
}

export function getCustomProxyTargetFromMetadata<
    TNode extends TreeNode = TreeNode
>(value: unknown): TNode | undefined {
    if (value === null || typeof value !== "object") {
        return undefined;
    }
    const handler = customProxyMetadata.get(value);
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
