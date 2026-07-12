"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { SearchButton } from "@/components/search/SearchButton";

const LINKS = [
    { href: "/docs/quick-start", label: "Docs", activePrefix: "/docs" },
    { href: "/api", label: "API", activePrefix: "/api" },
    { href: "/why", label: "Why Retree", activePrefix: "/why" },
];

export function SiteNav() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    return (
        <header className="sticky top-0 z-40 border-b border-border-token bg-background/85 backdrop-blur">
            <nav
                aria-label="Main"
                className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6"
            >
                <Link
                    href="/"
                    className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight text-foreground"
                >
                    <TreeMark />
                    retree
                </Link>
                <div className="hidden items-center gap-1 md:flex">
                    {LINKS.map((link) => {
                        const active = pathname.startsWith(link.activePrefix);
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                aria-current={active ? "page" : undefined}
                                className={`rounded-md px-3 py-1.5 font-mono text-[13px] transition-colors ${
                                    active
                                        ? "text-accent"
                                        : "text-muted hover:text-foreground"
                                }`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <SearchButton />
                    <a
                        href="https://github.com/ryanbliss/retree"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Retree on GitHub"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border-token text-muted transition-colors hover:border-border-strong hover:text-foreground"
                    >
                        <GitHubIcon />
                    </a>
                    <ThemeToggle />
                    <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border-token text-muted md:hidden"
                        aria-expanded={open}
                        aria-label={open ? "Close menu" : "Open menu"}
                        onClick={() => setOpen((value) => !value)}
                    >
                        <svg
                            aria-hidden
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        >
                            {open ? (
                                <path d="M6 6l12 12M18 6L6 18" />
                            ) : (
                                <path d="M4 7h16M4 12h16M4 17h16" />
                            )}
                        </svg>
                    </button>
                </div>
            </nav>
            {open ? (
                <div className="border-t border-border-token px-4 py-3 md:hidden">
                    {LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setOpen(false)}
                            className="block rounded-md px-2 py-2 font-mono text-sm text-muted hover:text-foreground"
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>
            ) : null}
        </header>
    );
}

function TreeMark() {
    return (
        <svg
            aria-hidden
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-text)"
            strokeWidth="2"
            strokeLinecap="round"
        >
            <circle cx="12" cy="5" r="2.2" />
            <circle cx="6" cy="19" r="2.2" />
            <circle cx="18" cy="19" r="2.2" />
            <path d="M12 7.5v4m0 0-4.8 5.6M12 11.5l4.8 5.6" />
        </svg>
    );
}

function GitHubIcon() {
    return (
        <svg
            aria-hidden
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.91c.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.05 11.05 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.2.67.8.55A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
        </svg>
    );
}
