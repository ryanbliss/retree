import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReactiveNode, Retree } from "@retreejs/core";
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

class EvenNumberNode extends ReactiveNode {
    public numbers: number[] = [];

    get evenNumberCount() {
        return this.numbers.filter((value) => value % 2 === 0).length;
    }

    get dependencies() {
        return [this.dependency(this.numbers, [this.evenNumberCount])];
    }
}

describe("ReactiveNode integration", () => {
    it("rerenders only when reactive comparison values change", () => {
        const root = trackRoot(Retree.root(new EvenNumberNode()));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return <div data-testid="value">{state.evenNumberCount}</div>;
        }

        render(<Probe />);

        act(() => {
            root.numbers.push(3);
        });

        expect(screen.getByTestId("value").textContent).toBe("0");
        expect(renderCount).toBe(1);

        act(() => {
            root.numbers.push(2);
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(2);
    });
});
