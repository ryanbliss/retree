import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/code/CodeBlock";
import { CompareVisualizer } from "@/components/home/CompareVisualizer";
import { DecoratorShowcase } from "@/components/home/DecoratorShowcase";
import { GranularityDemo } from "@/components/home/GranularityDemo";
import { InstallTabs } from "@/components/home/InstallTabs";
import { Reveal } from "@/components/home/Reveal";
import { TreeOpsDemo } from "@/components/home/TreeOpsDemo";
import {
    ArrowRightIcon,
    AtSignIcon,
    BoltIcon,
    BookIcon,
    BranchIcon,
    ColumnsIcon,
    GaugeIcon,
    LayersIcon,
    PackageIcon,
    PencilIcon,
    PlugIcon,
    SignalIcon,
    TargetIcon,
    TreeIcon,
} from "@/components/home/icons";
import { HeroBackground } from "@/components/visualizer/HeroBackground";
import { HeroVisualizer } from "@/components/visualizer/HeroVisualizer";

export const metadata: Metadata = {
    title: "Retree — simple state framework for precise, lighting-fast reactive rendering",
    description: "React state done better.",
};

/* ------------------------------ code samples ------------------------------ */
/* Every sample below is grounded in the repo README (the published API). */

/* Mirrors components/visualizer/HeroVisualizer.tsx — the code that drives
 * the hero demo. Keep in sync if the demo state changes. */
const HERO_CODE = `const demo = Retree.root({
    tasks: [
        { id: 1, title: "Ship the quickstart", done: false, subtasks: [] },
        { id: 2, title: "Write tests", done: true, subtasks: [/* 3 deep */] },
    ],
    stats: { count: 0 },
});

function TaskRow({ task }: { task: HeroTask }) {
    const state = useNode(task); // subscribes to this task only
    return <li onClick={() => (state.done = !state.done)}>{state.title}</li>;
}

demo.tasks[1].subtasks[0].subtasks[0].done = true;
// ✅ that one deep row re-renders — no ancestor moves`;

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
board.selected = Retree.link(task); // reactive pointer, no reparenting
board.backlog.push(Retree.clone(task)); // detached, independent copy

// The ✕ button in the demo: delete a task without knowing
// which list owns it by now — ask for its parent.
const owner = Retree.parent(task); // -> board.active
owner.splice(owner.indexOf(task), 1);`;

/* Decorator showcase code — each block is exactly the code running in the
 * matching components/home/DecoratorShowcase.tsx mode. Keep them in sync. */

const DEPENDENCIES_CODE = `import { ReactiveNode, Retree } from "@retreejs/core";

class EvenCounter extends ReactiveNode {
    public numbers: number[] = [];

    get evenCount(): number {
        return this.numbers.filter((value) => value % 2 === 0).length;
    }

    get dependencies() {
        // Subscribe to the numbers array, but emit only when the
        // compared value — evenCount — actually changes.
        return [this.dependency(this.numbers, [this.evenCount])];
    }
}

const counter = Retree.root(new EvenCounter());
const state = useNode(counter); // in the badge panel

counter.numbers.push(2); // ✅ evenCount changed — the panel re-renders
counter.numbers.push(3); // ❌ evenCount unchanged — the panel stays quiet`;

const SELECT_CODE = `import { ReactiveNode, Retree, select } from "@retreejs/core";

class TaskBoard extends ReactiveNode {
    public tasks = [
        { title: "Write the docs", done: true },
        { title: "Ship the site", done: false },
    ];

    // Traps the reads inside the getter — the board emits only when
    // the selected dependencies (each task's done) change.
    @select
    get doneCount(): number {
        return this.tasks.filter((task) => task.done).length;
    }

    get dependencies() {
        return [];
    }
}

const board = Retree.root(new TaskBoard());

board.tasks[0].done = false; // ✅ doneCount changed — the board emits
board.tasks[0].title = "Docs v2"; // ❌ board silent — only the row re-renders`;

const MEMO_CODE = `import { ReactiveNode, Retree, memo } from "@retreejs/core";

let filterComputations = 0;

class CardFilter extends ReactiveNode {
    public cards = [{ text: "alpha" }, { text: "beta" }, { text: "alphabet" }];
    public searchText = "alpha";
    public label = "cards"; // unrelated to the memoized getter

    @memo
    get filtered(): { text: string }[] {
        filterComputations += 1; // instrumentation shown in the demo
        return this.cards.filter((card) => card.text.includes(this.searchText));
    }

    get dependencies() {
        return [];
    }
}

const filter = Retree.root(new CardFilter());

filter.label = "cards (touched)"; // ✅ re-renders — ❌ cache hit, no recompute
filter.searchText = "beta"; // ✅ re-renders and recomputes once`;

const IGNORE_CODE = `import { ReactiveNode, Retree, ignore } from "@retreejs/core";

class Draft extends ReactiveNode {
    public count = 0;

    // Reads and writes still work — listener emission is skipped.
    @ignore public scratch = { writes: 0 };

    get dependencies() {
        return [];
    }
}

const draft = Retree.root(new Draft());

draft.scratch.writes += 1; // ❌ no emission — nothing re-renders
draft.count += 1; // ✅ re-renders — and the panel catches up on scratch`;

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

const CLAIMS: {
    icon: React.ReactNode;
    title: React.ReactNode;
    detail: React.ReactNode;
}[] = [
    {
        icon: <PencilIcon />,
        title: "Minimal boilerplate",
        detail: (
            <>
                Components are plain functions; writes are plain assignments.
                Mutate data at wherever your data lives.
            </>
        ),
    },
    {
        icon: <SignalIcon />,
        title: "Subscriptions at any depth",
        detail: (
            <>
                <code>useNode</code> subscribes to any node in the tree — a row,
                a field, a whole panel — not a top-level store.
            </>
        ),
    },
    {
        icon: <BranchIcon />,
        title: "Tree operations built in",
        detail: (
            <>
                <code>parent</code>, <code>move</code>, <code>link</code>, and{" "}
                <code>clone</code> are one call each. No id tables, no lookup
                bookkeeping.
            </>
        ),
    },
    {
        icon: <AtSignIcon />,
        title: "APIs for precise performance",
        detail: (
            <>
                <code>@select</code>, <code>@memo</code>, and{" "}
                <code>@ignore</code> on your own <code>ReactiveNode</code>{" "}
                classes, mixed freely with plain objects.
            </>
        ),
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
            "Convex queries, actions, mutations, and connection state written into Retree nodes. Auto reconciled by _id, with narrow optimistic updates.",
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

function Eyebrow({
    icon,
    children,
}: {
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <p className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-faint">
            {icon !== undefined ? (
                <span aria-hidden className="text-accent">
                    {icon}
                </span>
            ) : null}
            {children}
        </p>
    );
}

export default function Home() {
    return (
        <main>
            {/* 1 — Hero */}
            <section className="relative overflow-hidden">
                <HeroBackground />
                <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 lg:pb-24 lg:pt-20">
                    <div className="grid items-center gap-10 lg:grid-cols-2">
                        <Reveal mode="mount">
                            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                                Simple state framework for precise,
                                lighting-fast reactive rendering.
                            </h1>
                            <p className="mt-4 max-w-xl text-lg text-muted">
                                React state done better.
                            </p>
                            <div className="mt-6 max-w-md">
                                <InstallTabs />
                            </div>
                            <div className="mt-6 flex flex-wrap items-center gap-3">
                                <Link
                                    href="/docs/quick-start"
                                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                >
                                    Get started
                                    <ArrowRightIcon size={14} />
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
                                <CodeBlock code={HERO_CODE} lang="tsx" />
                            </div>
                        </Reveal>
                        <Reveal mode="mount" delay={0.08}>
                            <HeroVisualizer />
                        </Reveal>
                    </div>
                </div>
            </section>

            {/* 2 — Concrete claims strip */}
            <section
                aria-label="What you get"
                className="border-y border-border-token bg-surface"
            >
                <div className="mx-auto grid max-w-7xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
                    {CLAIMS.map((claim, index) => (
                        <Reveal
                            key={index}
                            delay={index * 0.06}
                            className="h-full"
                        >
                            <article className="flex h-full flex-col rounded-lg border border-border-token bg-background p-4 [&_code]:font-mono [&_code]:text-[0.95em]">
                                <span
                                    aria-hidden
                                    className="mb-3 inline-flex size-8 items-center justify-center rounded-md border border-border-token bg-surface text-accent"
                                >
                                    {claim.icon}
                                </span>
                                <p className="font-mono text-sm text-foreground">
                                    {claim.title}
                                </p>
                                <p className="mt-1.5 text-sm text-muted [&_code]:text-foreground">
                                    {claim.detail}
                                </p>
                            </article>
                        </Reveal>
                    ))}
                </div>
            </section>

            {/* 3 — Feature walk */}
            <section className="border-b border-border-token">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                    <Reveal className="max-w-2xl">
                        <Eyebrow icon={<TreeIcon size={14} />}>
                            how it works
                        </Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Reactive state that just works
                        </h2>
                        <p className="mt-3 text-muted">
                            A few key concepts to help you get started.
                        </p>
                    </Reveal>

                    <div className="mt-12 space-y-16 lg:space-y-20">
                        {/* 01 — plain-assignment mutation, live demo */}
                        <FeatureItem
                            number="01"
                            icon={<PencilIcon size={18} />}
                            title="Mutate with plain assignments"
                            body={
                                <p>
                                    Create a store with <code>Retree.root</code>
                                    , observe nodes with <code>useNode</code>,
                                    and set values like ordinary TypeScript. A
                                    component re-renders only when a node it
                                    subscribed to changes — writes to a nested
                                    child emit on that child, not on every
                                    ancestor.
                                </p>
                            }
                            code={
                                <CodeBlock
                                    code={GRANULARITY_CODE}
                                    lang="tsx"
                                    title="granularity.tsx"
                                />
                            }
                            demo={<GranularityDemo />}
                            link={{
                                href: "/docs/react/use-node",
                                label: "useNode guide",
                            }}
                        />

                        {/* 02 — useSelect, static code */}
                        <FeatureItem
                            number="02"
                            icon={<TargetIcon size={18} />}
                            title="Query your state with useSelect"
                            body={
                                <p>
                                    <code>useSelect</code>
                                    {` `}re-renders a component only when the
                                    selected value changes. In the example
                                    below, the component only re-renders when{" "}
                                    <code>doneCount</code> changes.
                                </p>
                            }
                            code={
                                <CodeBlock
                                    code={USE_SELECT_CODE}
                                    lang="tsx"
                                    title="done-count.tsx"
                                />
                            }
                            link={{
                                href: "/docs/react/use-select",
                                label: "useSelect guide",
                            }}
                        />

                        {/* 03 — tree semantics, live demo */}
                        <FeatureItem
                            number="03"
                            icon={<BranchIcon size={18} />}
                            title="Tree semantics are built in"
                            body={
                                <p>
                                    Every node has one structural parent for
                                    bi-directional tree traversal.{" "}
                                    <code>Retree.move</code> transfers
                                    ownership, <code>Retree.link</code> points
                                    without reparenting,{" "}
                                    <code>Retree.clone</code> copies, and{" "}
                                    <code>Retree.parent</code> returns a node
                                    {"'"}s parent.
                                </p>
                            }
                            code={
                                <CodeBlock
                                    code={TREE_OPS_CODE}
                                    lang="ts"
                                    title="tree-ops.ts"
                                />
                            }
                            demo={<TreeOpsDemo />}
                            link={{
                                href: "/docs/tree-operations",
                                label: "Tree operations guide",
                            }}
                        />
                    </div>

                    {/* when you need more */}
                    <Reveal className="mt-16">
                        <div className="rounded-xl border border-border-token bg-surface p-6">
                            <h3 className="flex items-center gap-2 font-mono text-sm uppercase tracking-widest text-faint">
                                <span aria-hidden className="text-accent">
                                    <BookIcon size={15} />
                                </span>
                                when you need more
                            </h3>
                            <div className="mt-4 grid gap-6 sm:grid-cols-3">
                                <MoreLink
                                    href="/docs/events-and-subscriptions"
                                    icon={<SignalIcon size={15} />}
                                    title="Events outside React"
                                    detail="Retree.on subscribes to nodeChanged, treeChanged, or nodeRemoved from any code — integrations don't need hooks."
                                />
                                <MoreLink
                                    href="/docs/transactions"
                                    icon={<LayersIcon size={15} />}
                                    title="Transactions & silent writes"
                                    detail="Retree.runTransaction batches writes into one flush; Retree.runSilent skips emission entirely."
                                />
                                <MoreLink
                                    href="/docs/performance"
                                    icon={<BoltIcon size={15} />}
                                    title="Raw escape hatches"
                                    detail="Retree.raw, useRaw, peekInto, and untracked for native-speed, proxy-free reads."
                                />
                            </div>
                        </div>
                    </Reveal>
                </div>
            </section>

            {/* 4 — Comparative re-render visualizer */}
            <section className="border-b border-border-token">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                    <Reveal className="max-w-2xl">
                        <Eyebrow icon={<ColumnsIcon size={14} />}>
                            the difference
                        </Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Less manual optimization, better results.
                        </h2>
                        <p className="mt-3 text-muted">
                            Toggle tasks to visualize how Retree optimizes
                            renders. With a top-level store,{" "}
                            <code>React.memo</code>
                            {` `}can help keep siblings quiet but still carries
                            render overhead. With Retree, each component only
                            rerenders for the precise state it uses.
                        </p>
                    </Reveal>
                    <Reveal delay={0.08} className="mt-8">
                        <CompareVisualizer />
                    </Reveal>
                    <Reveal delay={0.1} className="mt-6">
                        <details className="group rounded-lg border border-border-token bg-surface px-4 py-3">
                            <summary className="cursor-pointer font-mono text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                                Compare the code for each example.
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
                </div>
            </section>

            {/* 5 — View models: ReactiveNode + decorators */}
            <section className="border-b border-border-token">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                    <Reveal className="max-w-2xl">
                        <Eyebrow icon={<AtSignIcon size={14} />}>
                            view models
                        </Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Enjoy the benefits of functional React while keeping
                            state where it belongs.
                        </h2>
                        <p className="mt-3 text-muted [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-foreground">
                            Stop keeping your state in a top-level store
                            referenced by many components. Instead, extend{" "}
                            <code>ReactiveNode</code> and they stay on the class
                            that owns the data: explicit dependencies decide
                            when the node emits, decorators keep renders
                            selective, and observe changes with{" "}
                            <code>useNode</code> and <code>useSelect</code>.
                        </p>
                    </Reveal>
                    <Reveal delay={0.08} className="mt-8">
                        <DecoratorShowcase
                            codeBlocks={{
                                dependencies: (
                                    <CodeBlock
                                        code={DEPENDENCIES_CODE}
                                        lang="tsx"
                                        title="even-counter.tsx"
                                    />
                                ),
                                "@select": (
                                    <CodeBlock
                                        code={SELECT_CODE}
                                        lang="ts"
                                        title="task-board.ts"
                                    />
                                ),
                                "@memo": (
                                    <CodeBlock
                                        code={MEMO_CODE}
                                        lang="ts"
                                        title="card-filter.ts"
                                    />
                                ),
                                "@ignore": (
                                    <CodeBlock
                                        code={IGNORE_CODE}
                                        lang="ts"
                                        title="draft.ts"
                                    />
                                ),
                            }}
                        />
                    </Reveal>
                    <Reveal delay={0.1} className="mt-6">
                        <p>
                            <Link
                                href="/docs/view-models"
                                className="font-mono text-sm text-accent underline-offset-4 hover:underline"
                            >
                                View models &amp; decorators — the full guide →
                            </Link>
                        </p>
                    </Reveal>
                </div>
            </section>

            {/* 6 — Convex callout */}
            <section
                aria-label="Convex integration"
                className="border-t border-border-token"
            >
                <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-12">
                    <Reveal>
                        <aside className="flex flex-col gap-4 rounded-xl border border-border-token bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
                            <div className="max-w-2xl">
                                <Eyebrow icon={<PlugIcon size={14} />}>
                                    convex
                                </Eyebrow>
                                <p className="mt-2 text-sm text-muted">
                                    Retree ships an official{" "}
                                    <a
                                        href="https://convex.dev"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent underline-offset-4 hover:underline"
                                    >
                                        Convex
                                    </a>{" "}
                                    integration: queries, mutations, and
                                    optimistic updates are written straight into
                                    Retree nodes, so your components keep
                                    reading the same tree they always did.
                                </p>
                            </div>
                            <Link
                                href="/docs/convex"
                                className="shrink-0 font-mono text-sm text-accent underline-offset-4 hover:underline"
                            >
                                Convex integration →
                            </Link>
                        </aside>
                    </Reveal>
                </div>
            </section>

            {/* 7 — Per-package cards */}
            <section className="border-t border-border-token bg-surface">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
                    <Reveal className="max-w-2xl">
                        <Eyebrow icon={<PackageIcon size={14} />}>
                            packages
                        </Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Four Retree packages walk into a bar...
                        </h2>
                        <p className="mt-3 text-muted">
                            <code>core</code> and <code>react</code> cover most
                            apps; the other two exist for Convex users.
                        </p>
                    </Reveal>
                    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {PACKAGES.map((pkg, index) => (
                            <Reveal key={pkg.slug} delay={index * 0.06}>
                                <article className="flex h-full flex-col rounded-xl border border-border-token bg-background p-5">
                                    <h3 className="flex items-center gap-2 font-mono text-sm font-semibold text-foreground">
                                        <span
                                            aria-hidden
                                            className="shrink-0 text-faint"
                                        >
                                            <PackageIcon size={15} />
                                        </span>
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

            {/* 8 — Performance philosophy strip */}
            <section className="border-t border-border-token">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
                    <Reveal className="max-w-3xl">
                        <Eyebrow icon={<GaugeIcon size={14} />}>
                            performance
                        </Eyebrow>
                        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                            Transparent performance benchmarks
                        </h2>
                        <p className="mt-3 text-muted">
                            Retree has a robust CLI we use to measure
                            performance and experiment against. If you are
                            curious to see how the benchmarks perform on your
                            own machine, check out our CLI.
                        </p>
                        <p className="mt-5">
                            <a
                                href="https://github.com/ryanbliss/retree/tree/main/benchmarks"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-md border border-border-token px-4 py-2 font-mono text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Review benchmarks →
                            </a>
                        </p>
                    </Reveal>
                </div>
            </section>

            {/* 9 — Final CTA */}
            <section className="border-t border-border-token bg-surface">
                <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
                    <Reveal className="mx-auto max-w-xl text-center">
                        <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                            Easy to get started
                        </h2>
                        <p className="mt-3 text-muted">
                            Too lazy to try it yourself? Install our agent
                            skills and ask your agent to handle the trees while
                            you go touch grass in the shade of a real one.
                        </p>
                        <div className="mx-auto mt-6 max-w-md text-left">
                            <InstallTabs />
                        </div>
                        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                            <Link
                                href="/docs/quick-start"
                                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                            >
                                Get started
                                <ArrowRightIcon size={14} />
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

/**
 * One feature: number/title/prose span the full width above, and the code
 * block and live demo share a single aligned row below (code left, demo
 * right — consistent order on every feature). `min-w-0` on both grid children
 * prevents code blocks from forcing horizontal overflow on mobile.
 */
function FeatureItem({
    number,
    icon,
    title,
    body,
    code,
    demo,
    link,
}: {
    number: string;
    icon: React.ReactNode;
    title: string;
    body: React.ReactNode;
    code: React.ReactNode;
    demo?: React.ReactNode;
    link: { href: string; label: string };
}) {
    return (
        <Reveal>
            <div className="max-w-2xl">
                <p className="font-mono text-sm text-accent">{number}</p>
                <h3 className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
                    <span aria-hidden className="shrink-0 text-accent">
                        {icon}
                    </span>
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
            {demo !== undefined ? (
                // items-stretch (the default): code and demo share the row's
                // height, and each demo's DemoLog absorbs the difference.
                <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:gap-8">
                    <div className="min-w-0 [&>figure]:my-0">{code}</div>
                    <div className="min-w-0">{demo}</div>
                </div>
            ) : (
                <div className="mt-6 max-w-3xl [&>figure]:my-0">{code}</div>
            )}
        </Reveal>
    );
}

function MoreLink({
    href,
    icon,
    title,
    detail,
}: {
    href: string;
    icon: React.ReactNode;
    title: string;
    detail: string;
}) {
    return (
        <Link href={href} className="group block">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground group-hover:text-accent">
                <span aria-hidden className="shrink-0 text-accent">
                    {icon}
                </span>
                {title}
            </p>
            <p className="mt-1 text-xs text-muted">{detail}</p>
        </Link>
    );
}
