import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import { useNode } from "./useNode";

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

describe("useNode", () => {
    it("rerenders for direct primitive updates", () => {
        const root = trackRoot(Retree.use({ count: 0 }));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return <div data-testid="value">{state.count}</div>;
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("0");

        act(() => {
            root.count = 1;
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(2);
    });

    it("does not rerender for deep descendant leaf updates", () => {
        const root = trackRoot(Retree.use({ child: { value: 1 } }));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return <div data-testid="value">{state.child.value}</div>;
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("1");

        act(() => {
            root.child.value = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(1);
    });

    it("supports the node factory form and switches immediately when the node prop changes", () => {
        const root = trackRoot(
            Retree.use({ first: { value: 1 }, second: { value: 2 } })
        );

        function DirectProbe({ node }: { node: { value: number } }) {
            const state = useNode(node);
            return <div data-testid="direct">{state.value}</div>;
        }

        function FactoryProbe() {
            const state = useNode(() => root.first);
            return <div data-testid="factory">{state.value}</div>;
        }

        const view = render(
            <>
                <DirectProbe node={root.first} />
                <FactoryProbe />
            </>
        );

        expect(screen.getByTestId("direct").textContent).toBe("1");
        expect(screen.getByTestId("factory").textContent).toBe("1");

        view.rerender(
            <>
                <DirectProbe node={root.second} />
                <FactoryProbe />
            </>
        );

        expect(screen.getByTestId("direct").textContent).toBe("2");

        act(() => {
            root.first.value = 3;
        });

        expect(screen.getByTestId("factory").textContent).toBe("3");
    });
});
