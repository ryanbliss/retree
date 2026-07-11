# Website authoring conventions

Read this before adding pages or docs content. The governing document is
`specs/website.md` at the repo root; this file is the practical how-to.

## Stack

Next.js 16 App Router + TypeScript + Tailwind v4 + `motion` (motion.dev).
Site client state dogfoods `@retreejs/core` / `@retreejs/react` (local
workspace source via `file:` refs). 2023-11 decorators work in site code
(`.babelrc`), but **live Sandpack demos must stay decorator-free** — verified
July 2026: the Sandpack bundler applies legacy decorator transpilation and
Retree's standard-decorator APIs fail at runtime (spec §6c).

## Design tokens (app/globals.css)

Use Tailwind classes backed by tokens — never raw hex:

-   Text: `text-foreground` (headings/emphasis), `text-muted` (body),
    `text-faint` (labels/annotations), `text-accent` (links, accent text — the
    only green safe for text).
-   Surfaces: `bg-background`, `bg-surface`, `bg-surface-raised`,
    `bg-code-bg`; borders `border-border-token` / `border-border-strong`.
-   Glow/decoration only: `bg-accent-glow`, `var(--accent-glow)`,
    `var(--accent-glow-soft)`. Never use glow colors for text.
-   Mono accents: section eyebrows are
    `font-mono text-xs uppercase tracking-widest text-faint`.
-   Both themes must work — check `html[data-theme="light"]`.
-   Motion: 150–300 ms springs/fades; respect `prefers-reduced-motion` (the
    render-counter, not animation, must carry any message).

## Docs pages (`content/docs/<slug>.mdx`)

-   Slugs are registered in `DOCS_NAV` in `lib/docs.ts` — they are fixed;
    create the file matching the slug.
-   Frontmatter is required: `title` and `description` (build throws without
    them). The H1 is rendered from frontmatter — do NOT add an `# H1` in the
    body; start at `##`.
-   Available MDX components (no imports needed):
    -   `<PMTabs packages="@retreejs/core @retreejs/react" />` — install tabs.
    -   `<Note>…</Note>`, `<Warning>…</Warning>`, `<Callout type=… title=…>`.
    -   `<Sandbox height={420}>` wrapping fenced code blocks — live editable
        Sandpack demo. Each fence needs `name="/App.tsx"` meta; optional meta:
        `hidden`, `active`, `readonly`; Sandbox props: `height`, `manualRun`.
        Template is `react-ts` with `@retreejs/react@0.4.17` + core installed.
        `/App.tsx` must default-export the demo component.
    -   Plain fences: ` ```ts title="optional-label" ` — Shiki-highlighted with
        copy button; `nocopy` meta hides the button.
-   Content rules (spec §6): static fences by default; a `<Sandbox>` only where
    editing genuinely teaches (roughly one per hook/quickstart page). Only use
    APIs that exist in the published 0.4.17 packages.
-   Style: honest, precise, no hype adjectives. Use the ✅/❌ annotated-example
    format from the README for behavior tables. Define terms per the glossary
    in Thinking in Retree and link on first use. Keep the terminology: node,
    root, tree, reproxy, managed vs raw, link vs move vs clone.
-   Cross-links: guides `/docs/<slug>`; API pages
    `/api/<pkg>/<kind>/<Name>` where kind ∈ classes|functions|interfaces|
    type-aliases|variables (e.g. `/api/react/functions/useNode`). Link the API
    reference for each API you document.
-   Ground every claim in the repo README.md, `skills/retree/references/*.md`,
    or package source — do not invent behavior. `content/docs/quick-start.mdx`
    is the exemplar page.

## Marketing pages (`app/**.tsx`)

-   Server components by default; `"use client"` only where interactive.
-   Visualizer primitives in `components/visualizer/`:
    -   `useRenderGlow<T>()` → `{ ref, renders }` — attach ref, show renders.
    -   `<RenderBadge renders={n} />` — the always-on counter (canonical
        evidence; glow is enhancement).
    -   `<StateNodePill node={x} label="tasks[0]" />` — schematic state-tree
        node that re-renders/glows when its Retree node changes.
-   Demo state built with `Retree.root(...)` at module scope or `useRoot`.
-   Honesty rules from spec §1/§5.4 are hard requirements: no unverified
    numbers, no strawman comparisons, label simulations, comparison content
    only from the verified facts in spec §5.4.

## Verification

-   You may run `npx tsc --noEmit` inside `website/` (or `npm run lint`).
-   Do NOT run `next build` or `next dev` (a coordinator handles builds;
    concurrent builds clobber `.next`).
