# @retreejs/query

## 0.11.2

### Patch Changes

-   2b64407: Fixed an "already has a structural parent" error when a query reused a backend-cached result after an overlapping optimistic update rolled back.
-   ec97249: Queries no longer adopt the objects a source emits, so two queries can share one cached result.

    Two queries that received the same cached result threw "Retree cannot assign this node because it already has a structural parent". Rows added during reconciliation were also shared between queries, so editing one query changed the other. Query state now holds its own copies, including of `initialState`. Frozen objects and opaque built-ins are still shared, and reconciliation copies only the rows and fields it writes.

    Custom reconcilers should not write objects from `next` into `current` directly. Use `reconcileArray`, or return a replacement value; it is copied, except for rows reused from `current`.

## 0.11.1

## 0.11.0

## 0.10.4

## 0.10.3

## 0.10.2

## 0.10.1

## 0.10.0

## 0.9.0

### Minor Changes

-   8a6b278: Skip polling ticks while a request is in flight so responses cannot arrive out of order within a subscription. Fetch callbacks may use the new second argument's AbortSignal to cancel requests when observation stops or arguments change. Existing single-argument callbacks remain supported. Report synchronous callback failures through the query error path and reject non-finite intervals.

### Patch Changes

-   28a7a9f: Reconcile nested query results in one iterative raw traversal. Materialize only changed rows and paths while preserving unchanged object identities.

## 0.8.0

## 0.7.2

### Patch Changes

-   @retreejs/core@0.7.2
