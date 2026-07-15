/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Options passed to {@link IReduxDevToolsExtension.connect}.
 *
 * @remarks
 * A minimal structural slice of the Redux DevTools Extension connect options
 * — only the fields `@retreejs/devtools` sends. See
 * https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md
 * for the full protocol.
 */
export interface IReduxDevToolsConnectOptions {
    /**
     * Instance name shown in the extension's instance selector.
     */
    name: string;
    /**
     * Maximum number of actions the extension retains before dropping the
     * oldest. Omitted when the caller did not set one, letting the extension
     * apply its own default.
     */
    maxAge?: number;
}

/**
 * An action dispatched to the Redux DevTools Extension.
 */
export interface IReduxDevToolsAction {
    /**
     * Action type shown in the extension's action list.
     */
    type: string;
    /**
     * Structured description of the change, shown in the extension's action
     * inspector.
     */
    payload?: unknown;
}

/**
 * A connected Redux DevTools Extension instance, as returned by
 * {@link IReduxDevToolsExtension.connect}.
 */
export interface IReduxDevToolsInstance {
    /**
     * Report the initial state.
     */
    init(state: unknown): void;
    /**
     * Report one action and the state after it.
     */
    send(action: IReduxDevToolsAction, state: unknown): void;
    /**
     * Subscribe to messages from the extension (time-travel dispatches and
     * monitor actions). Optional in the protocol; some environments provide
     * an instance without it. Returns an unsubscribe function when the
     * implementation supports one.
     */
    subscribe?(listener: (message: unknown) => void): (() => void) | undefined;
    /**
     * Remove every listener registered on this instance.
     */
    unsubscribe?(): void;
}

/**
 * The Redux DevTools Extension global, `window.__REDUX_DEVTOOLS_EXTENSION__`.
 */
export interface IReduxDevToolsExtension {
    connect(options: IReduxDevToolsConnectOptions): IReduxDevToolsInstance;
}

/**
 * Type guard for the Redux DevTools Extension global.
 *
 * @remarks
 * Structural: the extension global is injected by a browser extension, so
 * the only meaningful check is that it exposes a callable `connect`.
 */
function isReduxDevToolsExtension(
    value: unknown
): value is IReduxDevToolsExtension {
    if (value === null) {
        return false;
    }
    if (typeof value !== "object" && typeof value !== "function") {
        return false;
    }
    const connect: unknown = Reflect.get(value, "connect");
    return typeof connect === "function";
}

/**
 * Resolve the Redux DevTools Extension global, if it is installed.
 *
 * @returns The extension, or `undefined` when it is absent (no extension
 * installed, or a non-browser runtime).
 */
export function getReduxDevToolsExtension():
    | IReduxDevToolsExtension
    | undefined {
    const candidate: unknown = Reflect.get(
        globalThis,
        "__REDUX_DEVTOOLS_EXTENSION__"
    );
    if (!isReduxDevToolsExtension(candidate)) {
        return undefined;
    }
    return candidate;
}
