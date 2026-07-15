import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Compare Retree — vs MobX, Valtio, and migration guides",
    description:
        "Side-by-side comparisons of Retree with MobX and Valtio, verified July 2026, plus migration guides from MobX, Zustand, and Redux Toolkit.",
};

interface CompareLink {
    href: string;
    title: string;
    description: string;
}

const comparisons: CompareLink[] = [
    {
        href: "/compare/mobx",
        title: "Retree vs MobX",
        description:
            "The mutable model without observer() wrappers or actions. Verified against MobX 6.16.",
    },
    {
        href: "/compare/valtio",
        title: "Retree vs Valtio",
        description:
            "One mutable tree instead of the state/snap split. Verified against Valtio 2.3.",
    },
];

const migrations: CompareLink[] = [
    {
        href: "/docs/migrate/mobx",
        title: "Migrate from MobX",
        description:
            "observable, observer(), computed, and reactions mapped to their Retree equivalents.",
    },
    {
        href: "/docs/migrate/zustand",
        title: "Migrate from Zustand",
        description:
            "create/set/get, selectors, and slices mapped to one tree and per-node hooks.",
    },
    {
        href: "/docs/migrate/redux",
        title: "Migrate from Redux Toolkit",
        description:
            "Your createSlice reducer bodies already run in Retree — the rest of the machinery retires.",
    },
];

function CompareCard({ link }: { link: CompareLink }) {
    return (
        <Link
            href={link.href}
            className="group flex flex-col gap-2 rounded-lg border border-border-token bg-surface p-5 transition-colors hover:border-border-strong"
        >
            <h3 className="text-base font-semibold text-foreground group-hover:text-accent">
                {link.title}
            </h3>
            <p className="text-sm leading-6 text-muted">{link.description}</p>
        </Link>
    );
}

export default function ComparePage() {
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
                How Retree stacks up
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
                Every scored claim on these pages was verified against the named
                library versions in July 2026, and the rows Retree loses are
                included on purpose. For the live re-render demo behind the
                pitch, start with{" "}
                <Link
                    href="/why"
                    className="text-accent underline underline-offset-2 hover:no-underline"
                >
                    Why Retree
                </Link>
                .
            </p>

            <section aria-labelledby="comparisons-heading" className="mt-10">
                <h2
                    id="comparisons-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    Side by side
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {comparisons.map((link) => (
                        <CompareCard key={link.href} link={link} />
                    ))}
                </div>
            </section>

            <section aria-labelledby="migrations-heading" className="mt-10">
                <h2
                    id="migrations-heading"
                    className="text-2xl font-semibold tracking-tight text-foreground"
                >
                    Already committed elsewhere?
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-muted">
                    Each guide is a concept map with a before/after slice and
                    the gotchas — a routing table, not a tutorial.
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {migrations.map((link) => (
                        <CompareCard key={link.href} link={link} />
                    ))}
                </div>
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
            </section>
        </main>
    );
}
