/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    ActionReference,
    IConvexActionClient,
    OptionalConvexArgs,
    RetreeConvexAction,
} from "./types";

/**
 * Create a typed Retree Convex action function from a Convex client and action
 * reference.
 *
 * @remarks
 * Use this when you need a typed action helper outside a
 * {@link BaseConvexNode}. Actions are imperative calls and do not emit Retree
 * changes by themselves. Assign the action result into Retree state if the UI
 * should update from it.
 *
 * @param client Convex client used to run the action.
 * @param action Convex action function reference.
 * @returns A typed action function.
 *
 * @example
 * ```ts
 * const generateSummary = createRetreeConvexAction(
 *     client,
 *     api.ai.generateSummary
 * );
 *
 * const summary = await generateSummary({ taskId });
 * state.summary = summary; // ✅ emits if `state` is Retree-managed
 * ```
 */
export function createRetreeConvexAction<Action extends ActionReference>(
    client: IConvexActionClient,
    action: Action
): RetreeConvexAction<Action> {
    return ((...args: OptionalConvexArgs<Action>) => {
        const actionArgs = args[0] ?? {};
        return client.action(action, actionArgs);
    }) as RetreeConvexAction<Action>;
}
