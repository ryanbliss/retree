import { COLLECTED_KEYS_SYMBOL, ReactiveNode } from "./ReactiveNode";
import { runMemo } from "./internals/memo";

/**
 * Field decorator that excludes a property of a {@link ReactiveNode} from Retree's
 * reactivity system.
 * @remarks
 * Reads and writes to the ignored field still work normally, but:
 * - The proxy will not wrap the field's value or build child proxies underneath it,
 *   so nested mutations (e.g. `this.ignored.count = 1`) do **not** emit
 *   `nodeChanged` / `treeChanged` listeners on the parent.
 * - Replacing the field at the top level (e.g. `this.ignored = {...}`) likewise
 *   skips listener emission.
 *
 * Use this for state that lives on a `ReactiveNode` but should not participate in
 * the tree — caches, scratch buffers, framework handles, references to objects
 * already managed elsewhere, etc.
 *
 * @example
 ```ts
 import { Retree, ReactiveNode, ignore } from "@retreejs/core";

 class Counter extends ReactiveNode {
    public count = 0;
    // Mutations to `cache` do not trigger Retree listeners.
    @ignore public cache: Record<string, unknown> = {};

    get dependencies() { return []; }
 }

 const node = Retree.root(new Counter());
 Retree.on(node, "nodeChanged", () => console.log("changed"));
 node.cache.something = 1; // ❌ no log
 node.count = 1;            // ✅ logs "changed"
 ```
 */
export function ignore(
    _value: undefined,
    context: ClassFieldDecoratorContext
): void | ((this: ReactiveNode, value: any) => any) {
    context.addInitializer(function () {
        if (!(this instanceof ReactiveNode)) return;
        this[COLLECTED_KEYS_SYMBOL].add(context.name);
    });
    return;
}

/**
 * Decorator that memoizes a getter on a {@link ReactiveNode}.
 * @remarks
 * Pass a function that returns the comparisons array — the function captures `this`
 * lazily, so the values are read fresh each time the getter is accessed.
 *
 * Cache semantics (matches {@link ReactiveNode.memo}):
 * - No argument or returns `undefined`: recompute on every reproxy of the ReactiveNode.
 * - Returns `[]`: compute once, cache forever for this instance.
 * - Returns `[a, b, ...]`: recompute on shallow-change.
 *
 * The cache key is the getter's property name, so each `@memo`-decorated getter has
 * its own cell automatically.
 *
 * @example
 ```ts
 class ListFilter extends ReactiveNode {
    list: Card[] = [];
    searchText = "";

    @memo((self: ListFilter) => [self.list, self.searchText])
    get filteredList() {
        return this.list.filter((c) => c.text === this.searchText);
    }

    get dependencies() { return [this.dependency(this.list)]; }
 }
 ```
 */
export function memo<This extends ReactiveNode, Value>(
    getComparisons?: (self: This) => unknown[] | undefined
) {
    return function (
        target: (this: This) => Value,
        context: ClassGetterDecoratorContext<This, Value>
    ): (this: This) => Value {
        if (context.kind !== "getter") {
            throw new Error(
                "@memo can only be applied to a getter on a ReactiveNode subclass."
            );
        }
        const cacheKey = context.name;
        return function memoizedGetter(this: This): Value {
            const comparisons = getComparisons?.(this);
            return runMemo(
                this,
                cacheKey,
                () => target.call(this),
                comparisons
            );
        };
    };
}
