import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { ReactiveNode, Retree, link, select } from "@retreejs/core";
import { getReproxyNode } from "@retreejs/core/internal";
import { memo } from "react";
import { useNode } from "./useNode";
import { useRoot } from "./useRoot";
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

interface RenderTask {
    id: string;
    isCompleted: boolean;
    text: string;
}

class RenderTaskListState extends ReactiveNode {
    public filter = { isCompleted: null as boolean | null };
    public tasks: RenderTask[] = [
        { id: "a", isCompleted: false, text: "First" },
        { id: "b", isCompleted: false, text: "Second" },
    ];

    @select()
    public get visibleTasks() {
        return this.tasks.filter(
            (task) =>
                this.filter.isCompleted === null ||
                task.isCompleted === this.filter.isCompleted
        );
    }

    get dependencies() {
        return [];
    }
}

class RenderTaskRowState extends ReactiveNode {
    @link
    public task: RenderTask;

    constructor(task: RenderTask) {
        super();
        this.task = task;
    }

    get dependencies() {
        return [];
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

    it("selects with trapped dependencies when only a selector function is passed", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
                label: "one",
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const count = useSelect(() => root.count);
            expectTypeOf(count).toEqualTypeOf<number>();
            return <div data-testid="value">{count}</div>;
        }

        render(<Probe />);

        act(() => {
            root.label = "two";
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(1);

        act(() => {
            root.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });

    it("infers selector-only tuple outputs independently from trapped node dependencies", () => {
        type Task = {
            id: string;
            text: string;
        };
        type QueryStatus = "pending" | "success";
        const root = trackRoot(
            Retree.root({
                tasks: {
                    state: undefined as Task[] | undefined,
                    result: {
                        status: "pending" as QueryStatus,
                    },
                },
                filter: {
                    isComplete: null as boolean | null,
                },
            })
        );

        function Probe() {
            const [tasks, filter, queryStatus] = useSelect(() => {
                const tasks = root.tasks.state ?? [];
                return [tasks, root.filter, root.tasks.result.status] as const;
            });

            expectTypeOf(tasks).toEqualTypeOf<Task[]>();
            expectTypeOf(filter).toEqualTypeOf<typeof root.filter>();
            expectTypeOf(queryStatus).toEqualTypeOf<QueryStatus>();

            return (
                <div data-testid="value">
                    {queryStatus}:{tasks.length}:{String(filter.isComplete)}
                </div>
            );
        }

        render(<Probe />);
        expect(screen.getByTestId("value").textContent).toBe("pending:0:null");
    });

    it("lets row selectors update without rerendering a trapped parent task list", () => {
        const root = trackRoot(Retree.root(new RenderTaskListState()));
        const rowRenderCounts = new Map<string, number>();
        let parentRenderCount = 0;

        function Row({ task }: { task: RenderTask }) {
            const taskId = task.id;
            rowRenderCounts.set(taskId, (rowRenderCounts.get(taskId) ?? 0) + 1);
            const row = useRoot(() => new RenderTaskRowState(task));
            const isCompleted = useSelect(() => row.task.isCompleted);

            return (
                <div data-testid={`task-${taskId}`}>{String(isCompleted)}</div>
            );
        }

        function Parent() {
            parentRenderCount += 1;
            const tasks = useSelect(() => root.visibleTasks);
            return (
                <>
                    {tasks.map((task) => (
                        <Row key={task.id} task={task} />
                    ))}
                </>
            );
        }

        render(<Parent />);

        expect(parentRenderCount).toBe(1);
        expect(rowRenderCounts.get("a")).toBe(1);
        expect(rowRenderCounts.get("b")).toBe(1);

        act(() => {
            root.tasks[0].isCompleted = true;
        });

        expect(screen.getByTestId("task-a").textContent).toBe("true");
        expect(screen.getByTestId("task-b").textContent).toBe("false");
        expect(parentRenderCount).toBe(1);
        expect(rowRenderCounts.get("a")).toBe(2);
        expect(rowRenderCounts.get("b")).toBe(1);
    });

    it("does not rerender memoized child consumers for stable selected child nodes", () => {
        const root = trackRoot(Retree.root(new RenderTaskListState()));
        let parentRenderCount = 0;
        let filterRenderCount = 0;

        const FilterProbe = memo(function FilterProbe({
            filter,
        }: {
            filter: RenderTaskListState["filter"];
        }) {
            filterRenderCount += 1;
            const state = useNode(filter);
            return <div data-testid="filter">{String(state.isCompleted)}</div>;
        });

        function Parent() {
            parentRenderCount += 1;
            const [tasks, filter] = useSelect(() => [
                root.visibleTasks,
                root.filter,
            ]);
            return (
                <>
                    <FilterProbe filter={filter} />
                    <div data-testid="task-count">{tasks.length}</div>
                </>
            );
        }

        render(<Parent />);

        expect(parentRenderCount).toBe(1);
        expect(filterRenderCount).toBe(1);

        act(() => {
            root.tasks[0].text = "First draft";
        });

        expect(screen.getByTestId("task-count").textContent).toBe("2");
        expect(parentRenderCount).toBe(1);
        expect(filterRenderCount).toBe(1);

        act(() => {
            root.tasks.push({
                id: "c",
                isCompleted: false,
                text: "Third",
            });
        });

        expect(screen.getByTestId("task-count").textContent).toBe("3");
        expect(parentRenderCount).toBe(2);
        expect(filterRenderCount).toBe(1);
    });

    it("treats fresh selected arrays as changed while stabilizing managed slots", () => {
        const root = trackRoot(
            Retree.root({
                count: 0,
                filter: {
                    isCompleted: null as boolean | null,
                },
            })
        );
        let parentRenderCount = 0;
        let filterRenderCount = 0;

        const FilterProbe = memo(function FilterProbe({
            filter,
        }: {
            filter: typeof root.filter;
        }) {
            filterRenderCount += 1;
            const state = useNode(filter);
            return <div data-testid="filter">{String(state.isCompleted)}</div>;
        });

        function Parent() {
            parentRenderCount += 1;
            const [filter] = useSelect(() => {
                root.count;
                return [root.filter];
            });
            return <FilterProbe filter={filter} />;
        }

        render(<Parent />);

        act(() => {
            root.count = 1;
        });

        expect(parentRenderCount).toBe(2);
        expect(filterRenderCount).toBe(1);
    });

    it("trapped useSelect subscriptions follow reproxy child reads", () => {
        const root = trackRoot(
            Retree.root({
                child: {
                    count: 1,
                    label: "one",
                },
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const count = useSelect(() => root.child.count);
            return <div data-testid="value">{count}</div>;
        }

        render(<Probe />);

        act(() => {
            root.child.label = "two";
        });

        expect(screen.getByTestId("value").textContent).toBe("1");
        expect(renderCount).toBe(1);

        act(() => {
            root.child.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("2");
        expect(renderCount).toBe(2);
    });

    it("trapped useSelect compares primitive reads even when the selected value is equal", () => {
        const root = trackRoot(
            Retree.root({
                count: 1,
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const isPositive = useSelect(() => root.count > 0);
            return <div data-testid="value">{String(isPositive)}</div>;
        }

        render(<Probe />);

        act(() => {
            root.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("true");
        expect(renderCount).toBe(2);
    });

    it("returns primitive ReactiveNode getter outputs from trapped selectors", () => {
        class PrimitiveGetterNode extends ReactiveNode {
            public child = {
                count: 1,
                label: "one",
            };

            @select()
            get isPositive() {
                return this.child.count > 0;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new PrimitiveGetterNode()));
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const isPositive = useSelect(() => root.isPositive);
            expectTypeOf(isPositive).toEqualTypeOf<boolean>();
            return <div data-testid="value">{String(isPositive)}</div>;
        }

        render(<Probe />);

        act(() => {
            root.child.label = "two";
        });

        expect(screen.getByTestId("value").textContent).toBe("true");
        expect(renderCount).toBe(1);

        act(() => {
            root.child.count = 2;
        });

        expect(screen.getByTestId("value").textContent).toBe("true");
        expect(renderCount).toBe(2);
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
        const rootReproxyBeforeSelectedAttributeChange = getReproxyNode(root);

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
        expect(getReproxyNode(root)).toBe(
            rootReproxyBeforeSelectedAttributeChange
        );
    });

    it("supports explicit dependency slots without reproxying the selected root", () => {
        const root = trackRoot(
            Retree.root({
                attributeId: "a",
                attributes: [
                    { id: "a", value: 0 },
                    { id: "b", value: 0 },
                ],
                dependency(node: unknown, comparisons?: unknown[]) {
                    return { node, comparisons };
                },
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const selected = useSelect(
                root,
                (node) =>
                    [
                        node.attributes,
                        node.attributeId,
                        node.dependency(
                            node.attributes.find(
                                (attribute) => attribute.id === node.attributeId
                            ),
                            [
                                node.attributes.find(
                                    (attribute) =>
                                        attribute.id === node.attributeId
                                )?.id,
                            ]
                        ),
                    ] as const
            );
            return (
                <div data-testid="explicit-value">
                    {selected[2].comparisons?.[0] ?? "none"}
                </div>
            );
        }

        render(<Probe />);
        const rootReproxyBeforeDependencyChange = getReproxyNode(root);

        act(() => {
            root.attributes[0].value = 1;
        });

        expect(screen.getByTestId("explicit-value").textContent).toBe("a");
        expect(renderCount).toBe(1);

        act(() => {
            root.attributeId = "b";
        });

        expect(screen.getByTestId("explicit-value").textContent).toBe("b");
        expect(renderCount).toBe(2);
        expect(getReproxyNode(root)).not.toBe(
            rootReproxyBeforeDependencyChange
        );
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

    it("moves a trapped subscription when a selector changes branches", () => {
        const root = trackRoot(
            Retree.root({
                useFirst: true,
                first: { value: 1 },
                second: { value: 1 },
            })
        );
        let renderCount = 0;

        function Probe() {
            renderCount += 1;
            const value = useSelect(() =>
                root.useFirst ? root.first.value : root.second.value
            );
            return <div data-testid="branch-value">{value}</div>;
        }

        render(<Probe />);

        act(() => {
            root.useFirst = false;
        });
        expect(renderCount).toBe(2);

        act(() => {
            root.first.value = 2;
        });
        expect(renderCount).toBe(2);

        act(() => {
            root.second.value = 3;
        });
        expect(screen.getByTestId("branch-value").textContent).toBe("3");
        expect(renderCount).toBe(3);
    });
});
