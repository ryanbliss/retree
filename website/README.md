# Retree website

The documentation + marketing site for Retree (Next.js 16, TypeScript,
Tailwind v4, motion, Sandpack). State on the site itself is managed with
Retree via `file:` workspace refs, so it always runs the in-repo source.

Spec: [`specs/website.md`](../specs/website.md). Authoring conventions:
[`AUTHORING.md`](./AUTHORING.md).

## Commands (from repo root or this directory)

```bash
npm run dev --workspace website        # dev server (localhost:3000)
npm run build --workspace website      # generate API MDX → link check → build → pagefind index
npm run generate:api --workspace website  # regenerate /api content only
npm run lint --workspace website
```

## How the pieces fit

-   `content/docs/*.mdx` — hand-written guides (committed). Slugs registered
    in `lib/docs.ts`.
-   `content/api/` — **generated** per-package API reference
    (`scripts/generate-api-docs.mjs` runs TypeDoc against `packages/*/src`,
    gitignored, rebuilt every build — lockstep with source by construction).
-   `scripts/check-links.mjs` — fails the build on broken internal links.
-   Search — Pagefind indexes the prerendered HTML post-build into
    `public/_pagefind/` (gitignored). In `next dev` the cmd+k dialog reports
    the index as unavailable; run a production build to exercise it.
-   `public/llms.txt` — copied from the repo root at build.

## Module resolution gotcha

Do NOT add tsconfig `paths` mapping `@retreejs/*` to package `src/` here.
Turbopack honors those paths, which loads a second copy of `@retreejs/core`
(site code from `src/`, while `@retreejs/react`'s internals resolve the
workspace symlink to `bin/`), and two core instances mean two disjoint proxy
registries — `useNode` then throws "cannot get a reproxy for an unproxied
node". Everything must resolve through `node_modules` to the built `bin/`
output; run `npm run build:packages` at the repo root after changing package
source.

## Deploying to Vercel

Set the project **Root Directory** to `website/`. Build and install commands
work as-is (`npm install` at the repo root is handled by Vercel's workspace
detection; the build command is `npm run build`). The `metadataBase` URL in
`app/layout.tsx`, `app/sitemap.ts`, and `app/robots.ts` assumes
`https://www.retree.dev` — update those three if the production domain differs.
