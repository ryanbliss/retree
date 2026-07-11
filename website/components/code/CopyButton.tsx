"use client";

import { useState } from "react";

/**
 * Copies `text` to the clipboard, stripping leading `$ ` shell prompts.
 * By default the button is revealed on group hover/focus; pass
 * `alwaysVisible` for standalone contexts (e.g. the hero install command)
 * where there is no hover affordance.
 */
export function CopyButton({
    text,
    alwaysVisible = false,
}: {
    text: string;
    alwaysVisible?: boolean;
}) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        const cleaned = text
            .split("\n")
            .map((line) => line.replace(/^\$ /, ""))
            .join("\n")
            .trimEnd();
        await navigator.clipboard.writeText(cleaned);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    return (
        <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy code"}
            className={`absolute right-2 top-2 rounded-md border border-border-token bg-surface-raised/90 p-1.5 text-muted transition-opacity hover:text-foreground ${
                alwaysVisible
                    ? "opacity-100"
                    : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            }`}
        >
            {copied ? (
                <svg
                    aria-hidden
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent-text)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="m4.5 12.5 5 5 10-11" />
                </svg>
            ) : (
                <svg
                    aria-hidden
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
            )}
        </button>
    );
}
