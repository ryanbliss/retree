"use client";

import { useCallback, useEffect, useState } from "react";
import { SearchDialog } from "./SearchDialog";

export function SearchButton() {
    const [open, setOpen] = useState(false);

    const onKeyDown = useCallback((event: KeyboardEvent) => {
        if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "k"
        ) {
            event.preventDefault();
            setOpen((value) => !value);
        }
    }, []);

    useEffect(() => {
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onKeyDown]);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Search"
                className="flex h-8 items-center gap-2 rounded-md border border-border-token px-2.5 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
                <svg
                    aria-hidden
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                </svg>
                <span className="hidden sm:inline">Search</span>
                <kbd className="hidden rounded border border-border-token px-1 font-mono text-[10px] text-faint sm:inline">
                    ⌘K
                </kbd>
            </button>
            {open ? <SearchDialog onClose={() => setOpen(false)} /> : null}
        </>
    );
}
