import type { ReactNode } from "react";

export interface RevealProps {
    children: ReactNode;
    /** Seconds to wait before animating — use for stagger (e.g. index * 0.06). */
    delay?: number;
    /**
     * Kept for call-site compatibility. Both modes now animate on load via
     * pure CSS (see .reveal-fade in globals.css).
     */
    mode?: "in-view" | "mount";
    className?: string;
}

/**
 * Staggered fade-up wrapper for marketing sections, implemented as a pure
 * CSS animation (see `.reveal-fade` in globals.css).
 *
 * Deliberately NOT a motion/JS animation: the entrance state must never
 * depend on JavaScript executing. A dropped or truncated script (dev chunk
 * races, flaky networks, aggressive extensions) previously left the whole
 * page at the SSR'd `opacity: 0` — CSS animations run on static HTML, so
 * content is always visible even if hydration never happens.
 * prefers-reduced-motion is handled in the stylesheet.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
    return (
        <div
            className={`reveal-fade ${className ?? ""}`}
            style={delay > 0 ? { animationDelay: `${delay}s` } : undefined}
        >
            {children}
        </div>
    );
}
