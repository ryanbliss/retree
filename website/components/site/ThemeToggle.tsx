"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const THEME_EVENT = "retree-theme-change";

function subscribe(callback: () => void): () => void {
    window.addEventListener(THEME_EVENT, callback);
    return () => window.removeEventListener(THEME_EVENT, callback);
}

function getSnapshot(): Theme {
    return document.documentElement.dataset.theme === "light"
        ? "light"
        : "dark";
}

export function ThemeToggle() {
    // Server snapshot is "dark" (the site default); the client snapshot is
    // re-read right after hydration, so no effect/setState dance is needed.
    const theme = useSyncExternalStore(subscribe, getSnapshot, () => "dark");

    const toggle = () => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        if (next === "light") {
            document.documentElement.dataset.theme = "light";
        } else {
            delete document.documentElement.dataset.theme;
        }
        try {
            localStorage.setItem("retree-theme", next);
        } catch {
            // localStorage unavailable (private browsing); theme still applies.
        }
        window.dispatchEvent(new Event(THEME_EVENT));
    };

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${
                theme === "dark" ? "light" : "dark"
            } theme`}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border-token text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
            {theme === "light" ? (
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
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
            ) : (
                <svg
                    aria-hidden
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
            )}
        </button>
    );
}
