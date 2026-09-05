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
| `npm run test`           | Correctness suite across all packages                 |
| `npm run test:watch`     | Watch mode                                            |
| `npm run typecheck`      | `tsc --noEmit` across every package and sample        |
| `npm run doctor`         | Prettier + ESLint with autofix — run before pushing   |
| `npm run build:packages` | Build all publishable packages                        |
| `npm run docs`           | Build packages + TypeDoc site + sync skill references |
| `npm run benchmark`      | Benchmark CLI (writes to `benchmarks/results`)        |

Run `npm run benchmark:react` on an idle machine for the `useRaw` wall-clock
performance gates. It runs the existing 1.5x comparisons with one worker, outside
the correctness and release suites. Those suites retain deterministic checks for
selective materialization, keyed slot reads, and managed identities.

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

The runtime package family moves in lockstep with exact intra-family peer pins:
every package publishes at the same version, and its intra-family
`dependencies`, `devDependencies`, and `peerDependencies` all pin that exact
version. `@retreejs/react@0.9.0` peer-depends on `@retreejs/core@0.9.0` and
nothing else, and the publish preflight refuses to publish a family whose pins
disagree with its versions.

Keeping those pins exact takes one step inside `npm run version:packages`,
which is worth knowing before editing that script. Changesets escalates a
package to a _major_ bump when a `peerDependency` takes a minor bump and the new
version does not satisfy that peer range **as written when the release plan is
computed** — and an exact pin never satisfies a new version. Left alone, every
minor changeset escalated the whole fixed family to a major (a minor released
0.7.2 as 1.0.0), so no minor release of the family was reachable at all. So
`version:packages` widens the intra-family peer pins to a range, runs
`changeset version`, then re-pins them to the version just released:

```bash
node scripts/sync-family-peer-pins.mjs --widen   # transient ">=0.8.0 <1.0.0"
changeset version                                # 0.8.0 -> 0.9.0
node scripts/sync-family-peer-pins.mjs           # back to "0.9.0"
npm install --package-lock-only
```

The widened range exists only while bump types are computed. It is never
committed, published, or seen by an installer, and the preflight rejects it by
name if the re-pin step did not run.

One consequence: running `npx changeset status` directly reports a **major**
bump, because it reads the committed exact pins. That is the tool describing
what would happen without the widen step, not the release this repo produces.
Use `npm run version:packages` on a release branch to see the real result.

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

After a successful publish the workflow tags the commit and creates the
matching GitHub release, with the package's changelog entry as the release
notes. The lockstep family shares one tag (`v0.8.0`); the React ESLint plugin
gets a name-scoped one (`react-eslint-plugin-v0.1.1`). Tagging runs after
publishing so a tag never points at a version that failed to publish, and an
existing release for a tag is left alone, so rerunning the workflow after a
partial failure converges. Preview the notes for the current manifests with:

```bash
node scripts/create-github-release.mjs --dry-run
```

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
