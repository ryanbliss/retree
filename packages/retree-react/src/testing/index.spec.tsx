import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { useNode } from "../useNode.js";
import { actOnRetree, createTestRoot } from "./index.js";

// The documented afterEach integration, exercised by the tests themselves:
// every root created through makeRoot is cleaned up automatically.
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

interface CounterState {
    count: number;
    nested: { value: number };
}

function makeRoot() {
    const testRoot = createTestRoot<CounterState>(() => ({
        count: 0,
        nested: { value: 0 },
    }));
    cleanups.push(testRoot.cleanup);
    return testRoot;
}

function Counter({ counter }: { counter: CounterState }) {
    const state = useNode(counter);
    return <div data-testid="count">{state.count}</div>;
}

describe("createTestRoot", () => {
    it("returns a Retree-managed root whose writes emit", () => {
        const { root } = makeRoot();
        const listener = vi.fn();
        Retree.on(root, "nodeChanged", listener);

        root.count = 1;

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("accepts a factory that already returns a Retree.root result", () => {
        const testRoot = createTestRoot(() => Retree.root({ count: 0 }));
        cleanups.push(testRoot.cleanup);
        const listener = vi.fn();
        Retree.on(testRoot.root, "nodeChanged", listener);

        testRoot.root.count = 1;

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("cleanup clears listeners on the root and on descendants", () => {
        const { root, cleanup } = makeRoot();
        const rootListener = vi.fn();
        const nestedListener = vi.fn();
        Retree.on(root, "nodeChanged", rootListener);
        Retree.on(root.nested, "nodeChanged", nestedListener);

        cleanup();
        root.count = 1;
        root.nested.value = 1;

        expect(rootListener).not.toHaveBeenCalled();
        expect(nestedListener).not.toHaveBeenCalled();
    });

    it("cleanup is idempotent", () => {
        const { root, cleanup } = makeRoot();
        Retree.on(root, "nodeChanged", vi.fn());

        cleanup();
        expect(() => cleanup()).not.toThrow();
    });
});

describe("actOnRetree", () => {
    it("flushes re-renders from a synchronous write", () => {
        const { root } = makeRoot();
        render(<Counter counter={root} />);
        expect(screen.getByTestId("count").textContent).toBe("0");

        actOnRetree(() => {
            root.count += 1;
        });

        expect(screen.getByTestId("count").textContent).toBe("1");
    });

    it("does not trigger React's missing-act warning", () => {
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            const { root } = makeRoot();
            render(<Counter counter={root} />);

            actOnRetree(() => {
                root.count += 1;
            });

            const actWarnings = consoleError.mock.calls.filter((call) =>
                String(call[0]).includes("not wrapped in act")
            );
            expect(actWarnings).toEqual([]);
        } finally {
            consoleError.mockRestore();
        }
    });

    it("supports an async write and flushes renders after awaiting", async () => {
        const { root } = makeRoot();
        render(<Counter counter={root} />);

        await actOnRetree(async () => {
            await Promise.resolve();
            root.count = 5;
        });

        expect(screen.getByTestId("count").textContent).toBe("5");
    });
});
