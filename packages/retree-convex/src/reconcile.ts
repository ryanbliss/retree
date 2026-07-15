/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { IStateReconciler, reconcileArrayById } from "@retreejs/query";

// `reconcileArrayById` moved to @retreejs/query (spec §6.2 AsyncQueryNode
// extraction); re-exported here so existing imports keep working.
export { reconcileArrayById } from "@retreejs/query";

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
