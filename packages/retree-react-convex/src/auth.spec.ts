import { describe, expect, it, vi } from "vitest";
import { ConvexReactClient } from "convex/react";
import { Retree } from "@retreejs/core";
import { ConvexAuthStateNode, type ConvexAuthState } from "@retreejs/convex";
import { RetreeConvexReactClient } from "./index.js";

/**
 * Intercept ConvexReactClient.prototype.setAuth so tests can drive the
 * `onChange` callback (the only auth-state signal Convex exposes) without
 * opening a websocket. `super.setAuth` inside RetreeConvexReactClient
 * resolves through the prototype at call time, so the spy receives the
 * wrapped callback.
 */
function installAuthSpies() {
    const onChangeCallbacks: ((isAuthenticated: boolean) => void)[] = [];
    const setAuth = vi
        .spyOn(ConvexReactClient.prototype, "setAuth")
        .mockImplementation((_fetchToken, onChange) => {
            if (onChange !== undefined) {
                onChangeCallbacks.push(onChange);
            }
        });
    const clearAuth = vi
        .spyOn(ConvexReactClient.prototype, "clearAuth")
        .mockImplementation(() => undefined);
    return { onChangeCallbacks, setAuth, clearAuth };
}

const fetchToken = () => Promise.resolve("jwt-token");

describe("RetreeConvexReactClient auth state", () => {
    it("starts unauthenticated and not loading", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");

        expect(client.authState()).toEqual({
            isLoading: false,
            isAuthenticated: false,
        });
    });

    it("tracks setAuth through loading to the server-confirmed state", () => {
        const { onChangeCallbacks, setAuth } = installAuthSpies();
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const seen: ConvexAuthState[] = [];
        client.subscribeToAuthState((authState) => {
            seen.push(authState);
        });

        client.setAuth(fetchToken);
        expect(setAuth).toHaveBeenCalledOnce();
        expect(client.authState()).toEqual({
            isLoading: true,
            isAuthenticated: false,
        });

        onChangeCallbacks[0](true);
        expect(client.authState()).toEqual({
            isLoading: false,
            isAuthenticated: true,
        });
        expect(seen).toEqual([
            { isLoading: true, isAuthenticated: false },
            { isLoading: false, isAuthenticated: true },
        ]);
    });

    it("reports rejected credentials as not loading and not authenticated", () => {
        const { onChangeCallbacks } = installAuthSpies();
        const client = new RetreeConvexReactClient("https://test.convex.cloud");

        client.setAuth(fetchToken);
        onChangeCallbacks[0](false);

        expect(client.authState()).toEqual({
            isLoading: false,
            isAuthenticated: false,
        });
    });

    it("still calls a caller-provided onChange callback", () => {
        const { onChangeCallbacks } = installAuthSpies();
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const onChange = vi.fn();

        client.setAuth(fetchToken, onChange);
        onChangeCallbacks[0](true);

        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("resets auth state on clearAuth and notifies subscribers once per change", () => {
        const { onChangeCallbacks, clearAuth } = installAuthSpies();
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const listener = vi.fn();
        client.subscribeToAuthState(listener);

        client.setAuth(fetchToken);
        onChangeCallbacks[0](true);
        client.clearAuth();

        expect(clearAuth).toHaveBeenCalledOnce();
        expect(client.authState()).toEqual({
            isLoading: false,
            isAuthenticated: false,
        });
        expect(listener).toHaveBeenCalledTimes(3);

        // A redundant clearAuth changes nothing and must not notify.
        client.clearAuth();
        expect(listener).toHaveBeenCalledTimes(3);
    });

    it("supports unsubscribing auth listeners", () => {
        const { onChangeCallbacks } = installAuthSpies();
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const listener = vi.fn();
        const unsubscribe = client.subscribeToAuthState(listener);

        unsubscribe();
        client.setAuth(fetchToken);
        onChangeCallbacks[0](true);

        expect(listener).not.toHaveBeenCalled();
    });

    it("drives a ConvexAuthStateNode reactively", () => {
        const { onChangeCallbacks } = installAuthSpies();
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const node = Retree.root(new ConvexAuthStateNode(client));
        const nodeChanged = vi.fn();
        Retree.on(node, "nodeChanged", nodeChanged);

        client.setAuth(fetchToken);
        expect(node.isLoading).toBe(true);
        expect(node.isAuthenticated).toBe(false);

        onChangeCallbacks[0](true);
        expect(node.isLoading).toBe(false);
        expect(node.isAuthenticated).toBe(true);
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });
});
