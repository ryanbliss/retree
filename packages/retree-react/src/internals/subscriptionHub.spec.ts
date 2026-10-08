/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { ReactiveNode, Retree } from "@retreejs/core";
import { subscribeToNode } from "./subscriptionHub.js";

class LifecycleNode extends ReactiveNode {
    public count = 0;
    public observed = 0;
    public unobserved = 0;
    get dependencies() {
        return [];
    }
    protected onObserved(): void {
        this.observed++;
    }
    protected onUnobserved(): void {
        this.unobserved++;
    }
}

describe("subscriptionHub", () => {
    it("defers a ReactiveNode teardown so a same-tick resubscribe keeps it observed", async () => {
        const node = Retree.root(new LifecycleNode());
        const listener = vi.fn();
        subscribeToNode(node, "nodeChanged", vi.fn())();
        subscribeToNode(node, "nodeChanged", vi.fn())();
        const unsubscribe = subscribeToNode(node, "nodeChanged", listener);
        await Promise.resolve();

        expect(node.observed).toBe(1);
        expect(node.unobserved).toBe(0);
        node.count = 1;
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        expect(node.unobserved).toBe(0);
        await Promise.resolve();
        expect(node.unobserved).toBe(1);

        subscribeToNode(node, "nodeChanged", vi.fn())();
        await Promise.resolve();
        expect(node.observed).toBe(2);
        expect(node.unobserved).toBe(2);
    });

    it("does not remove another listener when unsubscribe is called twice", () => {
        const root = Retree.root({ count: 0 });
        const listenerA = vi.fn();
        const listenerB = vi.fn();
        const unsubscribeA = subscribeToNode(root, "nodeChanged", listenerA);
        const unsubscribeB = subscribeToNode(root, "nodeChanged", listenerB);

        unsubscribeA();
        unsubscribeA();

        root.count = 1;
        expect(listenerA).not.toHaveBeenCalled();
        expect(listenerB).toHaveBeenCalledTimes(1);

        unsubscribeB();
    });

    it("keeps the hub alive for a subscription made after a stale double-unsubscribe", () => {
        // Regression: a second unsubscribe call used to re-run the teardown
        // path, calling hub.unsubscribeRetree() out from under a newer
        // subscription that reused the same hub maps.
        const root = Retree.root({ count: 0 });
        const listenerA = vi.fn();
        const listenerB = vi.fn();
        const unsubscribeA = subscribeToNode(root, "nodeChanged", listenerA);
        unsubscribeA();

        const unsubscribeB = subscribeToNode(root, "nodeChanged", listenerB);
        unsubscribeA();

        root.count = 1;
        expect(listenerB).toHaveBeenCalledTimes(1);

        unsubscribeB();
    });

    it("ref-counts the same callback subscribed twice", () => {
        // Regression: listeners lived in a Set, so the same callback
        // subscribed twice collapsed to one entry and the first unsubscribe
        // killed both subscriptions.
        const root = Retree.root({ count: 0 });
        const listener = vi.fn();
        const unsubscribeFirst = subscribeToNode(root, "nodeChanged", listener);
        const unsubscribeSecond = subscribeToNode(
            root,
            "nodeChanged",
            listener
        );

        unsubscribeFirst();

        root.count = 1;
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribeSecond();

        root.count = 2;
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("invokes a double-subscribed callback once per notification", () => {
        const root = Retree.root({ count: 0 });
        const listener = vi.fn();
        const unsubscribeFirst = subscribeToNode(root, "nodeChanged", listener);
        const unsubscribeSecond = subscribeToNode(
            root,
            "nodeChanged",
            listener
        );

        root.count = 1;
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribeFirst();
        unsubscribeSecond();
    });
});
