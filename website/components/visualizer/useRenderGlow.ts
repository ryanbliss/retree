"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface RenderGlow<T extends HTMLElement> {
    ref: RefObject<T | null>;
    /** Number of times the calling component has rendered (1-based). */
    renders: number;
}

function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Tracks how many times the calling component renders and pulses a
 * react-scan-style glow on the attached element after each commit.
 *
 * Per spec §5.1, the always-on render counter is the canonical evidence —
 * render it via <RenderBadge renders={renders} />. The glow is progressive
 * enhancement and is skipped entirely under prefers-reduced-motion.
 */
export function useRenderGlow<T extends HTMLElement>(): RenderGlow<T> {
    const ref = useRef<T>(null);
    const countRef = useRef(0);
    // Counting renders requires mutating/reading a ref during render — the
    // standard render-counter technique. It is exempt from the react-hooks
    // refs rule on purpose: these demo components must visibly re-render.
    // React Compiler skips optimizing components that use this hook, which
    // is exactly what the visualizers need.
    // eslint-disable-next-line react-hooks/refs
    countRef.current += 1;
    // eslint-disable-next-line react-hooks/refs
    const renders = countRef.current;

    useEffect(() => {
        const element = ref.current;
        if (element === null) return;
        if (prefersReducedMotion()) return;
        const animation = element.animate(
            [
                {
                    boxShadow:
                        "0 0 0 1.5px var(--accent-glow), 0 0 16px 2px var(--accent-glow-soft)",
                },
                {
                    boxShadow:
                        "0 0 0 1.5px rgba(0,0,0,0), 0 0 16px 2px rgba(0,0,0,0)",
                },
            ],
            { duration: 650, easing: "ease-out" }
        );
        return () => animation.cancel();
    });

    return { ref, renders };
}
