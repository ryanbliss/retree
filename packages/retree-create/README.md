# @retreejs/create

Interactive installer that adds the latest [Retree](https://github.com/ryanbliss/retree) packages to an existing project.

## Usage

Run it in the directory of the project you want to add Retree to:

```bash
npm create @retreejs@latest
```

Also works with other package managers:

```bash
pnpm create @retreejs
yarn create @retreejs
bunx @retreejs/create
```

## What it does

-   Always installs `@retreejs/core`.
-   Detects `react` and `convex` in your `package.json` and preselects the matching integrations (`@retreejs/react`, `@retreejs/convex`) in a checklist.
-   Automatically includes `@retreejs/react-convex` when both React and Convex are selected, and adds the `convex` peer dependency if it is missing.
-   Optionally installs the Retree AI skill for coding agents via `npx skills add ryanbliss/retree --skill retree`.
-   Uses your package manager (npm, pnpm, yarn, or bun — detected from how you invoked it, falling back to lockfiles) and shows the exact command before running anything.

It never scaffolds a new project — if there is no `package.json` in the current directory, it asks you to run `npm init` first.

## Manual install

Prefer to install by hand? These are the supported combinations:

```bash
npm i @retreejs/core
npm i @retreejs/core @retreejs/react
npm i @retreejs/core @retreejs/convex convex
npm i @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```
