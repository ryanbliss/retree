import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { unstable_batchedUpdates } from "react-dom";
import { useNode } from "../useNode.js";

// Wrap (not replace) unstable_batchedUpdates so the registered flush wrapper
// stays functional while its invocations become observable.
vi.mock("react-dom", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-dom")>();
    return {
        ...actual,
        unstable_batchedUpdates: vi.fn(actual.unstable_batchedUpdates),
    };
});

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    Retree.clearListeners(node as never);
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

describe("react listener flush batching", () => {
    it("runs unstable_batchedUpdates once around a two-node transaction flush", () => {
        const batchSpy = vi.mocked(unstable_batchedUpdates);
        const root = trackRoot(Retree.root({ a: { v: 0 }, b: { v: 0 } }));
        const listener = vi.fn();
        Retree.on(root.a, "nodeChanged", listener);
        Retree.on(root.b, "nodeChanged", listener);

        batchSpy.mockClear();
        Retree.runTransaction(() => {
            root.a.v = 1;
            root.b.v = 1;
        });

        // Both node emissions flushed inside ONE wrapper pass.
        expect(listener).toHaveBeenCalledTimes(2);
        expect(batchSpy).toHaveBeenCalledTimes(1);
    });

    it("renders each of two dual-subscribed components once for one transaction", () => {
        const root = trackRoot(Retree.root({ a: { v: 0 }, b: { v: 0 } }));
        let firstRenders = 0;
        let secondRenders = 0;

        function First() {
            firstRenders += 1;
            const a = useNode(root.a);
            const b = useNode(root.b);
            return <div data-testid="first">{a.v + b.v}</div>;
        }

        function Second() {
            secondRenders += 1;
            const a = useNode(root.a);
            const b = useNode(root.b);
            return <div data-testid="second">{a.v * 10 + b.v}</div>;
        }

        render(
            <>
                <First />
                <Second />
            </>
        );
        const firstBaseline = firstRenders;
        const secondBaseline = secondRenders;

        act(() => {
            Retree.runTransaction(() => {
                root.a.v = 1;
                root.b.v = 2;
            });
        });

        expect(screen.getByTestId("first").textContent).toBe("3");
        expect(screen.getByTestId("second").textContent).toBe("12");
        expect(firstRenders).toBe(firstBaseline + 1);
        expect(secondRenders).toBe(secondBaseline + 1);
    });
});
