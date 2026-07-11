import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code/CodeBlock";
import { CopyButton } from "@/components/code/CopyButton";
import { CompareVisualizer } from "@/components/home/CompareVisualizer";
import { GranularityDemo } from "@/components/home/GranularityDemo";
import { Reveal } from "@/components/home/Reveal";
import { TreeOpsDemo } from "@/components/home/TreeOpsDemo";
import { HeroVisualizer } from "@/components/visualizer/HeroVisualizer";

export const metadata: Metadata = {
    title: "Retree — your state tree, shaped like your component tree",
    description:
        "Mutate a plain TypeScript object; exactly the components that read it re-render. Reactive object trees for React with per-node subscriptions.",
};

const INSTALL_COMMAND = "npm i @retreejs/core @retreejs/react";

/* ------------------------------ code samples ------------------------------ */
/* Every sample below is grounded in the repo README (the published API). */

/* Mirrors components/visualizer/HeroVisualizer.tsx — the code that drives
 * the hero demo. Keep in sync if the demo state changes. */
const HERO_CODE = `const demo = Retree.root({
    tasks: [{ id: 1, title: "Ship the quickstart", done: false }],
    stats: { count: 0 },
});

function TaskRow({ task }: { task: (typeof demo.tasks)[number] }) {
    const state = useNode(task); // subscribes to this task only
    return <li onClick={() => (state.done = !state.done)}>{state.title}</li>;
}

demo.tasks[0].done = true; // ✅ that row re-renders — nothing else`;

const GRANULARITY_CODE = `const dashboard = Retree.root({
    header: { title: "Team dashboard" },
    stats: { views: 0 },
});

function StatsCard() {
    // Subscribes to dashboard.stats — and nothing else.
    const stats = useNode(dashboard.stats);
    return <span>{stats.views}</span>;
}

dashboard.stats.views += 1; // ✅ StatsCard re-renders
dashboard.header.title = "Ops"; // ❌ StatsCard does not re-render`;

const USE_SELECT_CODE = `import { Retree } from "@retreejs/core";
import { useSelect } from "@retreejs/react";

const project = Retree.root({
    tasks: [
        { title: "Docs", done: false },
        { title: "Tests", done: true },
    ],
});

function DoneCount() {
    const doneCount = useSelect(
        project.tasks,
        (tasks) => tasks.filter((task) => task.done).length,
        { listenerType: "treeChanged" }
    );

    return <span>{doneCount}</span>;
}

project.tasks[0].done = true; // ✅ re-renders DoneCount: 1 -> 2
project.tasks[0].title = "Better docs"; // ❌ no re-render: doneCount stayed 2`;

const TREE_OPS_CODE = `const task = board.backlog[0];

Retree.move(task, board.active); // transfer ownership
Retree.parent(task); // -> board.active

board.selected = Retree.link(task); // reactive pointer, no reparenting
board.backlog.push(Retree.clone(task)); // detached, independent copy`;

const CONVEX_CODE = `import { useNode, useRoot } from "@retreejs/react";
import { ConvexNode, ConvexQueryNode } from "@retreejs/convex";
import { RetreeConvexReactClient } from "@retreejs/react-convex";
import { api } from "../convex/_generated/api";

const convex = new RetreeConvexReactClient(
    process.env.NEXT_PUBLIC_CONVEX_URL!
);

class TasksState extends ConvexNode {
    public readonly tasks: ConvexQueryNode<typeof api.tasks.get>;

    constructor() {
        super(convex);
        this.tasks = this.query(api.tasks.get, { initialState: [] });
    }

    get dependencies() {
        return [];
    }
}

export function TaskList() {
    const root = useRoot(() => new TasksState());
    const state = useNode(root);

    return (
        <ul>
            {state.tasks.state?.map((task) => (
                <li key={task._id}>{task.text}</li>
            ))}
        </ul>
    );
}`;

/* The comparison side, unabridged, so skeptics can audit it (spec §5.1). */
const COMPARE_STORE_CODE = `// "idiomatic top-level store" pane — the exact pattern running above.
function StoreApp() {
    const [store, setStore] = useState(() => ({ tasks: initialTasks() }));

    const toggle = useCallback((id: number) => {
        setStore((previous) => ({
            ...previous,
            tasks: previous.tasks.map((task) =>
                task.id === id ? { ...task, done: !task.done } : task
            ),
        }));
    }, []);

    const doneCount = store.tasks.filter((task) => task.done).length;

    return (
        <Pane doneCount={doneCount}>
            {store.tasks.map((task) => (
                <StoreRow key={task.id} task={task} onToggle={toggle} />
            ))}
        </Pane>
    );
}

const StoreRow = React.memo(function StoreRow({ task, onToggle }) {
    return <Row done={task.done} onToggle={() => onToggle(task.id)} />;
});`;

const COMPARE_RETREE_CODE = `// "Retree useNode" pane — the exact pattern running above.
const tree = Retree.root({ tasks: initialTasks() });

function RetreeApp() {
    const tasks = useNode(tree.tasks);
    return (
        <Pane doneCount={<DoneCount />}>
            {tasks.map((task) => (
                <RetreeRow key={task.id} task={task} />
            ))}
        </Pane>
    );
}

function RetreeRow({ task }) {
    const state = useNode(task);
    return (
        <Row done={state.done} onToggle={() => (state.done = !state.done)} />
    );
}

function DoneCount() {
    const doneCount = useSelect(
        tree.tasks,
        (tasks) => tasks.filter((task) => task.done).length,
        { listenerType: "treeChanged" }
    );
    return <>{doneCount}/3</>;
}`;

/* ------------------------------ page content ------------------------------ */

const CLAIMS: { title: React.ReactNode; detail: string }[] = [
    {
        title: (
            <>
                No <code>observer()</code> HOCs, no action wrappers
            </>
        ),
        detail: "Components are plain functions. Writes are plain assignments.",
    },
    {
        title: "Tree operations built in",
        detail: "parent, move, link, clone — ownership is explicit, not a separate library.",
    },
    {
        title: "React 16.8 → 19",
        detail: "One hooks API across every React release since hooks existed.",
    },
    {
        title: "Class view models and plain objects",
        detail: "Mix ReactiveNode classes with plain objects, arrays, Maps, and Sets in one tree.",
    },
];

interface PackageCard {
    name: string;
    slug: string;
    description: string;
    pairing: string;
    docsHref: string;
    docsLabel: string;
}

const PACKAGES: PackageCard[] = [
    {
        name: "@retreejs/core",
        slug: "core",
        description:
            "The tree engine: proxies, events, transactions, memoized getters, and ReactiveNode. No React required.",
        pairing: "Pairs with any UI layer — or none.",
        docsHref: "/docs/events-and-subscriptions",
        docsLabel: "Events & subscriptions",
    },
    {
        name: "@retreejs/react",
        slug: "react",
        description:
            "Hooks that bind components to nodes: useRoot, useNode, useTree, useSelect, and useRaw.",
        pairing: "Pairs with @retreejs/core.",
        docsHref: "/docs/react",
        docsLabel: "Choosing a hook",
    },
    {
        name: "@retreejs/convex",
        slug: "convex",
        description:
            "Convex queries, actions, mutations, and connection state written into Retree nodes — reconciled by _id, with narrow optimistic updates.",
        pairing: "Pairs with @retreejs/core and convex.",
        docsHref: "/docs/convex",
        docsLabel: "Convex integration",
    },
    {
        name: "@retreejs/react-convex",
        slug: "react-convex",
        description:
            "Adapts Convex's ConvexReactClient to the Retree Convex interface.",
        pairing:
            "Use instead of running separate clients for Convex React hooks and Retree Convex nodes.",
        docsHref: "/docs/convex",
        docsLabel: "Convex integration",
    },
];

function InstallCommand() {
    return (
        <figure className="relative overflow-hidden rounded-lg border border-border-token bg-code-bg">
            <pre className="overflow-x-auto py-3 pl-4 pr-12 font-mono text-[13px] text-foreground">
                <span aria-hidden className="select-none text-faint">
                    ${" "}
                </span>
                {INSTALL_COMMAND}
            </pre>
            <CopyButton text={INSTALL_COMMAND} alwaysVisible />
        </figure>
    );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
    return (
        <p className="font-mono text-xs uppercase tracking-widest text-faint">
            {children}
        </p>
    );
}

export default function Home() {
    return (
        <main>
            {/* 1 — Hero */}
            <section className="mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 lg:pb-24 lg:pt-20">
                <div className="grid items-center gap-10 lg:grid-cols-2">
                    <Reveal mode="mount">
                        <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                            Your state tree, shaped like your component tree.
                        </h1>
                        <p className="mt-4 max-w-xl text-lg text-muted">
                            Mutate a plain TypeScript object; exactly the
                            components that read it re-render.
                        </p>
                        <div className="mt-6 max-w-md">
                            <InstallCommand />
                        </div>
                        <div className="mt-6 flex flex-wrap items-center gap-3">
                            <Link
                                href="/docs/quick-start"
                                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Get started
                            </Link>
                            <a
                                href="https://github.com/ryanbliss/retree"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-border-token px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                GitHub
                            </a>
                        </div>
                        <div className="mt-8 max-w-xl">
                            <CodeBlock
                                code={HERO_CODE}
                                lang="tsx"
                                title="the entire state layer of the demo →"
                            />
                        </div>
                    </Reveal>
                    <Reveal mode="mount" delay={0.08}>
                        <HeroVisualizer />
                        <p className="mt-2 text-xs text-faint">
                            A real Retree tree running in this page — the loop
                            mutates it with plain assignments until you take
                            over.
                        </p>
                    </Reveal>
                </div>
            </section>

            {/* 2 — Concrete claims strip */}
            <section
                aria-label="What you get"
                className="border-y border-border-token bg-surface"
            >
                <div className="mx-auto grid max-w-7xl gap-px px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
                    {CLAIMS.map((claim, index) => (
                        <Reveal
                            key={index}
                            delay={index * 0.06}
                            className="px-2 py-3 lg:px-4"
                        >
                            <p className="font-mono text-sm text-foreground">
                                {claim.title}
                            </p>
                            <p className="mt-1.5 text-sm text-muted">
                                {claim.detail}
                            </p>
                        </Reveal>
                    ))}
                </div>
            </section>

            {/* 3 — Comparative re-render visualizer */}
            <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                <Reveal className="max-w-2xl">
                    <Eyebrow>the difference</Eyebrow>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                        Same app. Watch the render counters.
                    </h2>
                    <p className="mt-3 text-muted">
                        Toggle tasks on either side. With a top-level store, the
                        owning component re-renders on every write —{" "}
                        <code>React.memo</code> keeps siblings quiet, but the
                        owner still runs. With Retree, each row subscribes to
                        its own node, so the parent&apos;s counter never moves.
                    </p>
                </Reveal>
                <Reveal delay={0.08} className="mt-8">
                    <CompareVisualizer />
                </Reveal>
                <Reveal delay={0.1} className="mt-6">
                    <details className="group rounded-lg border border-border-token bg-surface px-4 py-3">
                        <summary className="cursor-pointer font-mono text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                            Audit both panes — the comparison side is a single{" "}
                            <code>useState</code> store with immutable updates
                            and <code>React.memo</code> rows, not a strawman
                        </summary>
                        <div className="mt-2 grid gap-4 lg:grid-cols-2">
                            <CodeBlock
                                code={COMPARE_STORE_CODE}
                                lang="tsx"
                                title="top-level-store.tsx"
                            />
                            <CodeBlock
                                code={COMPARE_RETREE_CODE}
                                lang="tsx"
                                title="retree.tsx"
                            />
                        </div>
                    </details>
                    <p className="mt-6">
                        <Link
                            href="/why"
                            className="font-mono text-sm text-accent underline-offset-4 hover:underline"
                        >
                            Why Retree — the full comparison, trade-offs
                            included →
                        </Link>
                    </p>
                </Reveal>
            </section>

            {/* 4 — Feature walk */}
            <section className="border-t border-border-token">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                    <Reveal className="max-w-2xl">
                        <Eyebrow>how it works</Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Four ideas, in adoption order.
                        </h2>
                    </Reveal>

                    <div className="mt-12 space-y-16 lg:space-y-20">
                        {/* 01 — plain-assignment mutation, live demo */}
                        <FeatureItem
                            number="01"
                            title="Mutate with plain assignments"
                            demo={<GranularityDemo />}
                            body={
                                <>
                                    <p>
                                        Pass any object to{" "}
                                        <code>Retree.root</code>, read a node
                                        with <code>useNode</code>, and assign to
                                        it like ordinary TypeScript. A component
                                        re-renders only when a node it
                                        subscribed to changes — writes to a
                                        nested child emit on that child, not on
                                        every ancestor.
                                    </p>
                                    <CodeBlock
                                        code={GRANULARITY_CODE}
                                        lang="tsx"
                                    />
                                </>
                            }
                            link={{
                                href: "/docs/react/use-node",
                                label: "useNode guide",
                            }}
                        />

                        {/* 02 — useSelect, static code */}
                        <FeatureItem
                            number="02"
                            title="Derive values with useSelect"
                            reversed
                            demo={
                                <CodeBlock
                                    code={USE_SELECT_CODE}
                                    lang="tsx"
                                    title="done-count.tsx"
                                />
                            }
                            body={
                                <p>
                                    <code>useSelect</code> re-renders a
                                    component only when the selected value
                                    changes. Title edits don&apos;t touch a
                                    done-count; neither does anything else that
                                    leaves the selection equal. It can even
                                    infer dependencies from the reads inside the
                                    selector.
                                </p>
                            }
                            link={{
                                href: "/docs/react/use-select",
                                label: "useSelect guide",
                            }}
                        />

                        {/* 03 — tree semantics, live demo */}
                        <FeatureItem
                            number="03"
                            title="Tree semantics are built in"
                            demo={<TreeOpsDemo />}
                            body={
                                <>
                                    <p>
                                        Every node has one structural parent,
                                        and changing that is a first-class
                                        operation — not a data-modeling
                                        exercise. <code>Retree.move</code>{" "}
                                        transfers ownership,{" "}
                                        <code>Retree.link</code> points without
                                        reparenting, <code>Retree.clone</code>{" "}
                                        copies, and <code>Retree.parent</code>{" "}
                                        lets a node operate on its own
                                        container.
                                    </p>
                                    <CodeBlock code={TREE_OPS_CODE} lang="ts" />
                                </>
                            }
                            link={{
                                href: "/docs/tree-operations",
                                label: "Tree operations guide",
                            }}
                        />

                        {/* 04 — Convex teaser, static code */}
                        <FeatureItem
                            number="04"
                            title="Sync a tree to a backend"
                            reversed
                            demo={
                                <CodeBlock
                                    code={CONVEX_CODE}
                                    lang="tsx"
                                    title="tasks-state.tsx"
                                />
                            }
                            body={
                                <p>
                                    <code>@retreejs/convex</code> writes{" "}
                                    <a
                                        href="https://convex.dev"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent underline-offset-4 hover:underline"
                                    >
                                        Convex
                                    </a>{" "}
                                    query results into Retree nodes: documents
                                    reconcile by <code>_id</code>, optimistic
                                    updates apply narrowly to existing query
                                    state, and your components keep reading the
                                    same tree they always did.
                                </p>
                            }
                            link={{
                                href: "/docs/convex",
                                label: "Convex integration guide",
                            }}
                        />
                    </div>

                    {/* when you need more */}
                    <Reveal className="mt-16">
                        <div className="rounded-xl border border-border-token bg-surface p-6">
                            <h3 className="font-mono text-sm uppercase tracking-widest text-faint">
                                when you need more
                            </h3>
                            <div className="mt-4 grid gap-6 sm:grid-cols-3">
                                <MoreLink
                                    href="/docs/view-models"
                                    title="View models & decorators"
                                    detail="ReactiveNode, @select, @memo, @fnMemo, @ignore, @link — keep logic on the node while renders stay selective."
                                />
                                <MoreLink
                                    href="/docs/transactions"
                                    title="Transactions & silent writes"
                                    detail="Retree.runTransaction batches writes into one flush; Retree.runSilent skips emission entirely."
                                />
                                <MoreLink
                                    href="/docs/performance"
                                    title="Raw escape hatches"
                                    detail="Retree.raw, useRaw, peekInto, and untracked for native-speed, proxy-free reads."
                                />
                            </div>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* 5 — Per-package cards */}
            <section className="border-t border-border-token bg-surface">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
                    <Reveal className="max-w-2xl">
                        <Eyebrow>packages</Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Four packages, one tree.
                        </h2>
                    </Reveal>
                    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {PACKAGES.map((pkg, index) => (
                            <Reveal key={pkg.slug} delay={index * 0.06}>
                                <article className="flex h-full flex-col rounded-xl border border-border-token bg-background p-5">
                                    <h3 className="font-mono text-sm font-semibold text-foreground">
                                        {pkg.name}
                                    </h3>
                                    <p className="mt-2 text-sm text-muted">
                                        {pkg.description}
                                    </p>
                                    <p className="mt-2 text-xs text-faint">
                                        {pkg.pairing}
                                    </p>
                                    <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4">
                                        <Link
                                            href={`/api/${pkg.slug}`}
                                            className="font-mono text-xs text-accent underline-offset-4 hover:underline"
                                        >
                                            API reference
                                        </Link>
                                        <Link
                                            href={pkg.docsHref}
                                            className="font-mono text-xs text-accent underline-offset-4 hover:underline"
                                        >
                                            {pkg.docsLabel}
                                        </Link>
                                    </div>
                                </article>
                            </Reveal>
                        ))}
                    </div>
                </div>
            </section>

            {/* 6 — Performance philosophy strip */}
            <section className="border-t border-border-token">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
                    <Reveal className="max-w-3xl">
                        <Eyebrow>performance</Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Measured in the open.
                        </h2>
                        <p className="mt-3 text-muted">
                            Retree&apos;s performance argument is the
                            architecture: subscriptions attach to individual
                            nodes, so a write notifies the components that read
                            that node — not your whole app. The numbers behind
                            that claim come from an open benchmark harness in
                            the repository, run as named workloads (transaction
                            batching, reactive dependency fan-out, subscription
                            setup) with absolute timings. No cherry-picked
                            deltas on this page — clone the repo and run it on
                            your machine.
                        </p>
                        <p className="mt-5">
                            <a
                                href="https://github.com/ryanbliss/retree/tree/main/benchmarks"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-border-token px-4 py-2 font-mono text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Browse the benchmark harness →
                            </a>
                        </p>
                    </Reveal>
                </div>
            </section>

            {/* 7 — Final CTA */}
            <section className="border-t border-border-token bg-surface">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                    <Reveal className="mx-auto max-w-xl text-center">
                        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                            Start with one object.
                        </h2>
                        <p className="mt-3 text-muted">
                            Make it a root, read it with a hook, mutate it in
                            plain TypeScript.
                        </p>
                        <div className="mx-auto mt-6 max-w-md text-left">
                            <InstallCommand />
                        </div>
                        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                            <Link
                                href="/docs/quick-start"
                                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Get started
                            </Link>
                            <a
                                href="https://github.com/ryanbliss/retree"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-border-token px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Star on GitHub
                            </a>
                        </div>
                    </Reveal>
                </div>
            </section>
        </main>
    );
}

function FeatureItem({
    number,
    title,
    body,
    demo,
    link,
    reversed = false,
}: {
    number: string;
    title: string;
    body: React.ReactNode;
    demo: React.ReactNode;
    link: { href: string; label: string };
    reversed?: boolean;
}) {
    return (
        <Reveal>
            <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
                <div className={`min-w-0 ${reversed ? "lg:order-2" : ""}`}>
                    <p className="font-mono text-sm text-accent">{number}</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                        {title}
                    </h3>
                    <div className="mt-3 space-y-4 text-sm leading-relaxed text-muted [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-foreground">
                        {body}
                    </div>
                    <p className="mt-4">
                        <Link
                            href={link.href}
                            className="font-mono text-xs text-accent underline-offset-4 hover:underline"
                        >
                            {link.label} →
                        </Link>
                    </p>
                </div>
                <div className={`min-w-0 ${reversed ? "lg:order-1" : ""}`}>
                    {demo}
                </div>
            </div>
        </Reveal>
    );
}

function MoreLink({
    href,
    title,
    detail,
}: {
    href: string;
    title: string;
    detail: string;
}) {
    return (
        <Link href={href} className="group block">
            <p className="text-sm font-medium text-foreground group-hover:text-accent">
                {title}
            </p>
            <p className="mt-1 text-xs text-muted">{detail}</p>
        </Link>
    );
}
