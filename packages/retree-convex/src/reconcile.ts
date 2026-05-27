/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { IStateReconciler } from "./types";
import { reconcileArray } from "./internals/reconcile";

/**
 * Create a reconciler for arrays of objects with stable IDs.
 *
 * @param idKey Object key containing the stable item ID.
 * @returns A reconciler that updates matching array items in place.
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
 * @returns A reconciler that updates matching Convex documents in place.
 */
export function reconcileConvexDocuments<
    TDoc extends { _id: PropertyKey }
>(): IStateReconciler<TDoc[]> {
    return reconcileArrayById<TDoc, "_id">("_id");
}
