/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { ignore, ReactiveNode, Retree } from "@retreejs/core";
import { notifyNodeDisposed } from "./internals/disposal.js";
import { ConvexAuthState, IConvexAuthClient } from "./types.js";

/**
 * Reactive node that tracks a Convex client's authentication state — the
 * Retree equivalent of Convex React's `useConvexAuth`.
 *
 * @remarks
 * Convex clients surface auth changes only through the `onChange` callback of
 * `setAuth`, so this node consumes the {@link IConvexAuthClient} surface
 * implemented by adapter clients such as `RetreeConvexReactClient` in
 * `@retreejs/react-convex`, which interpose on `setAuth`/`clearAuth` to make
 * auth observable.
 *
 * Auth changes update `state`, which emits through Retree while the node is
 * observed. Dispose the node when its owner is torn down.
 *
 * @example
 * ```ts
 * const auth = Retree.root(new ConvexAuthStateNode(client));
 * Retree.on(auth, "nodeChanged", (next) => {
 *     console.log(next.isLoading, next.isAuthenticated);
 * });
 * ```
 */
export class ConvexAuthStateNode extends ReactiveNode {
    @ignore
    private readonly client: IConvexAuthClient;
    @ignore
    private unsubscribe: (() => void) | null = null;

    /**
     * Latest Convex authentication state.
     */
    public state: ConvexAuthState;

    /**
     * Create a node for Convex authentication state.
     *
     * @remarks
     * The node reads the initial auth state immediately. It subscribes to
     * future auth-state updates when Retree observes it.
     *
     * @param client Convex client adapter exposing observable auth state.
     */
    constructor(client: IConvexAuthClient) {
        super();
        this.client = client;
        this.state = client.authState();
    }

    get dependencies() {
        return [];
    }

    /**
     * True while an auth token change started by `setAuth` is awaiting server
     * confirmation.
     */
    public get isLoading(): boolean {
        return this.state.isLoading;
    }

    /**
     * True once the Convex server has validated the current credentials.
     */
    public get isAuthenticated(): boolean {
        return this.state.isAuthenticated;
    }

    protected onObserved(): void {
        if (this.unsubscribe !== null) {
            return;
        }

        this.unsubscribe = this.client.subscribeToAuthState((authState) => {
            Retree.runTransaction(() => {
                this.state = authState;
            });
        });
    }

    protected onUnobserved(): void {
        this.dispose();
    }

    /**
     * Stop listening to Convex auth-state changes.
     *
     * @remarks
     * Retree calls this automatically when the node loses its last active
     * observer, and the node resubscribes when observed again. Call it
     * manually when tearing the owner down outside Retree observation.
     * Disposing stops future updates; it does not clear the last `state`.
     *
     * @example
     * ```ts
     * public dispose() {
     *     this.auth.dispose();
     * }
     * ```
     */
    public dispose(): void {
        notifyNodeDisposed(this);
        if (this.unsubscribe === null) {
            return;
        }

        this.unsubscribe();
        this.unsubscribe = null;
    }
}
