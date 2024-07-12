import { TreeNode } from "../types";

export const unproxiedBaseNodeKey = Symbol("retree-base-node");
export const proxiedParentKey = Symbol("retree-parent");
export const proxiedChildrenKey = Symbol("retree-children");

/**
 * @internal
 * We use the ["Handler"] to store references to helpful metadata.
 */
export interface ICustomProxyHandler<TNode extends TreeNode = TreeNode> {
    [unproxiedBaseNodeKey]: TNode;
    [proxiedChildrenKey]: Record<string, any>;
    [proxiedParentKey]: TreeNode | null;
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
export interface ICustomProxy<TNode extends TreeNode | TreeNode> {
    ["[[Handler]]"]: ICustomProxyHandler<TNode>;
    ["[[Target]]"]: any;
}

/**
 * @internal
 * Checks to see if a value is an {@link ICustomProxy} instance
 */
export function isCustomProxy<TNode extends TreeNode = TreeNode>(
    value: any
): value is ICustomProxy<TNode> {
    return (
        value &&
        isCustomProxyHandler(value["[[Handler]]"]) &&
        value["[[Target]]"]
    );
}
