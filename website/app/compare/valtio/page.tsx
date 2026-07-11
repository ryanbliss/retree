import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code/CodeBlock";
import {
    ComparisonTable,
    MobxStateTreeNote,
} from "@/components/compare/ComparisonTable";

export const metadata: Metadata = {
    title: "Valtio vs Retree — a Valtio alternative with one object, not two",
    description:
        "An honest comparison of Valtio 2 and Retree as a Valtio alternative: proxy/useSnapshot and the state/snap split vs one mutable tree, subscription granularity, tree operations, Redux DevTools, and measured bundle sizes. Verified July 2026.",
};

const retreeCounter = `import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

const counter = Retree.root({ count: 0 });

function Counter() {
    // One object: read and write the same reference.
    const state = useNode(counter);
    return (
        <button onClick={() => (state.count += 1)}>
            Count: {state.count}
        </button>
    );
}`;

const valtioCounter = `import { proxy, useSnapshot } from "valtio";

const state = proxy({ count: 0 });

function Counter() {
    // Two objects: read from the frozen snap,
    // write to the mutable state proxy.
    const snap = useSnapshot(state);
    return (
        <button onClick={() => (state.count += 1)}>
            Count: {snap.count}
        </button>
    );
}`;

export default function CompareValtioPage() {
    return (
        <main
            data-pagefind-body
            data-pagefind-filter="section:Compare"
            className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
        >
            <p className="font-mono text-xs uppercase tracking-widest text-faint">
                Compare
            </p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Valtio vs Retree
            </h1>

            <div className="mt-5 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    Valtio and Retree are the two most similar libraries on this
                    site: both wrap your state in proxies, both let you mutate
                    it directly, and both re-render only the components that
                    read what changed. Everything below was verified against
                    Valtio 2.3 in July 2026; if we got something wrong,{" "}
                    <a
                        href="https://github.com/ryanbliss/retree"
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        submit a PR
                    </a>
                    .
                </p>
                <p>
                    The defining difference is how many objects you juggle.
                    Valtio splits state in two: you mutate the{" "}
                    <code>proxy</code> object and render from the frozen{" "}
                    <code>snap</code> that <code>useSnapshot</code> returns.
                    Valtio&apos;s own docs list the gotchas that follow from the
                    split: <code>React.memo</code> children can over-render when
                    handed snapshot objects they never accessed, controlled
                    inputs need <code>sync: true</code>, and object getters are
                    uncached and resolve against siblings only. Retree gives you
                    one object — the same reference is read in render and
                    mutated in handlers, and the subscription comes from which
                    node you pass to <code>useNode</code>.
                </p>
                <p>Here is the same counter in both libraries.</p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CodeBlock
                    code={retreeCounter}
                    lang="tsx"
                    title="Counter — Retree 0.4"
                />
                <CodeBlock
                    code={valtioCounter}
                    lang="tsx"
                    title="Counter — Valtio 2.3"
                />
            </div>

            <div className="mt-8 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    Granularity works differently too. Valtio tracks which
                    snapshot fields a component accessed and re-renders when
                    those change. Retree makes granularity structural and
                    explicit: <code>useNode(task)</code> subscribes to that
                    node&apos;s own fields, <code>useTree</code> widens to a
                    subtree, <code>useSelect</code> narrows to a projection, and{" "}
                    <code>useRaw</code> gives proxy-free reads for hot paths.
                    Explicit means you choose it — and choosing the wrong node
                    is on you (see{" "}
                    <Link
                        href="/docs/common-pitfalls"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        common pitfalls
                    </Link>
                    ).
                </p>
                <p>
                    Trees are Retree&apos;s home turf. Valtio has no tree
                    semantics — no structural parent, no move/clone/link. Retree
                    builds them into core: <code>Retree.parent</code>,{" "}
                    <code>Retree.move</code>, <code>Retree.clone</code>,{" "}
                    <code>Retree.link</code>. It also ships a first-party
                    backend integration (@retreejs/convex, for Convex); no
                    official backend integration exists for Valtio.
                </p>
                <p>
                    Now the other side of the ledger, stated plainly. Valtio is
                    2.7 kB min+gzip in our measurements; Retree core + react is
                    19.6 kB. That is not close — if minimal bytes matter most,
                    use Valtio. Valtio also supports Redux DevTools, which
                    Retree does not, and it is an established project with real
                    production mileage, where Retree is v0.4.x with a solo
                    maintainer. The{" "}
                    <Link
                        href="/why"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        trade-offs section on /why
                    </Link>{" "}
                    covers the rest.
                </p>
                <p>
                    The honest summary: reach for Valtio when you want the
                    smallest possible proxy-state library and DevTools; reach
                    for Retree when your state is a tree — nested nodes,
                    per-node subscriptions, parent/move/clone/link — and you
                    want one object instead of a state/snapshot pair.
                </p>
            </div>

            <section aria-labelledby="valtio-table-heading" className="mt-12">
                <h2
                    id="valtio-table-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    Feature by feature
                </h2>
                <div className="mt-6">
                    <ComparisonTable columns={["retree", "valtio"]} />
                </div>
            </section>

            <section className="mt-10">
                <MobxStateTreeNote />
            </section>

            <section className="mt-12 flex flex-wrap gap-3">
                <Link
                    href="/docs/quick-start"
                    className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                    Try the quickstart
                </Link>
                <Link
                    href="/why"
                    className="rounded-md border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                    Why Retree — live re-render comparison
                </Link>
                <Link
                    href="/compare/mobx"
                    className="rounded-md border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                    Retree vs MobX
                </Link>
            </section>
        </main>
    );
}
