/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { IStateReconciler } from "./types.js";
import { reconcileArray } from "./internals/reconcile.js";

/**
 * Create a reconciler for arrays of objects with stable IDs.
 *
 * @remarks
 * Use this for arrays whose items have stable IDs. Reconciliation updates
 * matching items in place so child object identity stays stable for
 * `useNode(item)` rows and Retree parent relationships.
 *
 * Do not use index-based reconciliation for lists that can reorder. Prefer a
 * stable ID from the server.
 *
 * @param idKey Object key containing the stable item ID.
 * @returns A reconciler that updates matching array items in place.
 *
 * @example
 * ```ts
 * const node = new QueryNode(source, {
 *     args: { projectId },
 *     reconcile: reconcileArrayById("id"),
 * });
 * ```
 */
export function reconcileArrayById<
    TItem extends Record<TKey, PropertyKey>,
    TKey extends keyof TItem & string
>(idKey: TKey): IStateReconciler<TItem[]> {
    return {
        reconcile(current, next) {
            if (current === undefined) {
                return next;
            }

            reconcileArray(current, next, (item) => item[idKey]);
            return current;
        },
    };
}
