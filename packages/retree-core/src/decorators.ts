import {
    COLLECTED_KEYS_SYMBOL,
    LINKED_KEYS_SYMBOL,
    IReactiveSelectGetter,
    ReactiveNode,
    SELECT_GETTERS_SYMBOL,
} from "./ReactiveNode";
import { collectDependencyAccesses } from "./internals/dependency-tracking";
import {
    runFnMemo,
    runMemo,
    runTrappedFnMemo,
    runTrappedMemo,
} from "./internals/memo";
import { Retree } from "./Retree";

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
 * Use `@memo` or `@memo()` for automatic dependency trapping. Pass a function
 * only when you want finer cache-key control; the function captures `this`
 * lazily, so the values are read fresh each time the getter is accessed.
 *
 * Cache semantics (matches {@link ReactiveNode.memo}):
 * - No argument: `@memo` and `@memo()` are interchangeable. Both run the
 *   getter under automatic dependency trapping and recompute when one of the
 *   trapped reads changes.
 * - Returns `undefined`: recompute on every reproxy of the ReactiveNode.
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

    @memo
    get filteredList() {
        return this.list.filter((c) => c.text === this.searchText);
    }

    get dependencies() { return [this.dependency(this.list)]; }
 }
 ```
 *
 * Pass explicit comparisons when the automatic trapper is broader than you want:
 *
 ```ts
    @memo((self: ListFilter) => [self.list, self.searchText])
    get filteredListWithExplicitComparisons() {
        return this.list.filter((c) => c.text === this.searchText);
    }
 ```
 */
export function memo<This extends ReactiveNode, Value>(
    target: (this: This) => Value,
    context: ClassGetterDecoratorContext<This, Value>
): (this: This) => Value;
// eslint-disable-next-line no-redeclare
export function memo<This extends ReactiveNode>(
    getComparisons?: (self: This) => unknown[] | undefined
): <Value>(
    target: (this: This) => Value,
    context: ClassGetterDecoratorContext<This, Value>
) => (this: This) => Value;
// eslint-disable-next-line no-redeclare
export function memo(
    targetOrGetComparisons?: unknown,
    context?: ClassGetterDecoratorContext<ReactiveNode, unknown>
) {
    if (context !== undefined) {
        if (!isDecoratorFunction(targetOrGetComparisons)) {
            // @retree-throws
            throw new Error(
                "@memo could not find the decorated getter function. This is unexpected and is likely a Retree bug. Fix: report this error with the decorated getter name and TypeScript version."
            );
        }
        return decorateMemoGetter(targetOrGetComparisons, context);
    }
    return function (
        target: (this: ReactiveNode) => unknown,
        decoratorContext: ClassGetterDecoratorContext<ReactiveNode, unknown>
    ): (this: ReactiveNode) => unknown {
        if (targetOrGetComparisons === undefined) {
            return decorateMemoGetter(target, decoratorContext);
        }
        if (!isComparisonFunction(targetOrGetComparisons)) {
            // @retree-throws
            throw new Error(
                "@memo dependencies must be a function when @memo is called as @memo(...). This is expected when a non-function value is passed to @memo. Fix: pass a selector like @memo((self) => [self.items]) or use @memo with no arguments for automatic dependency trapping."
            );
        }
        return decorateMemoGetter(
            target,
            decoratorContext,
            targetOrGetComparisons
        );
    };
}

function decorateMemoGetter<This extends ReactiveNode, Value>(
    target: (this: This) => Value,
    context: ClassGetterDecoratorContext<This, Value>,
    getComparisons?: (self: This) => unknown[] | undefined
): (this: This) => Value {
    if (context.kind !== "getter") {
        // @retree-throws
        throw new Error(
            "@memo can only be applied to a getter on a ReactiveNode subclass. This is expected when @memo is placed on a field, method, setter, or non-ReactiveNode class. Fix: move @memo to a getter on a class that extends ReactiveNode, or use this.memo('key', fn, deps) for method-local caching."
        );
    }
    const cacheKey = context.name;
    return function memoizedGetter(this: This): Value {
        if (getComparisons === undefined) {
            return runTrappedMemo(this, cacheKey, () => target.call(this));
        }
        const comparisons = getComparisons(this);
        return runMemo(this, cacheKey, () => target.call(this), comparisons);
    };
}

/**
 * Decorator that makes a getter's owning {@link ReactiveNode} react to an
 * ordered dependency list.
 *
 * @remarks
 * `@select` is the class-side companion to {@link Retree.select} and
 * `useSelect`. Use it when a getter exposes a narrow value but depends on
 * broader reactive sources. When called with no selector, `@select` and
 * `@select()` are interchangeable. Both run the getter under a dependency
 * trapper. Whole Retree-managed values read by the getter are subscribed to
 * broadly. Property reads subscribe to the owner node but compare the specific
 * property value, so `task.isCompleted` can update when the task slot is
 * replaced or `isCompleted` changes without reacting to unrelated `task.text`
 * changes. Primitive values read by the getter are compared.
 * Pass an explicit selector when you want to choose or customize the dependency
 * slots yourself. Wrap a slot with `self.dependency(node, comparisons)` when
 * that slot needs custom comparison cells. When a selected slot changes,
 * Retree reproxies the owning node and emits `nodeChanged` for that owner.
 *
 * The dependency list is ordered and may change length at runtime. Retree
 * treats additions, removals, and reordering as invalidation and refreshes the
 * underlying subscriptions. Put every value that can change the getter result
 * in the list. Use {@link memo} for expensive intermediate getters, then
 * select the memoized value here.
 *
 * @example
 * ```ts
 * class AttributeView extends ReactiveNode {
 *     public attributeId!: string;
 *
 *     @memo
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
 *
 * @example
 * ```ts
 * class TaskRow extends ReactiveNode {
 *     @link public task!: Task;
 *     @link public filter!: TaskFilter;
 *
 *     @select
 *     get isVisible() {
 *         return (
 *             this.filter.isComplete === null ||
 *             this.task.isCompleted === this.filter.isComplete
 *         );
 *     }
 * }
 * ```
 */

export function select<This extends ReactiveNode, Value>(
    target: (this: This) => Value,
    context: ClassGetterDecoratorContext<This, Value>
): (this: This) => Value;
// eslint-disable-next-line no-redeclare
export function select<This extends ReactiveNode, Dependencies>(
    getDependencies?: (self: This) => Dependencies
): <Value>(
    target: (this: This) => Value,
    context: ClassGetterDecoratorContext<This, Value>
) => (this: This) => Value;
// eslint-disable-next-line no-redeclare
export function select(
    targetOrGetDependencies?: unknown,
    context?: ClassGetterDecoratorContext<ReactiveNode, unknown>
) {
    if (context !== undefined) {
        if (!isDecoratorFunction(targetOrGetDependencies)) {
            // @retree-throws
            throw new Error(
                "@select could not find the decorated getter function. This is unexpected and is likely a Retree bug. Fix: report this error with the decorated getter name and TypeScript version."
            );
        }
        return decorateSelectGetter(targetOrGetDependencies, context);
    }
    return function selectedGetterDecorator(
        target: (this: ReactiveNode) => unknown,
        decoratorContext: ClassGetterDecoratorContext<ReactiveNode, unknown>
    ): (this: ReactiveNode) => unknown {
        if (targetOrGetDependencies === undefined) {
            return decorateSelectGetter(target, decoratorContext);
        }
        if (!isDependencyFunction(targetOrGetDependencies)) {
            // @retree-throws
            throw new Error(
                "@select dependencies must be a function when @select is called as @select(...). This is expected when a non-function value is passed to @select. Fix: pass a selector like @select((self) => [self.items]) or use @select with no arguments for automatic dependency trapping."
            );
        }
        return decorateSelectGetter(
            target,
            decoratorContext,
            targetOrGetDependencies
        );
    };
}

function isDecoratorFunction(
    value: unknown
): value is (this: ReactiveNode) => unknown {
    return typeof value === "function";
}

function isDependencyFunction(
    value: unknown
): value is (self: ReactiveNode) => unknown {
    return typeof value === "function";
}

function isComparisonFunction(
    value: unknown
): value is (self: ReactiveNode, ...args: unknown[]) => unknown[] | undefined {
    return typeof value === "function";
}

function decorateSelectGetter<This extends ReactiveNode, Value, Dependencies>(
    target: ((this: This) => Value) | undefined,
    context: ClassGetterDecoratorContext<This, Value>,
    getDependencies?: (self: This) => Dependencies
): (this: This) => Value {
    if (target === undefined) {
        // @retree-throws
        throw new Error(
            "@select could not find the decorated getter function. This is unexpected and is likely a Retree bug. Fix: report this error with the decorated getter name and TypeScript version."
        );
    }
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
        const selectGetter: IReactiveSelectGetter =
            getDependencies === undefined
                ? {
                      getDependencies: (self: ReactiveNode) =>
                          collectDependencyAccesses(() =>
                              target.call(self as This)
                          ),
                      getValue: (self: ReactiveNode) =>
                          target.call(self as This),
                      compareValueBeforeNotify: true,
                  }
                : {
                      getDependencies: getDependencies as (
                          self: ReactiveNode
                      ) => unknown,
                      getValue: (self: ReactiveNode) =>
                          target.call(self as This),
                      compareValueBeforeNotify: false,
                  };
        this[SELECT_GETTERS_SYMBOL].set(context.name, selectGetter);
    });
    return function selectedGetter(this: This): Value {
        return target.call(this);
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
 * Use `@fnMemo` or `@fnMemo()` for automatic dependency trapping. Pass a
 * function only when you want finer cache-key control; the function receives
 * the current instance and method arguments, so the values are read fresh each
 * time the method is called. The method arguments are always shallow-compared.
 *
 * Cache semantics:
 * - No argument: `@fnMemo` and `@fnMemo()` are interchangeable. Both run the
 *   method under automatic dependency trapping and recompute when the arguments
 *   or one of the trapped reads changes.
 * - Returns `undefined`: recompute when the arguments change, or on every
 *   reproxy of the ReactiveNode.
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

    @fnMemo
    filterBy(limit: number) {
        return this.list
            .filter((c) => c.text === this.searchText)
            .slice(0, limit);
    }

    get dependencies() { return [this.dependency(this.list)]; }
 }
 ```
 *
 * Pass explicit comparisons when the automatic trapper is broader than you want:
 *
 ```ts
    @fnMemo((self: ListFilter, limit: number) => [
        self.list,
        self.searchText,
        limit,
    ])
    filterByWithExplicitComparisons(limit: number) {
        return this.list
            .filter((c) => c.text === this.searchText)
            .slice(0, limit);
    }
 ```
 */
export function fnMemo<
    This extends ReactiveNode,
    MethodArgs extends unknown[],
    Value
>(
    target: FnMemoMethod<This, MethodArgs, Value>,
    context: ClassMethodDecoratorContext<
        This,
        FnMemoMethod<This, MethodArgs, Value>
    >
): FnMemoMethod<This, MethodArgs, Value>;
// eslint-disable-next-line no-redeclare
export function fnMemo<
    This extends ReactiveNode,
    ComparisonArgs extends unknown[] = []
>(
    getComparisons?: (
        self: This,
        ...args: FnMemoComparisonArgs<ComparisonArgs>
    ) => unknown[] | undefined
): <MethodArgs extends FnMemoComparisonArgs<ComparisonArgs>, Value>(
    target: FnMemoMethod<This, MethodArgs, Value>,
    context: ClassMethodDecoratorContext<
        This,
        FnMemoMethod<This, MethodArgs, Value>
    >
) => FnMemoMethod<This, MethodArgs, Value>;
// eslint-disable-next-line no-redeclare
export function fnMemo(
    targetOrGetComparisons?: unknown,
    context?: ClassMethodDecoratorContext<
        ReactiveNode,
        FnMemoMethod<ReactiveNode, unknown[], unknown>
    >
) {
    if (context !== undefined) {
        if (!isDecoratorFunction(targetOrGetComparisons)) {
            // @retree-throws
            throw new Error(
                "@fnMemo could not find the decorated method function. This is unexpected and is likely a Retree bug. Fix: report this error with the decorated method name and TypeScript version."
            );
        }
        return decorateFnMemoMethod(targetOrGetComparisons, context);
    }
    return function <MethodArgs extends unknown[], Value>(
        target: FnMemoMethod<ReactiveNode, MethodArgs, Value>,
        context: ClassMethodDecoratorContext<
            ReactiveNode,
            FnMemoMethod<ReactiveNode, MethodArgs, Value>
        >
    ): FnMemoMethod<ReactiveNode, MethodArgs, Value> {
        if (targetOrGetComparisons === undefined) {
            return decorateFnMemoMethod(target, context);
        }
        if (!isComparisonFunction(targetOrGetComparisons)) {
            // @retree-throws
            throw new Error(
                "@fnMemo dependencies must be a function when @fnMemo is called as @fnMemo(...). This is expected when a non-function value is passed to @fnMemo. Fix: pass a selector like @fnMemo((self, arg) => [self.items, arg]) or use @fnMemo with no arguments for automatic dependency trapping."
            );
        }
        return decorateFnMemoMethod(target, context, targetOrGetComparisons);
    };
}

function decorateFnMemoMethod<
    This extends ReactiveNode,
    MethodArgs extends unknown[],
    Value
>(
    target: FnMemoMethod<This, MethodArgs, Value>,
    context: ClassMethodDecoratorContext<
        This,
        FnMemoMethod<This, MethodArgs, Value>
    >,
    getComparisons?: (self: This, ...args: MethodArgs) => unknown[] | undefined
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
        if (getComparisons === undefined) {
            return runTrappedFnMemo(
                this,
                cacheKey,
                () => target.call(this, ...args),
                args
            );
        }
        const comparisons = getComparisons(this, ...args);
        return runFnMemo(
            this,
            cacheKey,
            () => target.call(this, ...args),
            args,
            comparisons
        );
    };
}
