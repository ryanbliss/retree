import Link from "next/link";

const COLUMNS: {
    title: string;
    links: {
        href: string;
        label: string;
        external?: boolean;
        /** Static public/ file, not an app route — use a plain anchor so the
         * router never tries to prefetch or client-navigate to it. */
        plainFile?: boolean;
    }[];
}[] = [
    {
        title: "Docs",
        links: [
            { href: "/docs/quick-start", label: "Quickstart" },
            { href: "/docs/thinking-in-retree", label: "Thinking in Retree" },
            { href: "/docs/react", label: "React hooks" },
            { href: "/docs/common-pitfalls", label: "Common pitfalls" },
        ],
    },
    {
        title: "Reference",
        links: [
            { href: "/api/core", label: "@retreejs/core" },
            { href: "/api/react", label: "@retreejs/react" },
            { href: "/api/convex", label: "@retreejs/convex" },
            { href: "/api/react-convex", label: "@retreejs/react-convex" },
        ],
    },
    {
        title: "Project",
        links: [
            { href: "/why", label: "Why Retree" },
            {
                href: "https://github.com/ryanbliss/retree",
                label: "GitHub",
                external: true,
            },
            {
                href: "https://www.npmjs.com/package/@retreejs/core",
                label: "npm",
                external: true,
            },
            { href: "/llms.txt", label: "llms.txt", plainFile: true },
        ],
    },
];

export function SiteFooter() {
    return (
        <footer className="border-t border-border-token">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 md:grid-cols-4">
                <div>
                    <p className="font-mono text-sm font-semibold text-foreground">
                        retree
                    </p>
                    <p className="mt-2 max-w-56 text-sm text-muted">
                        Reactive object trees for React. MIT licensed.
                    </p>
                    <p className="mt-4 text-xs text-faint">
                        © {new Date().getFullYear()} Ryan Bliss
                    </p>
                </div>
                {COLUMNS.map((column) => (
                    <nav key={column.title} aria-label={column.title}>
                        <p className="font-mono text-xs uppercase tracking-widest text-faint">
                            {column.title}
                        </p>
                        <ul className="mt-3 space-y-2">
                            {column.links.map((link) =>
                                link.external || link.plainFile ? (
                                    <li key={link.href}>
                                        <a
                                            href={link.href}
                                            target={
                                                link.external
                                                    ? "_blank"
                                                    : undefined
                                            }
                                            rel={
                                                link.external
                                                    ? "noreferrer"
                                                    : undefined
                                            }
                                            className="text-sm text-muted transition-colors hover:text-foreground"
                                        >
                                            {link.label}
                                        </a>
                                    </li>
                                ) : (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            className="text-sm text-muted transition-colors hover:text-foreground"
                                        >
                                            {link.label}
                                        </Link>
                                    </li>
                                )
                            )}
                        </ul>
                    </nav>
                ))}
            </div>
        </footer>
    );
}
