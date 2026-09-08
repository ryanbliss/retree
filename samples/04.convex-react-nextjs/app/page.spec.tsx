import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { RetreeConvexReactClient } from "@retreejs/react-convex";
import { CompiledProxyHandler } from "../../../packages/retree-core/src/internals/compiled-node.js";
import { getBaseHandlerOfProxy } from "../../../packages/retree-core/src/internals/reproxy.js";
import type { Doc, Id } from "../convex/_generated/dataModel";
import Home from "./page";
import { AddTaskState, TaskFilterNode, TasksState } from "./tasks-state";

// The root Vitest config compiles this sample with its .babelrc. These tests
// exercise real React hooks and sample models; only the Convex transport is stubbed.
vi.hoisted(() => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://test.convex.cloud");
});

let rows: Doc<"tasks">[];
let published = false;
let publish: (() => void) | undefined;
const unsubscribe = vi.fn();

beforeEach(() => {
    rows = [
        {
            _id: "first" as Id<"tasks">,
            _creationTime: 1,
            text: "First task",
            isCompleted: false,
        },
        {
            _id: "second" as Id<"tasks">,
            _creationTime: 2,
            text: "Second task",
            isCompleted: true,
        },
    ];
    publish = undefined;
    published = false;
    vi.spyOn(RetreeConvexReactClient.prototype, "watchQuery").mockReturnValue({
        onUpdate(callback: () => void) {
            publish = callback;
            return unsubscribe;
        },
        localQueryResult() {
            return published ? rows : undefined;
        },
        journal() {
            return undefined;
        },
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("compiled React sample", () => {
    it("uses compiled handlers for the real sample models", () => {
        for (const model of [
            new AddTaskState(),
            new TaskFilterNode(),
            new TasksState(),
        ]) {
            const root = Retree.root(model);
            expect(getBaseHandlerOfProxy(root)).toBeInstanceOf(
                CompiledProxyHandler
            );
            Retree.clearListeners(root);
        }
    });

    it("updates memo-backed form state through bound methods and async mutations", async () => {
        const mutation = vi
            .spyOn(RetreeConvexReactClient.prototype, "mutation")
            .mockResolvedValue("created");
        render(<Home />);
        const input = screen.getByPlaceholderText("Add a task");
        const submit = screen.getByRole("button", { name: "Add task" });
        expect(submit.hasAttribute("disabled")).toBe(true);
        fireEvent.change(input, { target: { value: "New task" } });
        expect(submit.hasAttribute("disabled")).toBe(false);
        fireEvent.click(submit);
        await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
        expect(mutation).toHaveBeenCalledTimes(1);
        expect(mutation.mock.calls[0][1]).toEqual({ text: "New task" });
        expect(submit.hasAttribute("disabled")).toBe(true);
        fireEvent.change(input, { target: { value: "New task" } });
        expect(submit.hasAttribute("disabled")).toBe(false);
    });

    it("renders a query result already cached when React subscribes", async () => {
        published = true;
        render(<Home />);
        await screen.findByLabelText("Edit First task");
    });

    it("refreshes selectors and rows from filters and server emissions, then unsubscribes", async () => {
        const view = render(<Home />);
        expect(
            vi.mocked(RetreeConvexReactClient.prototype.watchQuery).mock.calls
                .length
        ).toBe(1);
        act(() => {
            published = true;
            publish?.();
        });
        await screen.findByLabelText("Edit First task");
        fireEvent.click(
            screen.getByRole("button", { name: "Completed tasks" })
        );
        await waitFor(() =>
            expect(screen.queryByLabelText("Edit First task")).toBeNull()
        );
        expect(screen.getByLabelText("Edit Second task")).toBeTruthy();
        act(() => {
            rows = rows.map((row) =>
                row._id === "first"
                    ? { ...row, isCompleted: true, text: "Updated task" }
                    : row
            );
            publish?.();
        });
        await screen.findByLabelText("Edit Updated task");
        view.unmount();
        expect(unsubscribe).toHaveBeenCalled();
    });
});
