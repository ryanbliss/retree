"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface SidebarSection {
    title: string;
    items: { href: string; title: string }[];
}

/**
 * Shared sidebar for /docs and /api. Desktop: sticky column. Mobile: a
 * disclosure below the top nav.
 */
export function DocsSidebar({ sections }: { sections: SidebarSection[] }) {
    const pathname = usePathname();
    const [mobileOpen, setMobileOpen] = useState(false);

    const nav = (
        <nav aria-label="Documentation" className="space-y-6">
            {sections.map((section) => (
                <div key={section.title}>
                    <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-faint">
                        {section.title}
                    </p>
                    <ul className="space-y-0.5 border-l border-border-token">
                        {section.items.map((item) => {
                            const active = pathname === item.href;
                            return (
                                <li key={item.href}>
                                    <Link
                                        href={item.href}
                                        aria-current={
                                            active ? "page" : undefined
                                        }
                                        onClick={() => setMobileOpen(false)}
                                        className={`-ml-px block border-l py-1 pl-5 text-[13.5px] transition-colors ${
                                            active
                                                ? "border-accent-glow font-medium text-accent"
                                                : "border-transparent text-muted hover:border-border-strong hover:text-foreground"
                                        }`}
                                    >
                                        {item.title}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );

    return (
        <>
            <div className="mb-4 lg:hidden">
                <button
                    type="button"
                    aria-expanded={mobileOpen}
                    onClick={() => setMobileOpen((value) => !value)}
                    className="flex w-full items-center justify-between rounded-lg border border-border-token bg-surface px-3 py-2 text-sm text-muted"
                >
                    Menu
                    <span aria-hidden className="text-faint">
                        {mobileOpen ? "−" : "+"}
                    </span>
                </button>
                {mobileOpen ? (
                    <div className="mt-3 rounded-lg border border-border-token bg-surface p-4">
                        {nav}
                    </div>
                ) : null}
            </div>
            <div className="hidden lg:block">{nav}</div>
        </>
    );
}
