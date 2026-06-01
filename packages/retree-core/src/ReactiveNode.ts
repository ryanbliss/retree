import { consumeCurrentMemoGetter, runMemo } from "./internals/memo";
import type { RetreeLink } from "./Retree";
import { OptionalNode, RetreeObjectMoveKey, TreeNode } from "./types";

type LinkReactiveNode = <TNode extends TreeNode>(
    node: TNode
) => RetreeLink<TNode>;

let linkReactiveNode: LinkReactiveNode = () => {
    // @retree-throws
    throw new Error(
        "ReactiveNode.link: Retree link support has not been initialized. This is unexpected and likely a Retree packaging or module-loading bug. Fix: import ReactiveNode and Retree from the same @retreejs/core package instance. If your app already does that, please file a Retree issue with your package manager lockfile and a minimal reproduction."
    );
};

type MoveReactiveNode = <TNode extends ReactiveNode>(
    node: TNode,
    destination: TreeNode,
    key?: unknown
) => TNode;

let moveReactiveNode: MoveReactiveNode = () => {
    // @retree-throws
    throw new Error(
        "ReactiveNode.moveTo: Retree move support has not been initialized. This is unexpected and likely a Retree packaging or module-loading bug. Fix: import ReactiveNode and Retree from the same @retreejs/core package instance. If your app already does that, please file a Retree issue with your package manager lockfile and a minimal reproduction."
    );
};

/**
 * @internal
 */
export function setReactiveNodeLinkImplementation(
    implementation: LinkReactiveNode
) {
    linkReactiveNode = implementation;
}

/**
 * @internal
 */
export function setReactiveNodeMoveImplementation(
    implementation: MoveReactiveNode
) {
    moveReactiveNode = implementation;
}

/**
 * A dependency for {@link ReactiveNode}.
 * @remarks
 * If no {@link IReactiveDependency.comparisons} are provided, any change to `node` will emit an update to the {@link ReactiveNode}.
 * Otherwise, a change will emit when any new value in {@link IReactiveDependency.comparisons} does not equal the previous checked value.
 * The order and length of {@link IReactiveDependency.comparisons} must remain unchanged between updates.
 */
export interface IReactiveDependency<TNode extends TreeNode = TreeNode> {
    /**
     * The node to listen to "nodeChanged" events for.
     */
    node: OptionalNode<TNode>;
    /**
     * Optional. Values to compare between updates to `node`.
     * @remarks
     * When undefined, any change to `node` will emit an update to the {@link ReactiveNode}.
     * Otherwise, a change will emit when any new value the list does not equal the previous checked value.
     * The order and length of {@link IReactiveDependency.comparisons} must remain unchanged between updates.
     */
    comparisons?: any[];
}

export interface IRetreePrepareTreeOptions {
    /**
     * Maximum nested object depth to prepare.
     * @remarks
     * Defaults to `Infinity`, which prepares every reachable non-ignored
     * object/array/Map/Set value below this node.
     */
    depth?: number;
}

export interface IRetreePrepareNodeOptions extends IRetreePrepareTreeOptions {
    /**
     * When true, Retree prepares this node's tree when the node is proxied.
     * @remarks
     * This pays the lazy child-proxy cost up front instead of on first nested
     * access.
     */
    autoPrepare: boolean;
}

export interface IRetreeNodeOptions {
    /**
     * Controls how this {@link ReactiveNode} prepares its object tree for Retree.
     * @remarks
     * When unset, Retree lazily prepares plain object and array fields on access.
     */
    prepare?: IRetreePrepareNodeOptions;
}

export const COLLECTED_KEYS_SYMBOL = "RETREE_COLLECTED_KEYS_SYMBOL";
export const LINKED_KEYS_SYMBOL = "RETREE_LINKED_KEYS_SYMBOL";
export const RUN_CHANGED_EFFECT_SYMBOL = "RETREE_RUN_CHANGED_EFFECT_SYMBOL";
export const RUN_OBSERVED_EFFECT_SYMBOL = "RETREE_RUN_OBSERVED_EFFECT_SYMBOL";
export const RUN_UNOBSERVED_EFFECT_SYMBOL =
    "RETREE_RUN_UNOBSERVED_EFFECT_SYMBOL";

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
 const node = Retree.root(new Node());
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
     * @hidden
     */
    public [COLLECTED_KEYS_SYMBOL]: Set<string | symbol> = new Set<
        string | symbol
    >();
    public [LINKED_KEYS_SYMBOL]: Set<string | symbol> = new Set<
        string | symbol
    >();

    /**
     * Runtime options for this Retree node.
     * @remarks
     * Retree ignores this field for reactivity so options do not emit or become
     * part of the tree.
     */
    public options: IRetreeNodeOptions = {};

    constructor(options?: IRetreeNodeOptions) {
        this[COLLECTED_KEYS_SYMBOL].add("options");
        this[COLLECTED_KEYS_SYMBOL].add(LINKED_KEYS_SYMBOL);
        if (options !== undefined) {
            this.options = options;
        }
    }

    /**
     * Move this node to a new structural parent.
     *
     * @remarks
     * This is a convenience wrapper around {@link Retree.move}.
     */
    public moveTo<TValue extends TreeNode = this>(
        destination: this extends TValue ? TValue[] : never,
        key?: number
    ): this;
    public moveTo<TKey = unknown, TValue extends TreeNode = this>(
        destination: this extends TValue ? Map<TKey, TValue> : never,
        key: TKey
    ): this;
    public moveTo<TValue extends TreeNode = this>(
        destination: this extends TValue ? Set<TValue> : never
    ): this;
    public moveTo<TDestination extends TreeNode = TreeNode>(
        destination: TDestination,
        key: RetreeObjectMoveKey<TDestination, this>
    ): this;
    public moveTo(destination: TreeNode, key?: unknown): this {
        return moveReactiveNode(this, destination, key);
    }

    /**
     * Create a reactive pointer to an existing Retree-managed node.
     *
     * @remarks
     * This is a convenience wrapper around {@link Retree.link}.
     */
    public link<TNode extends TreeNode>(node: TNode): RetreeLink<TNode> {
        return linkReactiveNode(node);
    }

    /**
     * Dependencies to listen for changes to.
     * @remarks
     * When any {@link IReactiveDependency} criteria is met, a change will be emitted for this {@link ReactiveNode} instance.
     */
    abstract get dependencies(): IReactiveDependency[];

    /**
     * Runs when this {@link ReactiveNode} gets its first active
     * `nodeChanged` or `treeChanged` observer.
     * @remarks
     * Override this for work that requires the proxied instance, such as
     * starting external subscriptions that write back into Retree state.
     */
    protected onObserved(): void {}

    /**
     * Runs when this {@link ReactiveNode} loses its last active
     * `nodeChanged` or `treeChanged` observer.
     */
    protected onUnobserved(): void {}

    /**
     * Runs after this {@link ReactiveNode} receives a fresh reproxy.
     * @remarks
     * Override this when a node needs to synchronize derived state only after a
     * real Retree change. Retree runs this before `nodeChanged` /
     * `treeChanged` listeners flush. If no transaction is already active,
     * Retree starts one so state updates made here are batched with the reproxy
     * that triggered the effect.
     */
    protected onChanged(): void {}
    /**
     * Creates a new {@link IReactiveDependency} instance.
     *
     * @param node the node to listen to "nodeChanged" events for.
     * @param comparisons Optional. Values to compare between updates to `node`.
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

    /**
     * Prepare lazy Retree child proxies below this {@link ReactiveNode}.
     * @remarks
     * Retree lazily proxies plain object and array fields on ReactiveNodes. Call
     * this when an app wants to pay that first-touch cost during a controlled
     * phase, such as while showing a loading spinner. This walks only own data
     * properties, so computed getters like `dependencies` are not evaluated or
     * cached as child nodes. Fields marked with `@ignore` are skipped.
     */
    public prepareTree(options: IRetreePrepareTreeOptions = {}): void {
        const depth = options.depth ?? Infinity;
        if (depth < 0) {
            // @retree-throws
            throw new Error(
                "ReactiveNode.prepareTree: depth must be greater than or equal to 0. This is a caller configuration error. Fix: omit depth to prepare the full tree, pass 0 to prepare only this node, or pass a positive integer."
            );
        }
        prepareObject(this, depth, new WeakSet<object>());
    }

    /**
     * Memoize the result of `fn`, scoped to this {@link ReactiveNode} instance.
     * @remarks
     * Two forms:
     * - **Keyless (inside a getter):** `this.memo(fn, deps?)` — derives the cache key
     *   from the active getter's property name. Throws if called outside a getter or
     *   more than once in the same getter.
     * - **Explicit key:** `this.memo(key, fn, deps?)` — works anywhere; required when
     *   stacking multiple memo cells in one getter, or memoizing inside a method.
     *
     * Cache semantics for `comparisons`:
     * - `undefined`: recompute whenever this {@link ReactiveNode} reproxies (a dependency
     *   changed or a property was set on it). Useful as a "compute once per render" cache.
     * - `[]`: compute once and cache forever for this instance.
     * - `[a, b, ...]`: recompute when any cell shallow-changes using `Object.is`.
     *   Tree-node cells are compared by their latest reproxy identity, so passing
     *   `this.list` correctly invalidates when `list` mutates.
     *
     * @example
     ```ts
     class ListFilter extends ReactiveNode {
        list: Card[] = [];
        searchText = "";
        // Keyless form
        get filteredList() {
            return this.memo(
                () => this.list.filter((c) => c.text === this.searchText),
                [this.list, this.searchText]
            );
        }
        // Explicit-key form (e.g. when stacking two memos in one getter)
        get pair() {
            const a = this.memo("a", () => expensiveA(), [this.list]);
            const b = this.memo("b", () => expensiveB(), [this.searchText]);
            return { a, b };
        }
        get dependencies() { return [this.dependency(this.list)]; }
     }
     ```
     */
    protected memo<T>(fn: () => T, comparisons?: unknown[]): T;
    protected memo<T>(key: string, fn: () => T, comparisons?: unknown[]): T;
    protected memo<T>(
        ...args:
            | [fn: () => T, comparisons?: unknown[]]
            | [key: string, fn: () => T, comparisons?: unknown[]]
    ): T {
        let key: string | symbol;
        let fn: () => T;
        let comparisons: unknown[] | undefined;
        if (typeof args[0] === "function") {
            // Keyless: derive the key from the active getter on the stack.
            key = consumeCurrentMemoGetter(this);
            fn = args[0];
            comparisons = args[1] as unknown[] | undefined;
        } else {
            key = args[0];
            fn = args[1] as () => T;
            comparisons = args[2];
        }
        return runMemo(this, key, fn, comparisons);
    }
    /**
     * @hidden
     */
    public static [RUN_CHANGED_EFFECT_SYMBOL](node: ReactiveNode): void {
        node.onChanged();
    }

    /**
     * @hidden
     */
    public static [RUN_OBSERVED_EFFECT_SYMBOL](node: ReactiveNode): void {
        node.onObserved();
    }

    /**
     * @hidden
     */
    public static [RUN_UNOBSERVED_EFFECT_SYMBOL](node: ReactiveNode): void {
        node.onUnobserved();
    }
}

function prepareObject(
    object: object,
    remainingDepth: number,
    seen: WeakSet<object>
): void {
    if (remainingDepth < 0) {
        return;
    }
    if (seen.has(object)) {
        return;
    }
    seen.add(object);

    if (object instanceof Map) {
        for (const value of object.values()) {
            prepareValue(value, remainingDepth - 1, seen);
        }
        return;
    }
    if (object instanceof Set) {
        for (const value of object.values()) {
            prepareValue(value, remainingDepth - 1, seen);
        }
        return;
    }

    for (const key of Reflect.ownKeys(object)) {
        if (shouldSkipMaterializeKey(object, key)) {
            continue;
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (!descriptorHasValue(descriptor)) {
            continue;
        }
        const value = Reflect.get(object, key, object);
        prepareValue(value, remainingDepth - 1, seen);
    }
}

function prepareValue(
    value: unknown,
    remainingDepth: number,
    seen: WeakSet<object>
): void {
    if (remainingDepth < 0) {
        return;
    }
    if (value === null) {
        return;
    }
    if (typeof value !== "object") {
        return;
    }
    prepareObject(value, remainingDepth, seen);
}

function shouldSkipMaterializeKey(
    object: object,
    key: string | symbol
): boolean {
    if (!(object instanceof ReactiveNode)) {
        return false;
    }
    if (key === COLLECTED_KEYS_SYMBOL) {
        return true;
    }
    if (object[COLLECTED_KEYS_SYMBOL].has(key)) {
        return true;
    }
    return object[LINKED_KEYS_SYMBOL].has(key);
}

function descriptorHasValue(
    descriptor: PropertyDescriptor | undefined
): descriptor is PropertyDescriptor & { value: unknown } {
    if (descriptor === undefined) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(descriptor, "value");
}
