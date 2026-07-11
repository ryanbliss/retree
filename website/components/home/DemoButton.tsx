"use client";

import type { ReactNode } from "react";

/**
 * Small monospace action button used inside the live demos. The label is the
 * mutation it performs, so the button doubles as documentation.
 */
export function DemoButton({
    onClick,
    children,
    ariaLabel,
}: {
    onClick: () => void;
    children: ReactNode;
    ariaLabel?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className="rounded-md border border-border-token bg-surface-raised px-2.5 py-1.5 text-left font-mono text-[11px] text-muted transition-[color,border-color,transform] duration-150 hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98]"
        >
            {children}
        </button>
    );
}
