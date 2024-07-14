import { OptionalNode, TreeNode } from "./types";

/**
 * A dependency for {@link ReactiveNode}.
 * @remarks
 * If no {@link IReactiveDependency.comparisons} are provided, any change to {@link node} will emit an update to the {@link ReactiveNode}.
 * Otherwise, a change will emit when any new value in {@link IReactiveDependency.comparisons} does not equal the previous checked value.
 * The order and length of {@link IReactiveDependency.comparisons} must remain unchanged between updates.
 */
export interface IReactiveDependency<TNode extends TreeNode = TreeNode> {
    /**
     * The node to listen to "nodeChanged" events for.
     */
    node: OptionalNode<TNode>;
    /**
     * Optional. Values to compare between updates to {@link node}.
     * @remarks
     * When undefined, any change to {@link node} will emit an update to the {@link ReactiveNode}.
     * Otherwise, a change will emit when any new value the list does not equal the previous checked value.
     * The order and length of {@link IReactiveDependency.comparisons} must remain unchanged between updates.
     */
    comparisons?: any[];
}

/**
 * Declare dependencies for other nodes in the tree to conditionally emit changes for the node.
 * @remarks
 * Only one dependency needs to change to
 * You can build {@link IReactiveDependency} instances with {@link ReactiveNode.dependency}.
 * 
 * @example
 ```ts
 import { Retree, ReactiveNode } from "@retree/core";
 // Declare a class that extends ReactiveNode
 class Node extends ReactiveNode {
    numbers: number[] = [];
    constructor() {
        super();
    }
    // Get count of even numbers in the list
    get evenNumberCount(): number {
        return this.numbers.filter((number) => number % 2 === 0).length;
    }
    // Implement abstract dependencies getter
    get dependencies() {
        return [this.dependency(this.numbers, [this.evenNumberCount])];
    }
 }
 // Create root ReactiveNode instance and listen for changes
 const node = Retree.use(new Node());
 Retree.on(node, "nodeChanged", () => {
    console.log(node.evenNumberCount);
 });
 // Will emit "nodeChanged"
 node.list.push(2);
 // Will not emit "nodeChanged"
 node.list.push(3);
 ```
 */
export abstract class ReactiveNode {
    /**
     * Dependencies to listen for changes to.
     * @remarks
     * When any {@link IReactiveDependency} criteria is met, a change will be emitted for this {@link ReactiveNode} instance.
     */
    abstract get dependencies(): IReactiveDependency[];
    /**
     * Creates a new {@link IReactiveDependency} instance.
     *
     * @param node the node to listen to "nodeChanged" events for.
     * @param comparisons Optional. Values to compare between updates to {@link node}.
     * @returns dependency object.
     */
    protected dependency<TNode extends TreeNode = TreeNode>(
        node: OptionalNode<TNode>,
        comparisons?: any[]
    ): IReactiveDependency<TNode> {
        return {
            node,
            comparisons,
        };
    }
}
