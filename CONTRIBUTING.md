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

The runtime package family moves in lockstep: every package in the family
publishes at the same version, and intra-family `peerDependencies` all declare
the same major-line range (`>=0.7.2 <1.0.0` today). The range rather than an
exact pin is deliberate — changesets treats a minor bump of a package as a
breaking change for anything that peer-depends on it by exact version, which
would escalate every minor release of the family to a major one. The publish
preflight enforces the lockstep guarantee directly instead: one shared range
across the family, and the version being published must satisfy it.

Feature PRs add a changeset but do not edit package versions. After the feature
PR merges, create a release branch from `main` and run:

```bash
npm ci
npm run version:packages
```

That consumes the pending changesets, updates manifests and the lockfile, and
keeps fixed packages and exact internal pins synchronized. Validate and merge
those generated version changes through a separate release PR. Then run the
`Release` workflow on `main` from GitHub Actions, or with:

```bash
gh workflow run release.yml --ref main
```

The workflow is deliberately manual (`workflow_dispatch`); merging either the
feature PR or release PR does not publish by itself. It checks npm first and is
an idempotent no-op when every manifest version is already published. Pending
lockstep packages and the independently versioned React ESLint plugin are
published through their npm Trusted Publisher connections with provenance.

For local publishing, `npm run publish:packages` publishes the lockstep family
together. An independently versioned package can be selected explicitly:

```bash
npm run publish:packages -- --package @retreejs/react-eslint-plugin
```

Append `--dry-run` to exercise the complete preflight and npm package lifecycle
without publishing anything.

The command loads the root `.env`, accepts either `NODE_AUTH_TOKEN` or
`NPM_TOKEN`, validates every publishable package before registry writes, and
automatically adds `--access public` for a package that is not on npm yet.
Don't bump versions in a feature PR; releases are done separately.
