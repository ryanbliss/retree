# Contributing to Retree

Thanks for your interest in Retree! This guide covers the local workflow.

## Setup

```bash
npm ci
```

Node 22+ is recommended (CI runs on 22). The repo is an npm workspace — all
packages, samples, and the website install from the root.

## Everyday commands

| Command                  | What it does                                          |
| ------------------------ | ----------------------------------------------------- |
| `npm run test`           | Full vitest suite across all packages                 |
| `npm run test:watch`     | Watch mode                                            |
| `npm run typecheck`      | `tsc --noEmit` across every package and sample        |
| `npm run doctor`         | Prettier + ESLint with autofix — run before pushing   |
| `npm run build:packages` | Build all publishable packages                        |
| `npm run docs`           | Build packages + TypeDoc site + sync skill references |
| `npm run benchmark`      | Benchmark CLI (writes to `benchmarks/results`)        |

CI (`.github/workflows/ci.yml`) runs typecheck, tests, and lint/format checks
on every PR — the same commands as above, so a green local run means a green
CI run.

## Code style

See [AGENTS.md](AGENTS.md) for the repo's engineering rules. Highlights:

-   Use the type system: no force casts; prefer type guards and inferred
    generics.
-   Errors pinpoint a single failure condition — never `||` two conditions
    into one throw. A screenshot of the error should identify the exact line
    and cause.
-   At most one ternary per variable.
-   Always add tests for changes, and fix failing tests rather than skipping
    them.

## Design docs

Non-trivial changes are designed in [`specs/`](specs/) before implementation
(see `specs/retree-raw.md` for the house style). Benchmark investigations
live in [`benchmarks/`](benchmarks/) as dated findings files.

## Releases

The runtime package family moves in lockstep with exact intra-family peer pins.
`npm run publish:packages` publishes that family together. An independently
versioned package can be selected explicitly:

```bash
npm run publish:packages -- --package @retreejs/react-eslint-plugin
```

Append `--dry-run` to exercise the complete preflight and npm package lifecycle
without publishing anything.

The command loads the root `.env`, accepts either `NODE_AUTH_TOKEN` or
`NPM_TOKEN`, validates every publishable package before registry writes, and
automatically adds `--access public` for a package that is not on npm yet.
Don't bump versions in a feature PR; releases are done separately.
