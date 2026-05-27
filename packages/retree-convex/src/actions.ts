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
 * @param client Convex client used to run the action.
 * @param action Convex action function reference.
 * @returns A typed action function.
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
