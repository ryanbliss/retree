/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

"use client";

import {
    createContext,
    createElement,
    ReactElement,
    ReactNode,
    useContext,
    useRef,
} from "react";

/**
 * Props for a provider returned by {@link createRetreeContext} (including the
 * default {@link RetreeProvider}).
 */
export interface RetreeProviderProps<T> {
    /**
     * Factory that builds the container of Retree roots for this provider
     * instance. Runs exactly once per mounted provider (like `useRoot`
     * semantics), including under React Strict Mode.
     *
     * Call `Retree.root(...)` inside the factory for each root the container
     * holds; the provider does not wrap the container for you.
     */
    create: () => T;
    children?: ReactNode;
}

/**
 * A typed pair of `Provider` and `useRootContext` created by
 * {@link createRetreeContext}. The container type `T` flows from the factory
 * call to every `useRootContext()` call site with no casts.
 */
export interface RetreeContext<T> {
    /**
     * Provides the container returned by `create` to every descendant
     * component. `create` runs once per provider instance.
     */
    Provider: (props: RetreeProviderProps<T>) => ReactElement;
    /**
     * Returns the container provided by the nearest matching `Provider`
     * above the calling component. Throws when no such provider exists.
     */
    useRootContext: () => T;
}

/**
 * Wrapper object stored in the React context. The container itself is never
 * stored directly so that `undefined` unambiguously means "no provider
 * above" — a container of `undefined`/`null` still gets a box.
 */
interface RootContainerBox<T> {
    readonly container: T;
}

/**
 * Create a typed `Provider` + `useRootContext` pair for a per-tree container
 * of Retree roots.
 *
 * @remarks
 * Module-singleton roots (`const app = Retree.root(...)` at module scope) are
 * shared by everything that imports the module. That is often what you want
 * in a client-only app — but in SSR frameworks (Next.js, Remix) module state
 * is shared **across requests** on the server, so one user's writes leak into
 * another user's render. It also makes tests share state unless every test
 * carefully resets the module. Provider-created roots solve both: the
 * `create` factory runs once per mounted provider, so each server request
 * (and each test render) gets its own container of roots.
 *
 * Prefer this factory over the default {@link RetreeProvider} /
 * {@link useRootContext} pair when you want the container type to flow
 * without a type argument at every call site: the `T` you create the context
 * with is the `T` every `useRootContext()` returns.
 *
 * The returned `Provider` is a client component (`"use client"`), so it can
 * be rendered from a server component but its `create` factory runs in the
 * client/SSR render pass, not in React Server Components.
 *
 * @param name Optional display name used in React DevTools and in the
 * missing-provider error message. Defaults to `"RetreeProvider"`.
 * @returns A {@link RetreeContext} with `Provider` and `useRootContext`
 * bound to `T`.
 *
 * @example
 * ```tsx
 * import { Retree } from "@retreejs/core";
 * import { createRetreeContext } from "@retreejs/react";
 *
 * class AppState {
 *     count = 0;
 * }
 *
 * function createRoots() {
 *     return { app: Retree.root(new AppState()) };
 * }
 *
 * const { Provider: AppProvider, useRootContext: useAppRoots } =
 *     createRetreeContext<ReturnType<typeof createRoots>>("AppProvider");
 *
 * function Counter() {
 *     const { app } = useAppRoots(); // typed — no cast, no type argument
 *     const state = useNode(app);
 *     return <button onClick={() => (state.count += 1)}>{state.count}</button>;
 * }
 *
 * export function App() {
 *     return (
 *         <AppProvider create={createRoots}>
 *             <Counter />
 *         </AppProvider>
 *     );
 * }
 * ```
 */
export function createRetreeContext<T>(
    name: string = "RetreeProvider"
): RetreeContext<T> {
    const Context = createContext<RootContainerBox<T> | undefined>(undefined);
    Context.displayName = name;

    function Provider(props: RetreeProviderProps<T>): ReactElement {
        // `useRef` + null check runs `create` exactly once per provider
        // instance, surviving Strict Mode's double render invocation. See
        // useRoot.ts for why useRef is the only init primitive with this
        // guarantee.
        const boxRef = useRef<RootContainerBox<T> | null>(null);
        if (boxRef.current === null) {
            boxRef.current = { container: props.create() };
        }
        return createElement(
            Context.Provider,
            { value: boxRef.current },
            props.children
        );
    }

    function useRootContext(): T {
        const box = useContext(Context);
        if (box === undefined) {
            throw new Error(
                `useRootContext: no ${name} was found above the component calling useRootContext. Fix: wrap this component in <${name} create={() => ...}>, and make sure the useRootContext being called came from the same createRetreeContext(...) result as the provider.`
            );
        }
        return box.container;
    }

    return { Provider, useRootContext };
}

const defaultRetreeContext = createRetreeContext<unknown>("RetreeProvider");

/**
 * Default untyped provider for a per-tree container of Retree roots.
 *
 * @remarks
 * `create` runs exactly once per mounted provider instance (like `useRoot`
 * semantics), so each server request in an SSR app — and each test render —
 * gets its own roots instead of sharing module singletons. See
 * {@link createRetreeContext} for the full SSR rationale.
 *
 * This default pair stores the container untyped; pair it with
 * {@link useRootContext} and a type argument. When you want the container
 * type to flow with no type arguments, create a dedicated context with
 * {@link createRetreeContext} instead.
 *
 * @example
 * ```tsx
 * import { Retree } from "@retreejs/core";
 * import { RetreeProvider, useRootContext, useNode } from "@retreejs/react";
 *
 * const createRoots = () => ({ counter: Retree.root({ count: 0 }) });
 *
 * function Counter() {
 *     const { counter } = useRootContext<ReturnType<typeof createRoots>>();
 *     const state = useNode(counter);
 *     return <button onClick={() => (state.count += 1)}>{state.count}</button>;
 * }
 *
 * export function App() {
 *     return (
 *         <RetreeProvider create={createRoots}>
 *             <Counter />
 *         </RetreeProvider>
 *     );
 * }
 * ```
 */
export const RetreeProvider: (
    props: RetreeProviderProps<unknown>
) => ReactElement = defaultRetreeContext.Provider;

/**
 * Returns the container provided by the nearest {@link RetreeProvider} above
 * the calling component.
 *
 * @remarks
 * The default provider stores the container untyped, so the type argument is
 * asserted by the caller — TypeScript cannot verify it against the `create`
 * factory. Keep the type argument next to the factory (as in the example) or,
 * better, use {@link createRetreeContext} for a dedicated context whose
 * container type is inferred at every call site.
 *
 * @returns The container created by the nearest `RetreeProvider`'s `create`
 * factory.
 * @throws When no `RetreeProvider` is mounted above the calling component.
 *
 * @example
 * ```tsx
 * const roots = useRootContext<{ counter: { count: number } }>();
 * ```
 */
export function useRootContext<T = unknown>(): T {
    // Caller-asserted type: a single shared React context cannot carry a
    // per-call-site type, which is exactly why createRetreeContext exists.
    return defaultRetreeContext.useRootContext() as T;
}
