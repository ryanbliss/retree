import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code/CodeBlock";
import {
    ComparisonTable,
    MobxStateTreeNote,
} from "@/components/compare/ComparisonTable";

export const metadata: Metadata = {
    title: "Retree vs MobX — a MobX alternative without observer()",
    description:
        "An honest comparison of Retree and MobX 6: observer() and actions vs plain hooks and assignment, computed values, tree semantics, mobx-state-tree, and measured bundle sizes. Verified July 2026.",
};

const retreeCounter = `import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

const counter = Retree.root({ count: 0 });

function Counter() {
    const state = useNode(counter);
    return (
        <button onClick={() => (state.count += 1)}>
            Count: {state.count}
        </button>
    );
}`;

const mobxCounter = `import { makeAutoObservable } from "mobx";
import { observer } from "mobx-react-lite";

class CounterStore {
    count = 0;
    constructor() {
        makeAutoObservable(this);
    }
    increment() {
        this.count += 1;
    }
}

const counter = new CounterStore();

const Counter = observer(function Counter() {
    return (
        <button onClick={() => counter.increment()}>
            Count: {counter.count}
        </button>
    );
});`;

export default function CompareMobxPage() {
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
                Retree vs MobX
            </h1>

            <div className="mt-5 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    If you like MobX&apos;s mutable model but are looking for an
                    alternative without <code>observer()</code> wrappers, this
                    page is for you. Retree and MobX solve the same problem —
                    mutate objects, re-render only what read them — with
                    different contracts. Everything below was verified against
                    MobX 6.16 with mobx-react-lite 4.1 in July 2026; if we got
                    something wrong,{" "}
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
                    The central difference is the contract with React. MobX 6
                    requires <code>observer()</code> around every component that
                    reads observables, and writes are expected to go through{" "}
                    <code>action</code> — <code>enforceActions</code> is on by
                    default. The sharp edge is what happens when you forget: an
                    observable passed into a non-<code>observer</code> child
                    silently stops being reactive. Retree has no equivalent
                    failure mode because there is no wrapper — components
                    subscribe with hooks (<code>useNode</code>,{" "}
                    <code>useTree</code>, <code>useSelect</code>,{" "}
                    <code>useRaw</code>), and writes are plain assignment with
                    no action requirement.
                </p>
                <p>
                    Here is the same counter in both libraries. The MobX version
                    uses its current, documented APIs —{" "}
                    <code>makeAutoObservable</code> in the constructor (which
                    also marks methods as actions) and <code>observer()</code>{" "}
                    from mobx-react-lite — not the legacy decorator style.
                </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CodeBlock
                    code={retreeCounter}
                    lang="tsx"
                    title="Counter — Retree 0.4"
                />
                <CodeBlock
                    code={mobxCounter}
                    lang="tsx"
                    title="Counter — MobX 6.16 + mobx-react-lite 4.1"
                />
            </div>

            <div className="mt-8 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    Class support is a strength both share: MobX with{" "}
                    <code>makeAutoObservable(this)</code>, Retree with no
                    registration call at all — pass a class instance to{" "}
                    <code>Retree.root</code> and its methods and fields just
                    work. Retree also layers optional standard 2023-11
                    decorators (<code>@select</code>, <code>@memo</code>,{" "}
                    <code>@ignore</code>, <code>@link</code>) on top for view
                    models that want them.
                </p>
                <p>
                    Trees are where the two diverge most. MobX core has no tree
                    semantics — no notion of a node&apos;s parent, no
                    move/clone/link — and defers that territory to
                    mobx-state-tree, a separate schema-based layer. In Retree,
                    tree operations are built into core:{" "}
                    <code>Retree.parent</code>, <code>Retree.move</code>,{" "}
                    <code>Retree.clone</code>, and <code>Retree.link</code> work
                    on your plain objects directly.
                </p>
                <p>
                    Where MobX clearly wins: a decade of production hardening, a
                    best-in-class computed engine, a large ecosystem, and
                    framework-agnostic usage well beyond React. Retree is v0.4.x
                    with a solo maintainer and no devtools yet — read the{" "}
                    <Link
                        href="/why"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        full trade-offs on /why
                    </Link>{" "}
                    before betting a large project on it.
                </p>
                <p>
                    Bundle size is a wash, and we&apos;ll say so plainly: in our
                    measurements (esbuild, min+gzip, react externalized, July
                    2026), Retree core + react is 19.6 kB and mobx +
                    mobx-react-lite is 20.2 kB. Nobody should pick between these
                    two libraries on size.
                </p>
            </div>

            <section aria-labelledby="mobx-table-heading" className="mt-12">
                <h2
                    id="mobx-table-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    Feature by feature
                </h2>
                <div className="mt-6">
                    <ComparisonTable columns={["retree", "mobx"]} />
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
                    href="/compare/valtio"
                    className="rounded-md border border-border-token px-4 py-2 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                    Retree vs Valtio
                </Link>
            </section>
        </main>
    );
}
