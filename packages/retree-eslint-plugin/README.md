# `@retreejs/eslint-plugin`

Type-aware ESLint rules for Retree React applications. This package is an
early feasibility implementation and is not published yet.

## `no-unobserved-react-read`

Detects render-time reads that cross beyond the node observed by `useNode` or
the default mode of `useRaw`:

```tsx
const state = useNode(project);
return <span>{state.owner.name}</span>;
//                         ^ owner is not observed
```

Observe the child, select the value, or deliberately subscribe to the subtree:

```tsx
const state = useNode(project);
const owner = useNode(state.owner);
return <span>{owner.name}</span>;
```

The rule requires typed linting. Configure
`languageOptions.parserOptions.projectService` and use the exported
`flat/recommended-type-checked` flat configuration. The recommended
configuration enables the rule as a warning while the analysis is dogfooded.

The first implementation covers direct Retree hooks, local aliases and
destructuring, array render callbacks, JSX, hook dependency arrays, and paired
direct-child `useRaw` conversions. It deliberately skips uncertain values and
does not yet summarize `ReactiveNode.dependencies`, decorators, getters, or
methods. Map/Set provenance, `Object.*`/`JSON.stringify`/`structuredClone`
whole-value consumers, same-file custom-hook return summaries, and nested named
components that close over an outer component's hook result are also deferred.
