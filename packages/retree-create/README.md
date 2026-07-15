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
-   Detects `react` and `convex` in your project (`dependencies`, `devDependencies`, and `peerDependencies`, with module resolution as a fallback for monorepos that hoist to the workspace root) and preselects the matching integrations (`@retreejs/react`, `@retreejs/convex`) in a checklist.
-   Automatically includes `@retreejs/react-convex` when both React and Convex are selected, and adds the `convex` peer dependency if it is missing.
-   Optionally installs the Retree AI skill for coding agents (via `npx` / `pnpm dlx` / `yarn dlx` / `bunx`, matching your package manager).
-   Uses your package manager (npm, pnpm, yarn, or bun — detected from how you invoked it, falling back to lockfiles and workspace markers found walking up to your repo root) and shows the exact command before running anything.
-   Checks for decorator-authoring conflicts (`experimentalDecorators: true`, TypeScript below 5, or a Babel config without `@babel/plugin-proposal-decorators`). Retree works without decorators, so this is purely informational — in interactive runs it can flip `experimentalDecorators` to `false` for you, but only after you explicitly confirm. See [setup and decorators](https://www.retree.dev/docs/setup-and-decorators).

It never scaffolds a new project — if there is no `package.json` in the current directory, it asks you to run `npm init` first.

## Non-interactive usage

Without a TTY (CI, scripts, coding agents), pass flags to run unattended:

```bash
# Accept detected defaults (React/Convex from the project, AI skill on)
npm create @retreejs@latest -- --yes

# Pick features explicitly
npm create @retreejs@latest -- --react --convex --no-skill
npm create @retreejs@latest -- --core-only --skill
```

| Flag           | Effect                                                                        |
| -------------- | ----------------------------------------------------------------------------- |
| `--yes`, `-y`  | Accept detected defaults without prompting (React/Convex detected, skill on). |
| `--react`      | Install `@retreejs/react`.                                                    |
| `--convex`     | Install `@retreejs/convex` (adds the `convex` peer if missing).               |
| `--core-only`  | Install only `@retreejs/core`.                                                |
| `--skill`      | Install the Retree AI skill for coding agents.                                |
| `--no-skill`   | Skip the Retree AI skill.                                                     |
| `--pm <name>`  | Use a specific package manager: `npm`, `pnpm`, `yarn`, or `bun`.              |
| `-h`, `--help` | Show help.                                                                    |

Explicit feature flags (`--react`, `--convex`, `--core-only`) describe the full selection; the skill is only added with `--skill` or `--yes`. Without a TTY and without deciding flags, the installer exits with an error listing these flags instead of hanging. In a TTY the flow stays interactive unless flags decide everything (add `--yes` to skip the confirmation too).

If the packages install but the skill step fails, the installer exits non-zero with a message telling you the packages are already in place and how to retry just the skill step.

## Manual install

Prefer to install by hand? These are the supported combinations:

```bash
npm i @retreejs/core
npm i @retreejs/core @retreejs/react
npm i @retreejs/core @retreejs/convex convex
npm i @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex
```
