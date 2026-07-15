/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

// The reconciliation implementation moved to @retreejs/query (spec §6.2
// AsyncQueryNode extraction). This module stays as a compatibility shim for
// existing internal imports; `tryReconcileDocumentsById` keeps its historical
// Convex-flavored name here.
export { reconcileArray } from "@retreejs/query";
export { tryReconcileDocumentsById as tryReconcileConvexDocuments } from "@retreejs/query";
