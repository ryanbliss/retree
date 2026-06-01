/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { IStateReconciler } from "./types";
import { reconcileArray } from "./internals/reconcile";

/**
 * Create a reconciler for arrays of objects with stable IDs.
 *
 * @remarks
 * Use this for non-Convex arrays whose items have stable IDs. Reconciliation
 * updates matching items in place so child object identity stays stable for
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
 * this.tasks = this.query(api.tasks.listExternal, {
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

/**
 * Create a reconciler for Convex document arrays using each document's `_id`.
 *
 * @remarks
 * Use this for Convex document arrays when you want explicit reconciliation.
 * `ConvexQueryNode` also tries Convex `_id` reconciliation by default for
 * document arrays, but passing this reconciler makes the behavior clear at the
 * call site.
 *
 * @returns A reconciler that updates matching Convex documents in place.
 *
 * @example
 * ```ts
 * this.tasks = this.query(api.tasks.list, {
 *     args: { projectId },
 *     reconcile: reconcileConvexDocuments(),
 * });
 * ```
 */
export function reconcileConvexDocuments<
    TDoc extends { _id: PropertyKey }
>(): IStateReconciler<TDoc[]> {
    return reconcileArrayById<TDoc, "_id">("_id");
}
