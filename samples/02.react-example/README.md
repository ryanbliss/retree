# 02. React example — async class state

A minimal Vite + React app: a class fetches cat facts and mutates itself, and
the UI follows along. No actions, no reducers — `randomize()` just writes to
`this`.

## What it teaches

-   `Retree.root` over a class instance whose async method drives
    loading/error/data state with plain assignments.
-   `useTree` subscribing one component to the whole app tree.
-   Passing a child node (`root.facts`) into a `React.memo` component and
    letting reproxy identity trigger its re-renders.
-   Testing the flow with Testing Library and a stubbed `fetch` — see
    `src/App.spec.tsx` and the [testing guide](https://www.retree.dev/docs/testing).

## Where to look

-   `src/App.tsx` — the `CatFacts` class, the app tree, and both components.
-   `src/App.spec.tsx` — success and failure paths under vitest.

## How to run

```bash
npm install && npm run build:packages   # from the repo root
cd samples/02.react-example
npm run dev
```

`npm run test` at the repo root runs this sample's spec too.
