"use client";

import { useEffect, useRef } from "react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";

/** How many "+1" spans each badge keeps in its pool. During a fast typing
 * burst a new number launches per keystroke; eight slots is enough that a
 * number always finishes its arc before its slot is reused. */
const POOL_SIZE = 8;
const LIFE_MS = 720;
const KEYFRAME_STEPS = 8;

function prefersReducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * RenderBadge that also launches a game-style "+1" every time the counter
 * increments — each number pops in, flies off on its own randomized arc
 * (varied direction and spin, gravity pulls it back down), and fades.
 *
 * The badge number stays the canonical, reduced-motion-safe evidence; the
 * flying numbers are pure enhancement and are skipped entirely under
 * prefers-reduced-motion.
 */
export function BurstRenderBadge({
    renders,
    tone = "accent",
}: {
    renders: number;
    /** accent = the render was useful (Retree); danger = wasted (store). */
    tone?: "accent" | "danger";
}) {
    const poolRef = useRef<HTMLSpanElement>(null);
    const slotRef = useRef(0);

    useEffect(() => {
        // The mount render is not a re-render — nothing to celebrate yet.
        if (renders <= 1) return;
        const pool = poolRef.current;
        if (pool === null) return;
        if (prefersReducedMotion()) return;
        const slot = pool.children[slotRef.current % pool.children.length];
        if (!(slot instanceof HTMLElement)) return;
        slotRef.current += 1;

        // Ballistic arc sampled into keyframes: random horizontal kick, an
        // upward launch, constant gravity — the video's damage-number feel.
        const vx = (Math.random() - 0.5) * 110;
        const vy = -(60 + Math.random() * 60);
        const rot = Math.random() * 26 - 13;
        const frames: Keyframe[] = [];
        for (let i = 0; i <= KEYFRAME_STEPS; i++) {
            const p = i / KEYFRAME_STEPS;
            const seconds = (p * LIFE_MS) / 1000;
            const x = vx * seconds;
            const y = vy * seconds + 170 * seconds * seconds;
            const pop = 1 + 0.45 * Math.max(0, 1 - p / 0.22);
            const opacity = p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5;
            frames.push({
                transform: `translate(${x.toFixed(1)}px, ${y.toFixed(
                    1
                )}px) rotate(${(rot * p).toFixed(1)}deg) scale(${pop.toFixed(
                    3
                )})`,
                opacity,
            });
        }
        // No cleanup on purpose: cancelling here would kill the previous
        // number's flight the moment the next render lands mid-burst.
        slot.animate(frames, {
            duration: LIFE_MS,
            easing: "linear",
            fill: "forwards",
        });
    }, [renders]);

    return (
        <span className="relative inline-flex">
            <RenderBadge renders={renders} />
            <span
                ref={poolRef}
                aria-hidden
                className="pointer-events-none absolute left-1 top-1/2 z-10"
            >
                {Array.from({ length: POOL_SIZE }, (_, index) => (
                    <span
                        key={index}
                        className={`absolute left-0 top-0 whitespace-nowrap font-mono text-[11px] font-bold opacity-0 ${
                            tone === "danger" ? "text-danger" : "text-accent"
                        }`}
                    >
                        +1
                    </span>
                ))}
            </span>
        </span>
    );
}
