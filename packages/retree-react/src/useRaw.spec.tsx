/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ReactiveNode, Retree, select } from "@retreejs/core";
import { getCustomProxyHandler } from "@retreejs/core/internal";
import { useNode } from "./useNode";
import { useRaw } from "./useRaw";

interface Task {
    id: string;
    title: string;
    isComplete: boolean;
}

function makeTasks(): Task[] {
    return [
        { id: "a", title: "Alpha", isComplete: false },
        { id: "b", title: "Beta", isComplete: true },
    ];
}

describe("useRaw", () => {
    it("returns the raw node and re-renders on own changes only", () => {
        const root = Retree.root({ tasks: makeTasks() });
        const listRenders = vi.fn();

        function List() {
            const [tasksRaw] = useRaw(root.tasks);
            listRenders();
            expect(getCustomProxyHandler(tasksRaw)).toBeUndefined();
            return <div data-testid="count">{tasksRaw.length}</div>;
        }

        render(<List />);
        expect(listRenders).toHaveBeenCalledTimes(1);

        // Deep change: a task's own field. The list must NOT re-render.
        act(() => {
            root.tasks[0].isComplete = true;
        });
        expect(listRenders).toHaveBeenCalledTimes(1);

        // Structural change: the array itself. The list re-renders.
        act(() => {
            root.tasks.push({ id: "c", title: "Gamma", isComplete: false });
        });
        expect(listRenders).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId("count").textContent).toBe("3");
    });

    it("rows own their content; memo rows bail on structural changes", () => {
        const root = Retree.root({ tasks: makeTasks() });
        const rowRenders = vi.fn();

        const Row = React.memo(function Row({ task }: { task: Task }) {
            const t = useNode(task);
            rowRenders(t.id);
            return <li data-testid={`row-${t.id}`}>{t.title}</li>;
        });

        function List() {
            const [tasksRaw, toSource] = useRaw(root.tasks);
            return (
                <ul>
                    {tasksRaw.map((rawTask) => (
                        <Row key={rawTask.id} task={toSource(rawTask)!} />
                    ))}
                </ul>
            );
        }

        render(<List />);
        expect(rowRenders).toHaveBeenCalledTimes(2);

        // A row's own change re-renders that row alone.
        act(() => {
            root.tasks[0].title = "Alpha 2";
        });
        expect(rowRenders).toHaveBeenCalledTimes(3);
        expect(rowRenders).toHaveBeenLastCalledWith("a");
        expect(screen.getByTestId("row-a").textContent).toBe("Alpha 2");

        // A structural change re-renders the list. toSource hands each row
        // the LATEST node identity (same semantics as a useNode list): new
        // row "c" renders, row "a" re-renders once because its identity
        // advanced when its title changed, and untouched row "b" bails.
        act(() => {
            root.tasks.push({ id: "c", title: "Gamma", isComplete: false });
        });
        expect(rowRenders).toHaveBeenCalledTimes(5);
        const renderedIds = rowRenders.mock.calls.map(([id]) => id);
        expect(renderedIds.filter((id) => id === "b")).toHaveLength(1);
        expect(renderedIds).toContain("c");
    });

    it("toSource resolves never-materialized direct children", () => {
        // Fresh tree: no traversal has happened through the proxy.
        const root = Retree.root({ tasks: makeTasks() });
        let resolved: Task | undefined;

        function List() {
            const [tasksRaw, toSource] = useRaw(root.tasks);
            resolved = toSource(tasksRaw[0]);
            return null;
        }

        render(<List />);
        expect(resolved).toBeDefined();
        expect(getCustomProxyHandler(resolved!)).toBeDefined();
        expect(Retree.raw(resolved!)).toBe(Retree.raw(root.tasks)[0]);
    });

    it("toSource resolves never-materialized Map values and Set members", () => {
        const root = Retree.root({
            map: new Map<string, { v: number }>([["k", { v: 1 }]]),
            set: new Set<{ v: number }>([{ v: 2 }]),
        });
        let mapResolved: { v: number } | undefined;
        let setResolved: { v: number } | undefined;

        function MapReader() {
            const [rawMap, toSource] = useRaw(root.map);
            mapResolved = toSource(rawMap.get("k")!);
            return null;
        }
        function SetReader() {
            const [rawSet, toSource] = useRaw(root.set);
            setResolved = toSource([...rawSet][0]);
            return null;
        }

        render(
            <>
                <MapReader />
                <SetReader />
            </>
        );
        expect(getCustomProxyHandler(mapResolved!)).toBeDefined();
        expect(getCustomProxyHandler(setResolved!)).toBeDefined();
        expect(Retree.parent(mapResolved!)).toBe(root.map);
        expect(Retree.parent(setResolved!)).toBe(root.set);
    });

    it("reads current raw data on renders triggered by a parent", () => {
        const root = Retree.root({ tasks: makeTasks() });

        function List({ label }: { label: string }) {
            const [tasksRaw] = useRaw(root.tasks);
            return (
                <div data-testid="view">
                    {label}:{tasksRaw[0].title}
                </div>
            );
        }

        const view = render(<List label="one" />);
        // Deep change with no list re-render: rendered output is stale.
        act(() => {
            root.tasks[0].title = "Fresh";
        });
        expect(screen.getByTestId("view").textContent).toBe("one:Alpha");
        // Parent-triggered re-render reads current raw data.
        view.rerender(<List label="two" />);
        expect(screen.getByTestId("view").textContent).toBe("two:Fresh");
    });

    it("re-renders on declared deep dependencies via @select owners", () => {
        class TaskList extends ReactiveNode {
            public tasks: Task[] = makeTasks();

            @select()
            get incompleteIds() {
                return this.tasks.filter((t) => !t.isComplete).map((t) => t.id);
            }

            get dependencies() {
                return [];
            }
        }
        const list = Retree.root(new TaskList());
        const renders = vi.fn();

        function Incomplete() {
            const [rawList] = useRaw(list); // default nodeChanged
            renders();
            const ids = rawList.tasks
                .filter((t) => !t.isComplete)
                .map((t) => t.id)
                .join(",");
            return <div data-testid="ids">{ids}</div>;
        }

        render(<Incomplete />);
        expect(renders).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("ids").textContent).toBe("a");

        // Declared deep dependency: the owner emits nodeChanged for itself.
        act(() => {
            list.tasks[0].isComplete = true;
        });
        expect(renders).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId("ids").textContent).toBe("");

        // Undeclared deep change: title is not part of the @select getter.
        act(() => {
            list.tasks[0].title = "Renamed";
        });
        expect(renders).toHaveBeenCalledTimes(2);
    });

    it("treeChanged opt-in re-renders on any deep change", () => {
        const root = Retree.root({ tasks: makeTasks() });
        const renders = vi.fn();

        function List() {
            const [tasksRaw] = useRaw(root.tasks, {
                listenerType: "treeChanged",
            });
            renders();
            return <div>{tasksRaw.length}</div>;
        }

        render(<List />);
        expect(renders).toHaveBeenCalledTimes(1);
        act(() => {
            root.tasks[0].title = "Deep";
        });
        expect(renders).toHaveBeenCalledTimes(2);
    });
});
