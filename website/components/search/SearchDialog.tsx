"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface SearchResult {
    id: string;
    url: string;
    title: string;
    excerpt: string;
}

interface PagefindResultData {
    url: string;
    excerpt: string;
    meta?: { title?: string };
}

interface PagefindResult {
    id: string;
    data: () => Promise<PagefindResultData>;
}

interface PagefindApi {
    search: (query: string) => Promise<{ results: PagefindResult[] }>;
}

declare global {
    interface Window {
        __retreePagefind?: PagefindApi | null;
    }
}

async function loadPagefind(): Promise<PagefindApi | null> {
    if (window.__retreePagefind !== undefined) {
        return window.__retreePagefind;
    }
    try {
        // Runtime asset emitted by the pagefind postbuild step; the variable
        // specifier plus ignore comments keep bundlers from resolving it.
        const specifier = "/_pagefind/pagefind.js";
        const pagefindModule = (await import(
            /* webpackIgnore: true */ /* turbopackIgnore: true */ specifier
        )) as PagefindApi;
        window.__retreePagefind = pagefindModule;
        return pagefindModule;
    } catch {
        // Index not present (e.g. `next dev` before a production build).
        window.__retreePagefind = null;
        return null;
    }
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        inputRef.current?.focus();
        // Modal semantics: lock body scroll, close on Escape anywhere, and
        // keep Tab focus inside the panel while open.
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onDocumentKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== "Tab") return;
            const panel = panelRef.current;
            if (panel === null) return;
            const focusable = panel.querySelectorAll<HTMLElement>(
                "input, button, [tabindex]:not([tabindex='-1'])"
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (
                event.shiftKey &&
                (active === first || active === document.body)
            ) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            } else if (active !== null && !panel.contains(active)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onDocumentKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener("keydown", onDocumentKeyDown);
        };
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;
        if (query.trim() === "") {
            return;
        }
        (async () => {
            const pagefind = await loadPagefind();
            if (cancelled) return;
            if (pagefind === null) {
                setUnavailable(true);
                return;
            }
            const response = await pagefind.search(query);
            const top = await Promise.all(
                response.results.slice(0, 8).map(async (result) => {
                    const data = await result.data();
                    return {
                        id: result.id,
                        url: data.url.replace(/\.html$/, ""),
                        title: data.meta?.title ?? data.url,
                        excerpt: data.excerpt,
                    };
                })
            );
            if (!cancelled) {
                setResults(top);
                setActiveIndex(0);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [query]);

    const go = (url: string) => {
        onClose();
        router.push(url);
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
            event.preventDefault();
            onClose();
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, results.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter" && results[activeIndex]) {
            event.preventDefault();
            go(results[activeIndex].url);
        }
    };

    // Portal to <body>: the trigger lives inside the sticky header, whose
    // backdrop-blur creates a containing block that would clip this
    // fixed-position overlay to the header's box.
    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
            onClick={onClose}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Search documentation"
                className="w-full max-w-xl overflow-hidden rounded-xl border border-border-strong bg-surface-raised shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={onKeyDown}
            >
                <input
                    ref={inputRef}
                    role="combobox"
                    aria-expanded={results.length > 0}
                    aria-controls="search-results"
                    aria-activedescendant={
                        results[activeIndex]
                            ? `search-result-${activeIndex}`
                            : undefined
                    }
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        if (event.target.value.trim() === "") {
                            setResults([]);
                        }
                    }}
                    placeholder="Search docs and API…"
                    className="w-full border-b border-border-token bg-transparent px-4 py-3.5 text-[15px] text-foreground outline-none placeholder:text-faint"
                />
                <ul
                    id="search-results"
                    role="listbox"
                    aria-label="Search results"
                    className="max-h-[50vh] overflow-y-auto p-2"
                >
                    {unavailable ? (
                        <li className="px-3 py-6 text-center text-sm text-muted">
                            Search index unavailable in dev — run a production
                            build to generate it.
                        </li>
                    ) : results.length === 0 && query.trim() !== "" ? (
                        <li className="px-3 py-6 text-center text-sm text-muted">
                            No results for “{query}”
                        </li>
                    ) : (
                        results.map((result, index) => (
                            <li
                                key={result.id}
                                id={`search-result-${index}`}
                                role="option"
                                aria-selected={index === activeIndex}
                            >
                                <button
                                    type="button"
                                    onClick={() => go(result.url)}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    className={`w-full rounded-lg px-3 py-2.5 text-left ${
                                        index === activeIndex
                                            ? "bg-surface text-foreground"
                                            : "text-muted"
                                    }`}
                                >
                                    <span className="block text-sm font-medium">
                                        {result.title}
                                    </span>
                                    <span
                                        className="mt-0.5 block truncate text-xs text-faint [&_mark]:bg-transparent [&_mark]:font-semibold [&_mark]:text-accent"
                                        dangerouslySetInnerHTML={{
                                            __html: result.excerpt,
                                        }}
                                    />
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            </div>
        </div>,
        document.body
    );
}
