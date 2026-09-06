# @retreejs/query

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
