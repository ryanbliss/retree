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

const retreeNested = `import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

const board = Retree.root({
    columns: [
        {
            title: "In progress",
            cards: [
                {
                    title: "Ship v1",
                    checklist: [
                        { text: "Write docs", done: false },
                        { text: "Cut release", done: false },
                    ],
                },
            ],
        },
        // ...more columns
    ],
});

type ChecklistItem = { text: string; done: boolean };

function ChecklistRow({ item }: { item: ChecklistItem }) {
    // Subscribe to this row's node — nothing else.
    const row = useNode(item);
    return (
        <label>
            <input
                type="checkbox"
                checked={row.done}
                onChange={() => (row.done = !row.done)}
            />
            {row.text}
        </label>
    );
}

// Three levels deep, plain assignment, from anywhere:
board.columns[2].cards[0].checklist[1].done = true;
// Exactly one ChecklistRow re-renders. No observer(),
// no action, no memoization pass.`;

const mobxNested = `import { makeAutoObservable } from "mobx";
import { observer } from "mobx-react-lite";

class BoardStore {
    columns = [
        {
            title: "In progress",
            cards: [
                {
                    title: "Ship v1",
                    checklist: [
                        { text: "Write docs", done: false },
                        { text: "Cut release", done: false },
                    ],
                },
            ],
        },
        // ...more columns
    ];
    constructor() {
        makeAutoObservable(this);
    }
    toggle(item: { done: boolean }) {
        // Writes go through an action —
        // enforceActions is on by default.
        item.done = !item.done;
    }
}

const board = new BoardStore();

type ChecklistItem = { text: string; done: boolean };

// Fine-grained tracking works here too — as long as
// every component reading the board is wrapped:
const ChecklistRow = observer(function ChecklistRow({
    item,
}: {
    item: ChecklistItem;
}) {
    return (
        <label>
            <input
                type="checkbox"
                checked={item.done}
                onChange={() => board.toggle(item)}
            />
            {item.text}
        </label>
    );
});
// Miss observer() on one child and that child
// silently stops updating.`;

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
                    Start with the case Retree is built for: a write three
                    levels deep in a nested tree, and exactly one row
                    re-rendering. Both versions below achieve fine-grained
                    updates — the difference is what each one demands from every
                    component along the way. The MobX version uses its current,
                    documented APIs — <code>makeAutoObservable</code> in the
                    constructor (which also marks methods as actions) and{" "}
                    <code>observer()</code> from mobx-react-lite — not the
                    legacy decorator style.
                </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CodeBlock
                    code={retreeNested}
                    lang="tsx"
                    title="Deeply nested write — Retree 0.5"
                />
                <CodeBlock
                    code={mobxNested}
                    lang="tsx"
                    title="Deeply nested write — MobX 6.16 + mobx-react-lite 4.1"
                />
            </div>

            <div className="mt-8 max-w-3xl space-y-4 text-base leading-7 text-muted">
                <p>
                    That is the central difference in one example. MobX 6
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
                    The simplest case shows the same contract with less ceremony
                    on both sides. Here is a counter in each:
                </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CodeBlock
                    code={retreeCounter}
                    lang="tsx"
                    title="Counter — Retree 0.5"
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
                    What MobX brings that Retree doesn&apos;t: a decade of
                    production hardening, a best-in-class computed engine, a
                    large ecosystem, and framework-agnostic usage well beyond
                    React. Retree is v0.5.x — what it offers against that
                    maturity is a smaller surface you can audit directly, with
                    the test suite and benchmark harness open in the repo. The{" "}
                    <Link
                        href="/why"
                        className="text-accent underline underline-offset-2 hover:no-underline"
                    >
                        full trade-offs are on /why
                    </Link>
                    , stated plainly.
                </p>
                <p>
                    Bundle size mildly favors Retree: in our measurements
                    (esbuild, min+gzip, react externalized, July 2026), Retree
                    core + react is 18.1 kB and mobx + mobx-react-lite is 21.5
                    kB — with @retreejs/core carrying zero runtime dependencies.
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
