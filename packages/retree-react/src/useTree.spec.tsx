import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
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

describe("useTree", () => {
    it("rerenders for deep descendant changes in the observed subtree", () => {
        const root = trackRoot(
            Retree.use({ child: { value: 1 }, sibling: { value: 2 } })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useTree(root);
            return <div data-testid="value">{state.child.value}</div>;
        }

        render(<Probe />);

        act(() => {
            root.child.value = 3;
        });

        expect(screen.getByTestId("value").textContent).toBe("3");
        expect(renderCount).toBe(2);
    });

    it("does not rerender for changes outside the observed subtree", () => {
        const root = trackRoot(
            Retree.use({ child: { value: 1 }, sibling: { value: 2 } })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useTree(root.child);
            return <div data-testid="value">{state.value}</div>;
        }

        render(<Probe />);

        act(() => {
            root.sibling.value = 4;
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(1);
    });

    it("supports the node factory form", () => {
        const root = trackRoot(Retree.use({ child: { value: 1 } }));

        function Probe() {
            const state = useTree(() => root.child);
            return <div data-testid="value">{state.value}</div>;
        }

        render(<Probe />);

        act(() => {
            root.child.value = 5;
        });

        expect(screen.getByTestId("value").textContent).toBe("5");
    });
});