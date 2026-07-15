import { describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { ConvexAuthStateNode } from "./ConvexAuthStateNode.js";
import { ConvexAuthState, IConvexAuthClient } from "./types.js";

class FakeAuthClient implements IConvexAuthClient {
    public readonly listeners = new Set<(authState: ConvexAuthState) => void>();
    public readonly unsubscribe = vi.fn();
    private currentState: ConvexAuthState = {
        isLoading: false,
        isAuthenticated: false,
    };

    public authState(): ConvexAuthState {
        return this.currentState;
    }

    public subscribeToAuthState(
        callback: (authState: ConvexAuthState) => void
    ): () => void {
        this.listeners.add(callback);
        return () => {
            this.unsubscribe();
            this.listeners.delete(callback);
        };
    }

    public emit(next: ConvexAuthState): void {
        this.currentState = next;
        for (const listener of [...this.listeners]) {
            listener(next);
        }
    }
}

describe("ConvexAuthStateNode", () => {
    it("reads the initial auth state and exposes convenience getters", () => {
        const client = new FakeAuthClient();
        const node = Retree.root(new ConvexAuthStateNode(client));

        expect(node.state).toEqual({
            isLoading: false,
            isAuthenticated: false,
        });
        expect(node.isLoading).toBe(false);
        expect(node.isAuthenticated).toBe(false);
    });

    it("subscribes when observed and emits auth state changes through Retree", () => {
        const client = new FakeAuthClient();
        const node = Retree.root(new ConvexAuthStateNode(client));
        expect(client.listeners.size).toBe(0);

        const nodeChanged = vi.fn();
        Retree.on(node, "nodeChanged", nodeChanged);
        expect(client.listeners.size).toBe(1);

        client.emit({ isLoading: true, isAuthenticated: false });
        expect(node.isLoading).toBe(true);
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        client.emit({ isLoading: false, isAuthenticated: true });
        expect(node.isLoading).toBe(false);
        expect(node.isAuthenticated).toBe(true);
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    it("unsubscribes when the last observer leaves and resubscribes when observed again", () => {
        const client = new FakeAuthClient();
        const node = Retree.root(new ConvexAuthStateNode(client));

        const unsubscribe = Retree.on(node, "nodeChanged", () => undefined);
        expect(client.listeners.size).toBe(1);

        unsubscribe();
        expect(client.unsubscribe).toHaveBeenCalledOnce();
        expect(client.listeners.size).toBe(0);

        Retree.on(node, "nodeChanged", () => undefined);
        expect(client.listeners.size).toBe(1);
    });

    it("stops listening after a manual dispose", () => {
        const client = new FakeAuthClient();
        const node = Retree.root(new ConvexAuthStateNode(client));
        Retree.on(node, "nodeChanged", () => undefined);

        node.dispose();

        expect(client.unsubscribe).toHaveBeenCalledOnce();
        expect(client.listeners.size).toBe(0);
        // Disposal keeps the last state readable.
        expect(node.state).toEqual({
            isLoading: false,
            isAuthenticated: false,
        });
    });
});
