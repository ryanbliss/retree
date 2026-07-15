import { describe, expect, it, vi } from "vitest";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import type { Preloaded } from "convex/react";
import { convexToJson, type Value } from "convex/values";
import { Retree } from "@retreejs/core";
import { ConvexQueryNode } from "@retreejs/convex";
import { RetreeConvexReactClient } from "./index.js";
import { preloadedQueryOptions } from "./preload.js";

type TasksQuery = FunctionReference<
    "query",
    "public",
    { listId: string },
    { _id: string; text: string; views: bigint }[]
>;

const tasksQuery: TasksQuery = {
    _type: "query",
    _visibility: "public",
    _args: { listId: "" },
    _returnType: [],
    _componentPath: undefined,
};

/**
 * Build the payload shape `preloadQuery` from convex/nextjs produces: the
 * query name plus convexToJson-encoded args and value. The `Preloaded` type
 * declares the JSON fields as `string`, but the runtime payload holds
 * JSONValue objects (convex encodes without stringifying), so the test
 * mirrors that through the same jsonToConvex-compatible encoding.
 */
function buildPreloadedPayload(
    args: Value,
    value: Value
): Preloaded<TasksQuery> {
    const payload = {
        __type: tasksQuery,
        _name: "tasks:list",
        _argsJSON: convexToJson(args),
        _valueJSON: convexToJson(value),
    };
    return payload as unknown as Preloaded<TasksQuery>;
}

describe("preloadedQueryOptions", () => {
    it("derives args and initialState from a preloaded payload", () => {
        const preloaded = buildPreloadedPayload({ listId: "today" }, [
            { _id: "task-1", text: "Buy groceries", views: 5n },
        ]);

        const options = preloadedQueryOptions(preloaded);

        expect(options.args).toEqual({ listId: "today" });
        expect(options.initialState).toEqual([
            { _id: "task-1", text: "Buy groceries", views: 5n },
        ]);
        // bigint survives the Convex JSON round-trip (no JSON.parse anywhere).
        expect(options.initialState[0].views).toBe(5n);
    });

    it("hydrates a ConvexQueryNode with server data before any emission", () => {
        const client = new RetreeConvexReactClient("https://test.convex.cloud");
        const watchQuery = vi.spyOn(client, "watchQuery").mockReturnValue({
            onUpdate: () => vi.fn(),
            localQueryResult: () => undefined,
            journal: () => undefined,
        });
        const preloaded = buildPreloadedPayload({ listId: "today" }, [
            { _id: "task-1", text: "Buy groceries", views: 5n },
        ]);

        const node = Retree.root(
            new ConvexQueryNode(client, tasksQuery, {
                ...preloadedQueryOptions(preloaded),
            })
        );
        Retree.on(node, "nodeChanged", () => undefined);

        // No pending flash: the preloaded value renders immediately.
        expect(node.result).toEqual({
            status: "success",
            data: [{ _id: "task-1", text: "Buy groceries", views: 5n }],
        });
        // The live subscription runs the exact query the server preloaded.
        expect(watchQuery).toHaveBeenCalledWith(tasksQuery, {
            listId: "today",
        });
    });

    it("throws a pinpointed error when the args payload is not an object", () => {
        const preloaded = buildPreloadedPayload("not-args", []);

        expect(() => preloadedQueryOptions(preloaded)).toThrow(
            "preloadedQueryOptions: the preloaded payload's _argsJSON decoded to a string. Expected the arguments object the server component passed to preloadQuery."
        );
    });

    it("throws a pinpointed error when the args payload decodes to null", () => {
        const preloaded = buildPreloadedPayload(null, []);

        expect(() => preloadedQueryOptions(preloaded)).toThrow(
            "preloadedQueryOptions: the preloaded payload's _argsJSON decoded to null. Expected the arguments object the server component passed to preloadQuery."
        );
    });
});
