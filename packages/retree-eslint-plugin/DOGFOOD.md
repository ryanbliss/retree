# Phase A dogfood notes

The first repository run uses the same typed Project Service configuration for
the baseline and enabled commands:

```sh
npm run lint:typed:baseline
npm run lint:typed:retree
```

The enabled run currently reports nine warnings, all in deliberately narrow
demo code:

-   `RetreeTasksDemo.tsx` maps a root-owned task list in a parent designed to
    render exactly once; the list structure is fixed and child components own
    all live subscriptions.
-   `DemoLog.tsx` produces four reads from newly inserted log entries. Entries
    are immutable after insertion, while the observed array owns insertion and
    removal invalidation.
-   `HeroVisualizer.tsx` produces two reads of fixed recursive `subtasks`
    structure. The demo mutates leaf fields only and each row observes its own
    task.
-   `HookPlayground.tsx` produces two intentional stale-read demonstrations:
    `useNode(project.tasks)` and own-mode `useRaw(project.tasks)` compute child
    fields specifically to contrast them with `useTree` and `useSelect`.

These are intentional exceptions or invariants that the Phase A local analysis
cannot prove; none is an unexplained report. No disable comments are added yet
because the configuration remains a separate `warn`-level experiment rather
than required CI policy.

Source-visible values assignable to the canonical `ReactiveNode` export, or
members with decorators, currently degrade to unknown. Ordinary application
types are not classified by the name of a `dependencies` field. That
conservative boundary prevents the Phase A rule from guessing about
`dependencies`, `@select`, `@memo`, or `@ignore` before Phase B summaries exist.

## Preliminary performance

An ESLint `TIMING=1` run over 175 selected TypeScript/TSX files attributed
235.9 ms to the rule in total. A post-optimization warm pair measured 4.69 s
for the typed baseline and 4.88 s with the rule enabled (about 4.1% wall-clock
overhead). This is an encouraging feasibility signal, not the required stable
benchmark.

A review follow-up added per-iteration `resolveValue` memoization. One local
`TIMING=1` run attributed 169.4 ms to the rule with the same nine diagnostics.
That is encouraging but is not a stable benchmark result, so it does not close
the RSS or synthetic-scaling gates.

Peak RSS was not yet stable enough to claim the memory gate: that same pair
measured 1,202,274,304 bytes for the baseline and 1,279,213,568 bytes enabled,
an increase of about 73.4 MiB. Other warm pairs were closer, but the prototype
must meet the under-50-MiB gate reproducibly in the dedicated benchmark job
before Phase C. The 1,000-line p95 and synthetic 100-to-10,000-node scaling
fixtures are also still outstanding.
