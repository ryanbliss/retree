---
"@retreejs/query": minor
---

Skip polling ticks while a request is in flight so responses cannot arrive out of order within a subscription. Fetch callbacks may use the new second argument's AbortSignal to cancel requests when observation stops or arguments change. Existing single-argument callbacks remain supported. Report synchronous callback failures through the query error path and reject non-finite intervals.
