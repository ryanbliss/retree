"use client";

import { useState } from "react";

/** Fetches the page's raw markdown export and copies it to the clipboard. */
export function CopyMarkdownButton({ markdownUrl }: { markdownUrl: string }) {
    const [state, setState] = useState<"idle" | "copied" | "error">("idle");

    const copy = async () => {
        try {
            const response = await fetch(markdownUrl);
            if (!response.ok) {
                throw new Error(
                    `CopyMarkdownButton: markdown export request failed with status ${response.status} for ${markdownUrl}`
                );
            }
            await navigator.clipboard.writeText(await response.text());
            setState("copied");
        } catch {
            setState("error");
        }
        setTimeout(() => setState("idle"), 1800);
    };

    return (
        <button
            type="button"
            onClick={copy}
            className="rounded-md border border-border-token px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
            {state === "copied"
                ? "Copied!"
                : state === "error"
                  ? "Copy failed"
                  : "Copy page as Markdown"}
        </button>
    );
}
