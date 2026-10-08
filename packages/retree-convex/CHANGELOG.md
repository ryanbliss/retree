# @retreejs/convex

## 0.11.2

### Patch Changes

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

## 0.8.0

## 0.7.2

### Patch Changes

-   @retreejs/core@0.7.2
-   @retreejs/query@0.7.2
