import React, { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import {
    createRetreeContext,
    RetreeProvider,
    useRootContext,
} from "./context.js";
import { useNode } from "./useNode.js";

interface CounterRoots {
    counter: { count: number };
}

function createCounterRoots(): CounterRoots {
    return { counter: Retree.root({ count: 0 }) };
}

const createdRoots: CounterRoots[] = [];

function createTrackedCounterRoots(): CounterRoots {
    const roots = createCounterRoots();
    createdRoots.push(roots);
    return roots;
}

afterEach(() => {
    for (const roots of createdRoots.splice(0)) {
        Retree.clearListeners(roots.counter, false);
    }
});

function Counter({ testId }: { testId: string }) {
    const { counter } = useAppRoots();
    const state = useNode(counter);
    return (
        <button data-testid={testId} onClick={() => (state.count += 1)}>
            {state.count}
        </button>
    );
}

const { Provider: AppProvider, useRootContext: useAppRoots } =
    createRetreeContext<CounterRoots>("AppProvider");

describe("createRetreeContext", () => {
    it("provides the created container to descendants with inferred typing", () => {
        render(
            <AppProvider create={createTrackedCounterRoots}>
                <Counter testId="counter" />
            </AppProvider>
        );

        expect(screen.getByTestId("counter").textContent).toBe("0");
        act(() => {
            screen.getByTestId("counter").click();
        });
        expect(screen.getByTestId("counter").textContent).toBe("1");
    });

    it("isolates state between two sibling providers", () => {
        render(
            <>
                <AppProvider create={createTrackedCounterRoots}>
                    <Counter testId="left" />
                </AppProvider>
                <AppProvider create={createTrackedCounterRoots}>
                    <Counter testId="right" />
                </AppProvider>
            </>
        );

        act(() => {
            screen.getByTestId("left").click();
            screen.getByTestId("left").click();
        });

        expect(screen.getByTestId("left").textContent).toBe("2");
        expect(screen.getByTestId("right").textContent).toBe("0");
    });

    it("runs create exactly once per provider instance under StrictMode", () => {
        const create = vi.fn(createTrackedCounterRoots);

        render(
            <StrictMode>
                <AppProvider create={create}>
                    <Counter testId="counter" />
                </AppProvider>
            </StrictMode>
        );

        expect(create).toHaveBeenCalledTimes(1);
    });

    it("keeps the container stable across rerenders of the provider", () => {
        const create = vi.fn(createTrackedCounterRoots);
        const view = render(
            <AppProvider create={create}>
                <Counter testId="counter" />
            </AppProvider>
        );

        act(() => {
            screen.getByTestId("counter").click();
        });
        view.rerender(
            <AppProvider create={create}>
                <Counter testId="counter" />
            </AppProvider>
        );

        expect(create).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("counter").textContent).toBe("1");
    });

    it("recreates the container when the provider unmounts and remounts", () => {
        const create = vi.fn(createTrackedCounterRoots);
        const view = render(
            <AppProvider create={create}>
                <Counter testId="counter" />
            </AppProvider>
        );

        act(() => {
            screen.getByTestId("counter").click();
        });
        expect(screen.getByTestId("counter").textContent).toBe("1");

        view.unmount();
        render(
            <AppProvider create={create}>
                <Counter testId="counter" />
            </AppProvider>
        );

        expect(create).toHaveBeenCalledTimes(2);
        expect(createdRoots[0]).not.toBe(createdRoots[1]);
        // Fresh container: the remounted tree starts from the factory's
        // initial state, not the previous mount's writes.
        expect(screen.getByTestId("counter").textContent).toBe("0");
    });

    it("throws a pinpointed error when no provider is above", () => {
        // React logs the thrown error via console.error before rethrowing;
        // silence it so the expected failure does not pollute test output.
        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            expect(() => render(<Counter testId="counter" />)).toThrow(
                "useRootContext: no AppProvider was found above the component calling useRootContext."
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("does not cross-match containers from a different createRetreeContext", () => {
        const other = createRetreeContext<CounterRoots>("OtherProvider");

        function OtherConsumer() {
            other.useRootContext();
            return null;
        }

        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            expect(() =>
                render(
                    <AppProvider create={createTrackedCounterRoots}>
                        <OtherConsumer />
                    </AppProvider>
                )
            ).toThrow(
                "useRootContext: no OtherProvider was found above the component calling useRootContext."
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("supports containers whose value is null", () => {
        const nullable = createRetreeContext<CounterRoots | null>(
            "NullableProvider"
        );
        let observed: CounterRoots | null | undefined;

        function NullConsumer() {
            observed = nullable.useRootContext();
            return null;
        }

        render(
            <nullable.Provider create={() => null}>
                <NullConsumer />
            </nullable.Provider>
        );

        expect(observed).toBe(null);
    });
});

describe("RetreeProvider (default context)", () => {
    it("provides a container readable through useRootContext<T>()", () => {
        let observed: CounterRoots | undefined;

        function DefaultConsumer() {
            observed = useRootContext<CounterRoots>();
            return null;
        }

        render(
            <RetreeProvider create={createTrackedCounterRoots}>
                <DefaultConsumer />
            </RetreeProvider>
        );

        expect(observed).toBe(createdRoots[0]);
    });

    it("throws a pinpointed error when no RetreeProvider is above", () => {
        function DefaultConsumer() {
            useRootContext<CounterRoots>();
            return null;
        }

        const consoleError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});
        try {
            expect(() => render(<DefaultConsumer />)).toThrow(
                "useRootContext: no RetreeProvider was found above the component calling useRootContext."
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});
