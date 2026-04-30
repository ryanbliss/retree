import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import { useNode } from "./useNode";
import { useTree } from "./useTree";

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

describe("React transaction behavior", () => {
    it("collapses multiple useNode updates inside a transaction to one rerender", () => {
        const root = trackRoot(Retree.use({ count: 0 }));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return <div data-testid="value">{state.count}</div>;
        }

        render(<Probe />);

        act(() => {
            Retree.runTransaction(() => {
                root.count = 1;
                root.count = 2;
            });
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });

    it("suppresses useNode rerenders during silent updates until a visible change occurs", () => {
        const root = trackRoot(Retree.use({ count: 1, multiplier: 1 }));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return (
                <div>
                    <span data-testid="count">{state.count}</span>
                    <span data-testid="multiplier">{state.multiplier}</span>
                </div>
            );
        }

        render(<Probe />);

        act(() => {
            Retree.runSilent(() => {
                root.multiplier = 3;
            });
        });

        expect(screen.getByTestId("multiplier").textContent).toBe("1");
        expect(renderCount).toBe(1);

        act(() => {
            root.count = root.count * root.multiplier;
        });

        expect(screen.getByTestId("count").textContent).toBe("3");
        expect(screen.getByTestId("multiplier").textContent).toBe("3");
        expect(renderCount).toBe(2);
    });

    it("collapses descendant useTree updates inside a transaction to one rerender", () => {
        const root = trackRoot(Retree.use({ child: { value: 0 } }));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useTree(root);
            return <div data-testid="value">{state.child.value}</div>;
        }

        render(<Probe />);

        act(() => {
            Retree.runTransaction(() => {
                root.child.value = 1;
                root.child.value = 2;
            });
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });
});