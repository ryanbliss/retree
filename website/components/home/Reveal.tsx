"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export interface RevealProps {
    children: ReactNode;
    /** Seconds to wait before animating — use for stagger (e.g. index * 0.06). */
    delay?: number;
    /**
     * "in-view" fades up when scrolled into view (default). "mount" animates
     * immediately on mount — use for above-the-fold content.
     */
    mode?: "in-view" | "mount";
    className?: string;
}

/**
 * Staggered fade-up wrapper for marketing sections. Under
 * prefers-reduced-motion it renders a plain, fully visible div.
 */
export function Reveal({
    children,
    delay = 0,
    mode = "in-view",
    className,
}: RevealProps) {
    const reduceMotion = useReducedMotion();

    if (reduceMotion) {
        return <div className={className}>{children}</div>;
    }

    const target = { opacity: 1, y: 0 };
    const inView = mode === "in-view";

    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y: 14 }}
            animate={inView ? undefined : target}
            whileInView={inView ? target : undefined}
            viewport={inView ? { once: true, margin: "-60px" } : undefined}
            transition={{ duration: 0.28, ease: "easeOut", delay }}
        >
            {children}
        </motion.div>
    );
}
