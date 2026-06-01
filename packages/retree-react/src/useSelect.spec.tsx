import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { useSelect } from "./useSelect";

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

describe("useSelect", () => {
    it("selects from a root node", () => {
        const root = trackRoot(Retree.root({ count: 1 }));

        function Probe() {
            const count = useSelect(root, (node) => node.count);
            return <div data-testid="value">{count}</div>;
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("1");

        act(() => {
            root.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
    });

    it("selects from a child node", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
            })
        );

        function Probe() {
            const count = useSelect(root.child, (node) => node.count);
            return <div data-testid="value">{count}</div>;
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("1");

        act(() => {
            root.child.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
    });

    it("does not rerender when custom equality says the selection is unchanged", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const selected = useSelect(
                root,
                (node) => ({ count: node.count }),
                {
                    equals: (previous, next) => previous.count === next.count,
                }
            );
            return <div data-testid="value">{selected.count}</div>;
        }

        render(<Probe />);

        act(() => {
            root.label = "two";
            root.count = 1;
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(1);

        act(() => {
            root.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });

    it("can select across descendant changes with treeChanged", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
            })
        );

        function Probe() {
            const count = useSelect(root, (node) => node.child.count, {
                listenerType: "treeChanged",
            });
            return <div data-testid="value">{count}</div>;
        }

        render(<Probe />);

        act(() => {
            root.child.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
    });

    it("does not select across descendant changes by default", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                },
            })
        );

        function Probe() {
            const count = useSelect(root, (node) => node.child.count);
            return <div data-testid="value">{count}</div>;
        }

        render(<Probe />);

        act(() => {
            root.child.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
    });

    it("selects dependency tuples without rerendering for broad source churn", () => {
        const root = trackRoot(
            Retree.root({
                attributeId: "a",
                attributes: [
                    { id: "a", value: 0 },
                    { id: "b", value: 0 },
                ],
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const selection = useSelect(
                root,
                (node) =>
                    [
                        node.attributes,
                        node.attributeId,
                        node.attributes.find(
                            (attribute) => attribute.id === node.attributeId
                        ),
                    ] as const
            );
            return (
                <div data-testid="value">{selection[2]?.value ?? "none"}</div>
            );
        }

        render(<Probe />);

        act(() => {
            root.attributes.push({ id: "c", value: 0 });
            root.attributes[1].value = 1;
        });

        expect(screen.getByTestId("value").textContent).toBe("0");
        expect(renderCount).toBe(1);

        act(() => {
            root.attributes[0].value = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });

    it("infers tuple select values for equality", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );

        function Probe() {
            const selection = useSelect(
                root,
                (node) => [node.count, node.label] as const,
                {
                    equals: (previous, next) => {
                        expectTypeOf(previous).toEqualTypeOf<
                            readonly [number, string]
                        >();
                        expectTypeOf(next).toEqualTypeOf<
                            readonly [number, string]
                        >();
                        return (
                            previous[0] === next[0] && previous[1] === next[1]
                        );
                    },
                }
            );
            return <div data-testid="value">{selection[1]}</div>;
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("one");
    });

    it("shares one Retree listener for multiple selectors on the same node", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        const onSpy = vi.spyOn(Retree, "on");

        function CountProbe() {
            const count = useSelect(root, (node) => node.count);
            return <div data-testid="count">{count}</div>;
        }

        function LabelProbe() {
            const label = useSelect(root, (node) => node.label);
            return <div data-testid="label">{label}</div>;
        }

        render(
            <>
                <CountProbe />
                <LabelProbe />
            </>
        );

        expect(
            onSpy.mock.calls.filter(
                ([node, listenerType]) =>
                    node === root && listenerType === "nodeChanged"
            )
        ).toHaveLength(1);

        act(() => {
            root.count = 2;
            root.label = "two";
        });

        expect(screen.getByTestId("count").textContent).toBe("2");
        expect(screen.getByTestId("label").textContent).toBe("two");

        onSpy.mockRestore();
    });

    it("unsubscribes when unmounted", () => {
        const root = trackRoot(Retree.root({ count: 1 }));
        const selected = vi.fn((node: typeof root) => node.count);

        function Probe() {
            const count = useSelect(root, selected);
            return <div data-testid="value">{count}</div>;
        }

        const view = render(<Probe />);
        view.unmount();

        act(() => {
            root.count = 2;
        });

        expect(selected).toHaveBeenCalledTimes(2);
    });
});
