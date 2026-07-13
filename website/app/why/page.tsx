import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code/CodeBlock";
import {
    ComparisonTable,
    MobxStateTreeNote,
} from "@/components/compare/ComparisonTable";
import { ComparativeVisualizer } from "@/components/visualizer/ComparativeVisualizer";

export const metadata: Metadata = {
    title: "Why Retree — state that matches your component tree",
    description:
        "The one idea behind Retree, a live re-render comparison against an idiomatic React store, a feature table vs MobX and Valtio verified July 2026, and Retree's trade-offs.",
};

const deepWrite = `// A board, three levels deep — plain assignment:
board.columns[2].cards[0].checklist[1].done = true;

// Exactly one component re-renders: the row that called
// useNode(item) on that checklist item. No observer()
// wrapper, no snapshot juggling, no memoization pass.`;

const demosDir = path.join(process.cwd(), "components", "compare", "demos");

function readDemoSource(fileName: string): string {
    return readFileSync(path.join(demosDir, fileName), "utf8");
}

export default function WhyPage() {
    const reactSource = readDemoSource("ReactTasksDemo.tsx");
    const retreeSource = readDemoSource("RetreeTasksDemo.tsx");

    return (
        <main
            data-pagefind-body
            data-pagefind-filter="section:Why Retree"
            className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
        >
            {/* Intro */}
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                Why Retree
            </p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Subscriptions that match your component tree
            </h1>
            <div className="mt-5 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    Retree is built on one idea. Your UI is a tree of
                    components, and your state is a tree of objects — so a
                    component should subscribe to the node of state it actually
                    reads, and re-render only when that node changes.
                </p>
                <p>
                    A common React pattern instead keeps state in one top-level
                    store and passes it down. Every update flows through the
                    store owner, and granularity is something you add back by
                    hand — <code>React.memo</code>, <code>useCallback</code>,
                    immutable spread updates. Retree flips that: state is a
                    plain TypeScript object tree, you mutate it with plain
                    assignment, and each component picks its own subscription
                    with <code>useNode</code> / <code>useTree</code> /{" "}
                    <code>useSelect</code> / <code>useRaw</code>.
                </p>
                <p>
                    The payoff is largest where state runs deep. This is the
                    write Retree is built for:
                </p>
            </div>

            <div className="mt-6 max-w-3xl">
                <CodeBlock
                    code={deepWrite}
                    lang="ts"
                    title="One deep write, one re-render"
                />
            </div>

            <div className="mt-6 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    See for yourself — both implementations below are complete,
                    unsimplified, and shown in full under &quot;View
                    source&quot;. The React side is written the way a careful
                    React developer would write it.
                </p>
            </div>

            {/* Comparative visualizer */}
            <div className="mt-8">
                <ComparativeVisualizer
                    reactSource={
                        <CodeBlock
                            code={reactSource}
                            lang="tsx"
                            title="components/compare/demos/ReactTasksDemo.tsx"
                        />
                    }
                    retreeSource={
                        <CodeBlock
                            code={retreeSource}
                            lang="tsx"
                            title="components/compare/demos/RetreeTasksDemo.tsx"
                        />
                    }
                />
            </div>

            {/* Comparison table */}
            <section aria-labelledby="comparison-heading" className="mt-16">
                <h2
                    id="comparison-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    How Retree compares
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-muted">
                    One table, verified against MobX 6.16 and Valtio 2.3 in July
                    2026 — including the rows where Retree is behind. Pairwise
                    write-ups:{" "}
                    <Link
                        href="/compare/mobx"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        Retree vs MobX
                    </Link>{" "}
                    and{" "}
                    <Link
                        href="/compare/valtio"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        Retree vs Valtio
                    </Link>
                    .
                </p>
                <div className="mt-6">
                    <ComparisonTable />
                </div>
            </section>

            {/* mobx-state-tree */}
            <section aria-labelledby="mst-heading" className="mt-12">
                <h2 id="mst-heading" className="sr-only">
                    mobx-state-tree
                </h2>
                <MobxStateTreeNote />
            </section>

            {/* Credit where due */}
            <section aria-labelledby="credit-heading" className="mt-16">
                <h2
                    id="credit-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    Credit where due
                </h2>
                <div className="mt-4 max-w-3xl space-y-4 text-base leading-7 text-muted">
                    <p>
                        MobX has a decade of production hardening and a
                        best-in-class computed engine — on derived data, it sets
                        the bar. The price is <code>observer()</code> around
                        every reading component and actions around writes.
                        Retree&apos;s bet is that you can keep the mutable model
                        and drop both: hooks pick the subscription, plain
                        assignment does the writing.
                    </p>
                    <p>
                        Valtio is 2.8 kB min+gzip in our measurements to
                        Retree&apos;s 20.5 kB for core + react, and it ships
                        Redux DevTools support, which Retree does not yet. What
                        Retree&apos;s bytes buy: per-node subscriptions, tree
                        operations (parent / move / clone / link), view models
                        with optional decorators, transactions, and a
                        first-party Convex integration — all in one object, with
                        no state/snapshot split.
                    </p>
                    <p>
                        For a small, flat store — a handful of top-level fields,
                        no nesting — Zustand (0.4 kB in the same measurement)
                        covers it; Retree earns its bytes when your state is
                        genuinely a tree.
                    </p>
                </div>
            </section>

            {/* Trade-offs */}
            <section aria-labelledby="tradeoffs-heading" className="mt-16">
                <h2
                    id="tradeoffs-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    Trade-offs
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-muted">
                    Every library has them. Here are Retree&apos;s, and what you
                    get in return.
                </p>

                <div className="mt-6 space-y-8">
                    <div className="max-w-3xl">
                        <h3 className="text-lg font-semibold text-foreground">
                            1. External-store consistency is not transition
                            state
                        </h3>
                        <p className="mt-2 text-base leading-7 text-muted">
                            Retree&apos;s hooks (<code>useNode</code>,{" "}
                            <code>useTree</code>, <code>useSelect</code>,{" "}
                            <code>useRaw</code>) use React&apos;s{" "}
                            <code>useSyncExternalStore</code> protocol with
                            cached, listener-independent version tokens. You can
                            read the adapter directly in{" "}
                            <a
                                href="https://github.com/ryanbliss/retree/blob/main/packages/retree-react/src/internals/externalStore.ts"
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent underline underline-offset-2 hover:no-underline"
                            >
                                the hook source
                            </a>
                            . That closes render-to-subscribe gaps and lets
                            React restart work when a Retree version changes
                            before commit. The trade-off is that Retree proxies
                            are still live mutable objects, not immutable
                            historical snapshots. A mutation inside{" "}
                            <code>startTransition</code> therefore remains a
                            synchronous external-store update; use a selected
                            primitive or immutable projection when UI work needs
                            to be deferred.
                        </p>
                    </div>

                    <div className="max-w-3xl">
                        <h3 className="text-lg font-semibold text-foreground">
                            2. React Compiler
                        </h3>
                        <p className="mt-2 text-base leading-7 text-muted">
                            This site itself runs with{" "}
                            <code>reactCompiler: true</code> in its Next.js
                            config. Retree&apos;s hooks are annotated with{" "}
                            <code>&quot;use no memo&quot;</code>, so the
                            compiler skips memoizing the hooks&apos; own
                            internals instead of mis-optimizing their
                            subscription mechanics; your compiled components
                            call them normally. It is an opt-out, not a deep
                            integration — and it works: this compiled site
                            dogfoods Retree&apos;s hooks for its own state.
                        </p>
                    </div>

                    <div className="max-w-3xl">
                        <h3 className="text-lg font-semibold text-foreground">
                            3. Choosing the right node is on you
                        </h3>
                        <p className="mt-2 text-base leading-7 text-muted">
                            Per-node subscriptions are explicit.{" "}
                            <code>useNode(project)</code> re-renders for changes
                            to <code>project</code>&apos;s own fields — not for
                            a write to <code>project.tasks[0].text</code>; the
                            component reading that task needs{" "}
                            <code>useNode(task)</code>. This is the model
                            working as designed — granularity you can see — but
                            it is a real thing to learn, and getting it wrong
                            means a stale view.{" "}
                            <Link
                                href="/docs/common-pitfalls"
                                className="text-accent underline underline-offset-2 hover:no-underline"
                            >
                                Common pitfalls
                            </Link>{" "}
                            walks through every known trap.
                        </p>
                    </div>

                    <div className="max-w-3xl">
                        <h3 className="text-lg font-semibold text-foreground">
                            4. Project status
                        </h3>
                        <p className="mt-2 text-base leading-7 text-muted">
                            Retree is v0.5.x, MIT-licensed, and built by a solo
                            maintainer. It is pre-1.0: minor versions may move
                            APIs, and the ecosystem of tutorials and Stack
                            Overflow answers is still growing. What you can
                            audit today: the{" "}
                            <a
                                href="https://github.com/ryanbliss/retree/tree/main/packages"
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent underline underline-offset-2 hover:no-underline"
                            >
                                test suite
                            </a>{" "}
                            lives beside the source in every package, and the{" "}
                            <a
                                href="https://github.com/ryanbliss/retree/tree/main/benchmarks"
                                target="_blank"
                                rel="noreferrer"
                                className="text-accent underline underline-offset-2 hover:no-underline"
                            >
                                benchmark harness and findings
                            </a>{" "}
                            are open. Pre-1.0 cuts both ways: the surface area
                            is small enough to read in a sitting, and issues you
                            file go straight to the person who wrote the code.
                        </p>
                    </div>
                </div>
            </section>

            {/* Next steps */}
            <section className="mt-16 rounded-xl border border-border-token bg-surface p-6">
                <h2 className="text-lg font-semibold text-foreground">
                    Try it on your own state
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                    The quickstart gets you from install to a working app —
                    mutate a plain object, watch exactly one component
                    re-render.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                    <Link
                        href="/docs/quick-start"
                        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                    >
                        Get started
                    </Link>
                    <Link
                        href="/compare/mobx"
                        className="rounded-md border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                        Retree vs MobX
                    </Link>
                    <Link
                        href="/compare/valtio"
                        className="rounded-md border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                        Retree vs Valtio
                    </Link>
                </div>
            </section>
        </main>
    );
}
