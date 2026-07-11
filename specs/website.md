# Retree Website Spec — docs + marketing site (`website/`)

Status: **v2 — research integrated; revised per UX, marketing, and technical-writing panel review (all three: "good with changes"; all blockers and majors incorporated below).**

## 1. Goals

Build a modern, multipage documentation + marketing website for Retree, living in a new `website/` workspace in this repo. It will be deployed to Vercel later and does not replace the GitHub Pages TypeDoc site yet.

-   Marketing: communicate Retree's core value proposition — reactive object trees whose subscriptions match the component tree — with interactive visualizations, not just prose.
-   Comparison: honest, credible feature comparison vs MobX and Valtio (nested tree stores vs top-level stores/actions).
-   Docs: guides for every hook and core concept with live, editable Sandpack examples where editing teaches.
-   API reference: auto-generated TypeDoc content for each package, regenerated on every build (lockstep with source), rendered in the site's own design.
-   Dogfooding: the site's client state uses Retree itself (`useRoot`, `useNode`, `useSelect`, …).

**Honesty is a hard requirement throughout**: no unverified numbers, no strawman comparisons, no unlabeled simulations. Several review findings below exist purely to protect this.

## 2. Constraints & known facts (verified in repo)

-   Monorepo npm workspaces; packages: `@retreejs/core`, `@retreejs/react`, `@retreejs/convex`, `@retreejs/react-convex` — all published to npm at **0.4.17** (Sandpack resolves them from the registry).
-   `@retreejs/react` peer-supports React `^16.8 – ^19`.
-   Website scaffold (done, builds green): **Next 16.2.6, React 19.2.4, Tailwind v4, react-compiler, `.babelrc` with 2023-11 decorators**, `file:` refs to local packages (site runs in-repo source — lockstep), `transpilePackages` + `resolve.symlinks=false`, workspace wired into root `package.json`.
-   TypeDoc ^0.28 with `entryPointStrategy: "packages"` builds the legacy `docs/` site; `npm run docs` also syncs `skills/retree/references/*.md`. New pipeline must not break these (it doesn't touch them).
-   `llms.txt` at repo root is a first-class artifact; the site must serve it and extend the AI-readability layer.
-   Perf claims must come from `benchmarks/` and stay honest. **Never publish version-over-version numbers** ("3.8 ms → 1.3 ms") — meaningless to outsiders.

## 3. Design direction

Research inputs: Evil Martians 100-devtool-landing-pages study; teardowns of Bun, tRPC, TanStack, Convex, motion.dev, Stripe/Clerk docs; 2026 design-trend retrospectives.

-   **Dark-first**, token-based theming with a light toggle. Near-black (not pure #000) background, neutral grays, one green "tree" accent — split into **two tokens**: `accent-text` (must pass ≥4.5:1 on both themes' backgrounds) and `accent-glow` (decorative only, unconstrained). Full token set contrast-validated in both themes **before any page work** (milestone 2 gate). Theme persistence via a no-flash inline script in the root layout.
-   **Monospace as a design accent**: eyebrows, section labels, stats, nav — not just code.
-   **Code is the hero visual.** The hero code block must _be_ the pitch: mutate a plain object; exactly one component re-renders.
-   Motion (motion.dev): micro-interactions, spring physics, staggered fade-ups, layout animations on tab switches; 150–300 ms; respect `prefers-reduced-motion`; glow only as functional signal. No mesh gradients, glassmorphism, 3D heroes, kinetic type, or scroll-jacking.
-   Interactive bento only where cells earn their size; terminal/CLI motifs (`$` prompt, copyable install command).

### 3.1 Landing page blueprint

1. **Hero**: headline + one-sentence sub + `npm i @retreejs/core @retreejs/react` copy button + primary CTA "Get started" (→ Quickstart) + secondary CTA GitHub (star count only once it isn't embarrassing; "Why Retree" lives in nav + post-visualizer inline CTA). Hero mini-visualizer is **non-Sandpack, pure Retree**, auto-plays a short scripted mutation loop so flashes are visible within ~2 s without interaction; pointer takeover on hover. Headline candidates (pick at design review; no generic adjectives — the demo makes the claim, the headline names it):
    - "Your state tree, shaped like your component tree." / "Mutate a plain TypeScript object; exactly the components that read it re-render."
    - "State that matches your component tree." / "Plain TypeScript objects. Per-node subscriptions. No observers, no actions, no selectors required."
    - "If you can mutate an object, you already know Retree." / "Reactive object trees for React — subscribe to any node, re-render only what changed."
2. **Concrete-claims strip** — only claims Retree verifiably wins: "No `observer()` HOCs, no action wrappers", "Tree operations built in: parent, move, link, clone", "React 16.8 → 19", "Works with class view models _and_ plain objects". **No bundle-size claim unless measured and favorable** (measurement is a milestone-2 deliverable; if merely fine, state it on /why only). No "TS-first" (table stakes). Convex is _not_ an identity claim — it's a proof point in the integrations section.
3. **The comparative re-render visualizer** (§5.1) + inline "Why Retree →" CTA after it.
4. **Feature walk, capped at 4 items** ordered by adoption journey: (1) plain-assignment mutation + granular re-renders [live demo], (2) derived values with `useSelect` [static Shiki], (3) tree semantics — parent/move/link/clone, the unique differentiator [live demo], (4) Convex sync teaser [static → /why + docs]. A fifth "when you need more" card links decorators/transactions/raw to docs.
5. **Per-package cards** with "use instead of / pairs with" framing.
6. **Performance philosophy strip** (launch version): methodology statement, link to the open `benchmarks/` harness, the already-verified README medium-benchmark numbers with named workloads only if they can be presented absolute + reproducible; full charts page is post-launch. Never version-over-version deltas.
7. Final CTA repeating the install command.

### 3.2 Navigation shell

-   Top nav: Docs, API, Why Retree, GitHub, search trigger (visible button, not only cmd+k), theme toggle. Mobile: sheet menu.
-   Docs/API pages: left sidebar (sections per §4), right on-page TOC with anchor links, prev/next footer links, heading anchor buttons, "Edit this page on GitHub" link (guides only), breadcrumbs on API pages.
-   API pages carry a "Guide" backlink where a guide exists (e.g. `useNode` reference ↔ useNode guide).
-   404 page: search box + links to Quickstart, Thinking in Retree, API index.

## 4. Sitemap

-   `/` — marketing home (§3.1).
-   `/why` — narrative pitch: full comparative visualizer, comparison table, **trade-offs section** (§5.4), honest project-status note.
-   `/compare/mobx`, `/compare/valtio` — thin SEO-targeted pairwise pages sharing the table component + pairwise prose. Target queries: "mobx alternative", "mobx without observer", "valtio vs mobx", "valtio alternative", "react state tree library". `/compare` redirects to `/why`.
-   `/docs` — journey-ordered:
    -   **Quickstart** — acceptance criteria: working app in <5 min; install → `Retree.root` → `useNode` → mutate → watch one component re-render; **zero-config path only — no classes required, no decorators, no Convex**; package-manager tabs; one Sandpack embed (justified under §6 rule); ends with three "next" links (Thinking in Retree, Common pitfalls, Choosing a hook).
    -   **Thinking in Retree** — the mental-model page. Fixed outline: (1) everything is a tree with one structural parent; (2) events: `nodeChanged` vs `treeChanged` vs `nodeRemoved`; (3) subscriptions match the component tree; (4) reproxy identity — what changes and what stays referentially stable on a write (the README family-tree example lives here; essential for `React.memo`/`useMemo` correctness); (5) managed vs raw; (6) **What can go in a tree** (objects, arrays, Maps, Sets, class instances; node vs primitive rules); (7) **Terms** — canonical glossary with stable anchors (node, root, tree, reproxy, managed vs raw, source, link vs move vs clone, observational subscription). Style rule: every term defined once, linked on first use per page.
    -   **React hooks**: index page with "Choosing a hook" decision table (hook / re-renders when / use for / avoid when — lifted from README feature glossary) + the hook playground (§5.2); then one page per hook: `useRoot`, `useNode`, `useTree`, `useSelect`, `useRaw`. Each hook page cross-links the others in a consistent header callout.
    -   **Common pitfalls** — dedicated page, cross-linked from Quickstart and every hook page: the whiteboard ✅/❌ example (nested writes need `useNode(child)`), writing to raw values, raw references as memo deps, `@ignore` fields losing `Retree.parent`, `useSelect` is not a memo cache. Keep the README's annotated ✅/❌ format.
    -   **Events & subscriptions (core)** — `@retreejs/core` outside React: `Retree.root/on/select`, the three event types, `INodeFieldChanges` records (raw previous/new + `Retree.source`), unsubscribe patterns. The Convex guide links here.
    -   **View models** — `ReactiveNode`, `dependencies`, `@select`, `@memo`/`@fnMemo`, `@ignore`, `@link`, lifecycle hooks.
    -   **Setup & decorators** — dedicated page: standard 2023-11 decorators vs `experimentalDecorators`, per-toolchain snippets (Vite, Next/Babel, tsconfig), React Compiler note. Linked prominently from Quickstart ("optional power tier") and View models.
    -   **Tree operations** — parent/move/link/clone ownership semantics.
    -   **Transactions & silent writes** — `runTransaction`, `runSilent`.
    -   **Performance** — narrow subscriptions, `raw`/`peekInto`/`untracked`/`prepareTree`, profiling guidance.
    -   **Convex integration** — `ConvexNode`, query nodes, optimistic updates, `RetreeConvexReactClient`.
-   `/api` — generated reference per package: `/api/core`, `/api/react`, `/api/convex`, `/api/react-convex` — same shell as guides.
-   `/llms.txt`; per-page markdown routes (§8).

Docs table stakes: Pagefind cmd+k search (dialog is a proper combobox pattern: focus trap, arrow-key results, `aria-activedescendant`, Escape closes) + visible nav search button; package-manager tabs (npm/pnpm/yarn/bun) persisted in localStorage; copy buttons stripping `$`; dark default.

## 5. Interactive value-prop visualizations

### 5.1 Comparative re-render visualizer (hero mini + full version on /why)

-   **Canonical, always-on evidence: per-component render counters** (`renders: 47` vs `renders: 3`). The react-scan-style border-glow pulse (motion, ~600 ms decay) is progressive enhancement on top. Under `prefers-reduced-motion`: counters + a static highlight state (no animation) carry the full message — WCAG 1.4.1 compliant (not color/motion-only).
-   Full version (on /why): three panes — editable code (Sandpack), live app, schematic component-tree diagram. Toggle between "idiomatic top-level store" and "Retree `useNode`".
-   **The comparison side must not be a strawman**: it runs an idiomatic single `useState`/`useReducer` store with typical `React.memo` usage, labeled in the UI ("idiomatic top-level store") — and toggling shows its actual source in the code pane so skeptics can audit it.
-   **Mobile (<768 px)**: two stacked panes (live app + compact 3–5-node tree diagram) simultaneously visible in one viewport; code behind a "View code" disclosure. The hero mini version must be explicitly tested at 375 px — `/` is the most-shared URL.
-   Hero mini: non-Sandpack, pure Retree + motion, auto-playing scripted loop, compact.

### 5.2 Hook playground

Lives on the `/docs/react` hooks index (linked from each hook page). Same demo state, switchable `useNode` / `useTree` / `useSelect` / `useRaw`; each mode shows a one-line caption ("useSelect: subscribed to doneCount only — title edits don't re-render") and the schematic tree highlights the active subscription boundary.

### 5.3 Convex sync demo (integrations section + Convex guide)

Two panes syncing through one Retree tree, **simulated transport at launch with a visible "simulated transport" badge** linking to the real sample (`samples/04.convex-react-nextjs`). Claim phrasing: "No official backend integration exists for MobX or Valtio; `@retreejs/convex` is first-class" — precise and verifiable.

### 5.4 Comparison content (verified facts, July 2026)

Verified versions: MobX 6.16.1 (+ mobx-react-lite 4.1.1, ~18.5 kB + ~2 kB gz), Valtio 2.3.2 (~2.6 kB gz), Zustand 5.0.14, Jotai 2.20.1. Structure copies TanStack Query's comparison page: one table, four-tier legend (✅ first-class / 🟡 community / 🔶 possible with work / 🛑 absent), accuracy pledge + "submit a PR" invitation, footnotes for nuance.

Rows: mutation model, subscription granularity, component-tree alignment / nested stores, HOC requirement, class support, decorators, computed/memo, transactions/silent writes, tree operations (parent/move/clone/link), escape hatches, backend integration, devtools, concurrent React, TS inference, bundle size (measured), **plus rows Retree loses**: ecosystem/community resources, production track record, framework-agnostic core usage beyond React, Redux DevTools support. **mobx-state-tree gets a dedicated footnoted sub-section** (closest competitor on tree semantics — omitting it invites the first attack).

Sharpest honest contrasts (verified current):

-   MobX requires `observer()` around every reading component and `action` around writes (`enforceActions` on by default); observables passed into non-observer children silently break reactivity. Retree is hooks + plain assignment.
-   Valtio splits mutable `state` from frozen `snap` (its own docs list the gotchas: memo'd children over-render on un-accessed snapshots, `sync: true` for controlled inputs, getters uncached + siblings-only). Retree gives one object.
-   Neither MobX core nor Valtio has tree semantics; MobX defers to mobx-state-tree (separate schema-based layer).

**Trade-offs / "when not to use Retree" section on /why** — addresses head-on what a skeptical senior engineer will raise: (1) concurrent React/tearing story (state the actual `useSyncExternalStore` status honestly); (2) React Compiler interaction (the site itself runs react-compiler — say so); (3) the per-node subscription model means subscribing to the right node is on you (the whiteboard example — framed as explicit granularity, taught in Thinking in Retree); (4) project status: solo maintainer, v0.4.x, versioning policy, test count, open benchmark harness. Recommend Zustand outright for small flat stores; credit MobX's decade of hardening + best-in-class computed engine; credit Valtio's minimalism + Redux DevTools.

Anti-dating rules: never cite legacy MobX decorators or Valtio v1 APIs. Bundle size row uses **our measured numbers** for all libraries, same method (esbuild min+gzip), linked to the measurement script.

## 6. Tech stack

-   Next.js 16 App Router, TypeScript, Tailwind v4, `motion`.
-   **Content pipeline: hand-rolled MDX, no docs framework.** Guides authored as MDX, rendered via `next-mdx-remote` (v6) with a custom component map (`table`, `code` → Shiki-highlighted block with copy button, `a` → route-aware links). Shiki with a custom theme matching site tokens. Fumadocs-core headless is the documented fallback. (Assessed: fumadocs-ui too opinionated for bespoke design; Contentlayer unmaintained.)
-   Search: **Pagefind** post-build over prerendered HTML (`data-pagefind-filter` per section/package; zero infra; no drift).
-   `@codesandbox/sandpack-react@2.20.0` for editable examples:
    -   Composed form (`SandpackProvider` + `SandpackLayout` + `SandpackCodeEditor` + `SandpackPreview`), custom Tailwind chrome.
    -   SSR CSS: `getSandpackCssText()` + `useServerInsertedHTML` in root layout (`id="sandpack"`).
    -   Lazy: demo wrapper via `next/dynamic` `ssr: false`; loading fallback = static Shiki `<pre>` of the same code (readable pre-hydration; ~80 kB gz CodeMirror stays out of initial chunks).
    -   Deps: `customSetup.dependencies: { "@retreejs/react": "0.4.17" }` (core comes transitively; pin exact). Browser bundler, `react-ts` template only — **no Nodebox templates** (commercial-license restriction).
    -   Many embeds: `initMode: "user-visible"`, `recompileMode: "delayed"` (500 ms), `autorun: false` below the fold.
    -   Theming: custom `SandpackTheme` objects with CSS `var(--…)` color strings → free light/dark; `font.mono` = site mono font.
    -   Keyboard a11y: enable CodeMirror's Escape-then-Tab escape hatch on every embed (no keyboard traps).
    -   Risk noted: sandpack-react dormant since Apr 2025 (stable at react.dev scale; mitigations: pinned versions, self-hostable bundler, virtual `node_modules` pattern for unpublished builds).
    -   **Content rules**: (a) static Shiki by default — Sandpack only where editing teaches (quickstart, hook pages, playground); (b) a guide may only embed live examples for APIs present in the pinned published version — unpublished behavior gets a static block with a "since vX.Y" note; version bump + docs deploy are one release-checklist step; (c) **VERIFIED July 11 2026: 2023-11 decorators do NOT work in the Sandpack `react-ts` template** — the bundler applies legacy decorator transpilation and `@memo` fails at runtime with "could not find the decorated getter function". View-model/decorator content therefore uses static blocks only; also core is a peerDependency of react and must be listed explicitly in `customSetup.dependencies`.
-   Site state dogfoods `@retreejs/core` + `@retreejs/react` via `file:` refs.

## 7. API reference lockstep pipeline (implemented)

TanStack pattern. `website/scripts/generate-api-docs.mjs` (working; 89 MDX files generated in ~2 s):

1. Loops the four packages; per package runs TypeDoc programmatically (`Application.bootstrapWithPlugins`) with `typedoc-plugin-markdown@~4.11` + `typedoc-plugin-frontmatter`, `entryPoints: packages/<pkg>/src/index.ts` (source, not dist — zero drift), package tsconfig, `router: "member"`, table formats, `.mdx`, `sanitizeComments: true`, `publicPath: /api/<pkg>/`, `navigationJson`.
2. Output `website/content/api/<pkg>/` + `manifest.json` — gitignored, regenerated by `generate:api` before `next build`.
3. `/api/[pkg]/[[...slug]]` renders MDX with the site component map; sidebar from `navigation.json`; `generateStaticParams` from content tree.
4. **URL convention (committed)**: `/api/<pkg>/<kind>/<Name>` where kind ∈ classes|functions|interfaces|type-aliases|variables|enums (typedoc-plugin-markdown `member` router shape). Guides link only through a helper that validates targets at build.
5. **Quality gates**: TSDoc audit — every exported symbol has a one-line summary; the ~20 headline APIs get `@example` + `@see` links to their guide URLs (gives API→guide backlinks). Build-time dead-link check over all MDX (guides + generated).
6. Dev: chokidar watcher over `packages/*/src/**` regenerates the changed package. Pins: `typedoc@~0.28`, `typedoc-plugin-markdown@~4.11` (compat is per-minor). Root `npm run docs` untouched.

Fallback (documented): per-package `typedoc --json` → `typedoc-better-json` → custom RSC renderer (thirdweb pattern).

## 8. AI-readability layer

-   Serve repo `llms.txt` at `/llms.txt` (copied at build); consider `llms-full.txt` concatenation.
-   Every docs/API page also available as raw markdown (`/docs/<slug>.md`) + "Copy page as Markdown" button.
-   **Demo code must be authored as fenced code blocks in the MDX** (the Sandpack embed component consumes the blocks) so markdown exports and copy-page always contain the runnable code — this also provides the Shiki SSR fallback for free.

## 9. Launch scope

All pages responsive (visualizer mobile spec per §5.1), dark+light (contrast-validated tokens), reduced-motion safe (counters carry the message).

1. `/` home per §3.1.
2. `/why` + `/compare/mobx` + `/compare/valtio`.
3. `/docs`: Quickstart; Thinking in Retree; Hooks index (+playground) + 5 hook pages; Common pitfalls; Events & subscriptions (core); View models; Setup & decorators; Tree operations; Transactions & silent writes; Performance; Convex integration.
4. `/api/<pkg>` for all four packages (may be labeled beta).
5. Pagefind cmd+k; package-manager tabs; copy buttons; llms.txt + markdown routes; 404.

Priority if schedule slips: Quickstart, Thinking in Retree, hook pages are conversion-critical and non-negotiable; Performance and Convex guides may trail; useRaw page may follow the other hooks; API reference may ship beta-labeled.

Deferred post-launch: blog, testimonials (none real yet), live Convex-backed demo, full benchmark charts page.

## 10. Implementation milestones

1. ✅ Scaffold `website/` workspace (builds green; deps installed; workspace wired).
2. Design system: tokens (dark+light, `accent-text` ≥4.5:1 + `accent-glow`, contrast-validated **before page work**), no-flash theme script, fonts, nav/footer shells, MDX component map, Shiki setup. **Deliverable ✅ measured min+gzip (esbuild, externals react/react-dom, July 11 2026): `@retreejs/core` 18.6 kB gz; `core+react` 19.6 kB gz; `mobx` 18.5 kB gz; `mobx+mobx-react-lite` 20.2 kB gz; `valtio` 2.7 kB gz; `zustand` 0.4 kB gz. Ruling: no size claim in hero strip; comparison table states all numbers honestly ("comparable to the MobX stack; Valtio/Zustand are far smaller — if minimal bytes matter most, use them").**
3. Content pipeline: MDX loader; ✅ TypeDoc→MDX generation; /api routes; TSDoc audit pass; dead-link check; markdown export routes.
4. Marketing pages (§3.1, §5). Verify Sandpack decorator support (§6c) before View-model embeds.
5. Docs pages (§9.3) with embeds per §6 content rules.
6. Search + AI layer + polish (metadata/OG per-page titles targeting §4 queries, a11y checklist: cmd+k combobox pattern, CodeMirror tab escape, contrast, reduced motion).
7. QA panel (subagents per discipline) → fixes → `npm run test` + `npm run doctor` + `next build` green.

## 11. Resolved questions (panel answers adopted)

-   **Hero interactivity**: compact pure-Retree auto-playing visualizer; real, copy-pastable, Shiki-readable code pre-hydration; no Sandpack above the fold.
-   **/why vs /compare**: both — /why narrative + pairwise /compare/\* SEO pages; /compare redirects to /why.
-   **Benchmarks**: lean lightly at launch — methodology + open harness links, absolute numbers with named workloads only, never vs-self deltas; the visualizer carries the perf argument.
-   **Convex demo**: simulated transport, visibly labeled, linking the real sample.
-   **Launch docs**: §9.3 list (panel additions included); slip order per §9.
