import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    ReactiveNode,
    SELECT_GETTERS_SYMBOL,
} from "./ReactiveNode";
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
 * Do not use `@ignore` when you want a reactive pointer to another node. Use
 * {@link link} or {@link Retree.link} for that. Writes to ignored fields do
 * not emit Retree listeners or React re-renders.
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
 * Field decorator that stores a reactive pointer to another Retree-managed node
 * without making that node a structural child.
 *
 * @remarks
 * Replacing the linked field emits a normal `nodeChanged` event for the owning
 * {@link ReactiveNode}, but the assigned node keeps its existing parent. Reads
 * return the latest reproxy for the linked node.
 *
 * Use this for selected items and cross-references. Do not use it when the
 * target should become a structural child; use {@link Retree.move} /
 * {@link ReactiveNode.moveTo}. Do not use it when two places need independent
 * state; use {@link Retree.clone}.
 *
 * @example
 * ```ts
 * import { ReactiveNode, Retree, link } from "@retreejs/core";
 *
 * class EditorState extends ReactiveNode {
 *     @link public selectedTask: Task | null = null;
 *
 *     get dependencies() {
 *         return [];
 *     }
 * }
 *
 * const root = Retree.root({
 *     tasks: [new Task()],
 *     editor: new EditorState(),
 * });
 *
 * root.editor.selectedTask = root.tasks[0]; // ✅ emits on editor
 * Retree.parent(root.editor.selectedTask) === root.tasks; // true
 * ```
 */
export function link(
    _value: undefined,
    context: ClassFieldDecoratorContext
): void | ((this: ReactiveNode, value: any) => any) {
    context.addInitializer(function () {
        if (!(this instanceof ReactiveNode)) return;
        this[LINKED_KEYS_SYMBOL].add(context.name);
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
 * `@memo` is a cache, not a subscription. It does not emit Retree events or
 * trigger React renders by itself. Use `ReactiveNode.dependencies`,
 * `Retree.select`, or `useSelect` when you also need notification behavior.
 *
 * Do not use `@memo` on methods; use {@link fnMemo}. Do not use it for values
 * with side effects.
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
            // @retree-throws
            throw new Error(
                "@memo can only be applied to a getter on a ReactiveNode subclass. This is expected when @memo is placed on a field, method, setter, or non-ReactiveNode class. Fix: move @memo to a getter on a class that extends ReactiveNode, or use this.memo('key', fn, deps) for method-local caching."
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

/**
 * Decorator that makes a getter's owning {@link ReactiveNode} react to an
 * ordered dependency list.
 *
 * @remarks
 * `@select` is the class-side companion to {@link Retree.select} and
 * `useSelect`. Use it when a getter exposes a narrow value but depends on
 * broader reactive sources. Reactive dependencies in the returned list are
 * subscribed to; primitive and plain-object dependencies are compared by
 * identity. Wrap a slot with `self.dependency(node, comparisons)` when that
 * slot needs custom comparison cells. When a selected slot changes, Retree
 * reproxies the owning node and emits `nodeChanged` for that owner.
 *
 * The dependency list is ordered and should keep a stable length while the
 * node is observed. Put every value that can change the getter result in the
 * list. Use {@link memo} for expensive intermediate getters, then select the
 * memoized value here.
 *
 * @example
 * ```ts
 * class AttributeView extends ReactiveNode {
 *     public attributeId!: string;
 *
 *     @memo((self: AttributeView) => [self.attributes, self.attributeId])
 *     private get _attribute() {
 *         return this.attributes.find((check) => check.id === this.attributeId);
 *     }
 *
 *     @select((self) => [
 *         self.attributes,
 *         self.attributeId,
 *         self.dependency(self._attribute, [self._attribute?.id]),
 *     ])
 *     get attribute() {
 *         return this._attribute;
 *     }
 * }
 * ```
 */
export function select<This extends ReactiveNode, Dependencies>(
    getDependencies: (self: This) => Dependencies
) {
    return function <Value>(
        target: (this: This) => Value,
        context: ClassGetterDecoratorContext<This, Value>
    ): (this: This) => Value {
        if (context.kind !== "getter") {
            // @retree-throws
            throw new Error(
                "@select can only be applied to a getter on a ReactiveNode subclass. This is expected when @select is placed on a field, method, setter, or non-ReactiveNode class. Fix: move @select to a getter on a class that extends ReactiveNode."
            );
        }
        context.addInitializer(function () {
            if (!(this instanceof ReactiveNode)) {
                return;
            }
            this[SELECT_GETTERS_SYMBOL].set(context.name, {
                getDependencies: getDependencies as (
                    self: ReactiveNode
                ) => unknown,
            });
        });
        return function selectedGetter(this: This): Value {
            return target.call(this);
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
 * `@fnMemo` is a cache, not a subscription. It does not emit Retree events or
 * trigger React renders by itself. Keep decorated methods deterministic for
 * the same arguments and dependency values.
 *
 * Do not apply `@fnMemo` to static methods or methods that intentionally
 * perform side effects.
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
            // @retree-throws
            throw new Error(
                "@fnMemo can only be applied to a method on a ReactiveNode subclass. This is expected when @fnMemo is placed on a field, getter, setter, or non-ReactiveNode class. Fix: move @fnMemo to an instance method on a class that extends ReactiveNode."
            );
        }
        if (context.static) {
            // @retree-throws
            throw new Error(
                "@fnMemo cannot be applied to a static method. This is a decorator usage error because @fnMemo memoizes return values per ReactiveNode instance. Fix: make the method an instance method, or use your own static cache outside Retree."
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
