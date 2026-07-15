import React, { startTransition, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode, Retree, select } from "@retreejs/core";
import { renderToString } from "react-dom/server";
import { useNode } from "./useNode.js";

class SelectedOwnerNode extends ReactiveNode {
    public child = { value: 1 };

    @select
    get selectedValue() {
        return this.child.value;
    }

    get dependencies() {
        return [];
    }
}

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
    it("re-renders exactly once per boolean toggle on an array item", () => {
        // Regression guard: the marketing site's render counters appeared to
        // climb +2 per checkbox toggle. The cause was React StrictMode's
        // dev-only double render invocation, not a double emission — this
        // test pins the library contract: one write → one re-render.
        const root = trackRoot(
            Retree.root({
                tasks: [{ id: 1, title: "Ship it", done: false }],
            })
        );
        const task = root.tasks[0];
        let renderCount = 0;

        function Row() {
            renderCount += 1;
            const state = useNode(task);
            return <div data-testid="done">{String(state.done)}</div>;
        }

        render(<Row />);
        expect(renderCount).toBe(1);

        act(() => {
            task.done = !task.done;
        });
        expect(screen.getByTestId("done").textContent).toBe("true");
        expect(renderCount).toBe(2);

        act(() => {
            task.done = !task.done;
        });
        expect(screen.getByTestId("done").textContent).toBe("false");
        expect(renderCount).toBe(3);
    });

    it("rerenders for direct primitive updates", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
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
        const root = trackRoot(Retree.root({ child: { value: 1 } }));
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

    it("rerenders the attached node when @select dependencies change", () => {
        const root = trackRoot(Retree.root(new SelectedOwnerNode()));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return <div data-testid="value">{state.selectedValue}</div>;
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("1");

        act(() => {
            root.child.value = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });

    it("supports the node factory form and switches immediately when the node prop changes", () => {
        const root = trackRoot(
            Retree.root({ first: { value: 1 }, second: { value: 2 } })
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

    it("shares one Retree listener for multiple subscribers to the same node", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const onSpy = vi.spyOn(Retree, "on");

        function Probe({ id }: { id: string }) {
            const state = useNode(root);
            return <div data-testid={id}>{state.count}</div>;
        }

        render(
            <>
                <Probe id="first" />
                <Probe id="second" />
            </>
        );

        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === root && listenerType === "nodeChanged"
            )
        ).toHaveLength(1);

        act(() => {
            root.count = 1;
        });

        expect(screen.getByTestId("first").textContent).toBe("1");
        expect(screen.getByTestId("second").textContent).toBe("1");

        onSpy.mockRestore();
    });

    it("keeps the shared listener alive until the final subscriber unmounts", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const onSpy = vi.spyOn(Retree, "on");

        function Probe({ id }: { id: string }) {
            const state = useNode(root);
            return <div data-testid={id}>{state.count}</div>;
        }

        function View({ showFirst }: { showFirst: boolean }) {
            return (
                <>
                    {showFirst ? <Probe id="first" /> : null}
                    <Probe id="second" />
                </>
            );
        }

        const view = render(<View showFirst />);
        view.rerender(<View showFirst={false} />);

        act(() => {
            root.count = 1;
        });

        expect(screen.queryByTestId("first")).toBeNull();
        expect(screen.getByTestId("second").textContent).toBe("1");

        view.unmount();
        render(<Probe id="third" />);

        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === root && listenerType === "nodeChanged"
            )
        ).toHaveLength(2);

        onSpy.mockRestore();
    });

    it("does not leave stale subscribers after Strict Mode remounts", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const onSpy = vi.spyOn(Retree, "on");
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const state = useNode(root);
            return <div data-testid="strict">{state.count}</div>;
        }

        render(
            <React.StrictMode>
                <Probe />
            </React.StrictMode>
        );
        const subscriptionCountAfterMount = onSpy.mock.calls.filter(
            ([node, listenerType]) =>
                node === root && listenerType === "nodeChanged"
        ).length;

        act(() => {
            root.count = 1;
        });

        expect(screen.getByTestId("strict").textContent).toBe("1");
        expect(renderCount).toBeLessThanOrEqual(4);
        expect(subscriptionCountAfterMount).toBeGreaterThanOrEqual(1);

        onSpy.mockRestore();
    });

    it("renders on the server using the same public node value", () => {
        const root = trackRoot(Retree.root({ count: 7 }));
        let returnedNode: typeof root | undefined;

        function Probe() {
            returnedNode = useNode(root);
            return <span>{returnedNode.count}</span>;
        }

        expect(renderToString(<Probe />)).toBe("<span>7</span>");
        expect(Retree.raw(returnedNode)).toBe(Retree.raw(root));
    });

    it("commits an external-store mutation while a transition is suspended", async () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        let releasePendingView = () => {};
        let pendingViewReady = false;
        const pendingView = new Promise<void>((resolve) => {
            releasePendingView = () => {
                pendingViewReady = true;
                resolve();
            };
        });
        let beginTransition = () => {};

        function PendingView() {
            if (!pendingViewReady) {
                throw pendingView;
            }
            return <div data-testid="pending-view">ready</div>;
        }

        function Probe() {
            const state = useNode(root);
            const [showPendingView, setShowPendingView] = useState(false);
            beginTransition = () => {
                startTransition(() => {
                    setShowPendingView(true);
                    root.count = 1;
                });
            };
            return (
                <>
                    <div data-testid="transition-value">{state.count}</div>
                    {showPendingView ? <PendingView /> : null}
                </>
            );
        }

        render(<Probe />);
        await act(async () => {
            beginTransition();
        });

        expect(screen.getByTestId("transition-value").textContent).toBe("1");
        expect(screen.queryByTestId("pending-view")).toBeNull();

        await act(async () => {
            releasePendingView();
            await pendingView;
        });
        expect(screen.getByTestId("pending-view").textContent).toBe("ready");
    });
});
