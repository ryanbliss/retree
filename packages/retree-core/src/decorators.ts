import { COLLECTED_KEYS_SYMBOL, ReactiveNode } from "./ReactiveNode";
import { runFnMemo, runMemo } from "./internals/memo";

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

type FnMemoMethod<This, Args extends unknown[], Value> = (
    this: This,
    ...args: Args
) => Value;

type FnMemoComparisonArgs<Args extends unknown[]> = Args extends []
    ? unknown[]
    : Args;

/**
 * Decorator that memoizes a method return value on a {@link ReactiveNode}.
 * @remarks
 * Pass a function that returns the comparisons array — the function receives the
 * current instance and method arguments, so the values are read fresh each time
 * the method is called. The method arguments are always shallow-compared in
 * addition to the dependency comparisons.
 *
 * Cache semantics:
 * - No argument or returns `undefined`: recompute when the arguments change, or on
 *   every reproxy of the ReactiveNode.
 * - Returns `[]`: recompute only when the arguments change.
 * - Returns `[a, b, ...]`: recompute when the arguments or comparisons shallow-change.
 *
 * Each decorated method stores one cache cell per instance, containing the last
 * argument list and return value.
 *
 * @example
 ```ts
 class ListFilter extends ReactiveNode {
    list: Card[] = [];
    searchText = "";

    @fnMemo((self: ListFilter) => [self.searchText])
    filterBy(limit: number) {
        return this.list
            .filter((c) => c.text === this.searchText)
            .slice(0, limit);
    }

    get dependencies() { return [this.dependency(this.list)]; }
 }
 ```
 */
export function fnMemo<
    This extends ReactiveNode,
    ComparisonArgs extends unknown[] = []
>(
    getComparisons?: (
        self: This,
        ...args: FnMemoComparisonArgs<ComparisonArgs>
    ) => unknown[] | undefined
) {
    return function <
        MethodArgs extends FnMemoComparisonArgs<ComparisonArgs>,
        Value
    >(
        target: FnMemoMethod<This, MethodArgs, Value>,
        context: ClassMethodDecoratorContext<
            This,
            FnMemoMethod<This, MethodArgs, Value>
        >
    ): FnMemoMethod<This, MethodArgs, Value> {
        if (context.kind !== "method") {
            throw new Error(
                "@fnMemo can only be applied to a method on a ReactiveNode subclass."
            );
        }
        if (context.static) {
            throw new Error(
                "@fnMemo cannot be applied to a static method. It memoizes return values per ReactiveNode instance."
            );
        }
        const cacheKey = Symbol(`fnMemo:${String(context.name)}`);
        return function memoizedMethod(this: This, ...args: MethodArgs): Value {
            const comparisons = getComparisons?.(this, ...args);
            return runFnMemo(
                this,
                cacheKey,
                () => target.call(this, ...args),
                args,
                comparisons
            );
        };
    };
}
