"use client";

/**
 * Shared scripted-autoplay plumbing for the live demos, mirroring the
 * HeroVisualizer convention: a small Retree session root tracks the mode
 * ("auto" → scripted mutations tick, "paused" → hover/focus holds them,
 * "user" → the first real interaction stops them for good), a status chip
 * dogfoods useNode to display it, and the hook cleans every timer up and
 * resets the session on unmount so back-navigation starts fresh.
 *
 * Counters are not motion: the intervals run under prefers-reduced-motion
 * too — the render-count evidence still accumulates, while the glow pulse
 * stays disabled via useRenderGlow's own reduced-motion check.
 */

import { useEffect, type FocusEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

export type AutoplayMode = "auto" | "paused" | "user" | "done";

export interface AutoplaySession {
    mode: AutoplayMode;
    /** The last scripted or user mutation, printed as a code-ish line. */
    lastLine: string;
}

/** One session root per demo, created at module scope beside its state. */
export function createAutoplaySession(): AutoplaySession {
    return Retree.root<AutoplaySession>({ mode: "auto", lastLine: "" });
}

/** First real user interaction stops the scripted loop for good. */
export function takeOver(session: AutoplaySession, line: string): void {
    session.mode = "user";
    session.lastLine = line;
}

export interface ScriptedAutoplayOptions {
    /** Module-scope session root — must be referentially stable. */
    session: AutoplaySession;
    /** Milliseconds between scripted steps once the loop is running. */
    intervalMs: number;
    /** Milliseconds before the first scripted step fires. */
    initialDelayMs: number;
    /**
     * Runs one scripted mutation. Must be a module-scope (stable) function.
     * Return `false` to signal "this tick did nothing" (e.g. yielding to an
     * in-flight typing burst) — such ticks don't consume the maxSteps budget.
     */
    step: () => void | boolean;
    /**
     * Stop for good after this many scripted steps (mode becomes "done").
     * Keeps the counters small enough to stay meaningful — an uncapped loop
     * inflates every number until the comparison reads as noise.
     */
    maxSteps: number;
    /**
     * Extra cleanup when the demo unmounts (reset module counters/stores so
     * back-navigation starts fresh). Must be module-scope (stable).
     */
    onUnmount?: () => void;
}

export interface AutoplayPauseHandlers {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * Drives a scripted mutation loop for one demo. Spread the returned
 * handlers onto the demo's container so hovering or focusing anything
 * inside pauses the loop; call `takeOver(session, line)` from real user
 * interactions to stop it permanently.
 */
export function useScriptedAutoplay(
    options: ScriptedAutoplayOptions
): AutoplayPauseHandlers {
    const { session, intervalMs, initialDelayMs, step, maxSteps, onUnmount } =
        options;

    useEffect(() => {
        let interval: number | undefined;
        let stepsRun = 0;

        const stop = (): void => {
            if (interval !== undefined) {
                window.clearInterval(interval);
                interval = undefined;
            }
        };

        const tick = (): void => {
            if (session.mode === "user" || session.mode === "done") {
                stop();
                return;
            }
            if (session.mode === "paused") return;
            if (step() === false) return;
            stepsRun += 1;
            if (stepsRun >= maxSteps) {
                stop();
                session.mode = "done";
            }
        };

        const initial = window.setTimeout(() => {
            tick();
            if (session.mode !== "user" && session.mode !== "done") {
                interval = window.setInterval(tick, intervalMs);
            }
        }, initialDelayMs);

        return () => {
            window.clearTimeout(initial);
            if (interval !== undefined) window.clearInterval(interval);
            // The session root is module state; reset it so autoplay starts
            // fresh if the user navigates away and back to this page.
            session.mode = "auto";
            session.lastLine = "";
            if (onUnmount !== undefined) onUnmount();
        };
    }, [session, intervalMs, initialDelayMs, step, maxSteps, onUnmount]);

    const pause = (): void => {
        if (session.mode === "auto") session.mode = "paused";
    };
    const resume = (): void => {
        if (session.mode === "paused") session.mode = "auto";
    };
    const onBlurCapture = (event: FocusEvent<HTMLElement>): void => {
        const next =
            event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (next === null || !event.currentTarget.contains(next)) {
            resume();
        }
    };

    return {
        onPointerEnter: pause,
        onPointerLeave: resume,
        onFocusCapture: pause,
        onBlurCapture,
    };
}

const MODE_LABELS: Record<AutoplayMode, string> = {
    auto: "auto-playing",
    paused: "paused",
    user: "live — yours",
    done: "auto-paused — try it",
};

/** The hero-style mode chip: AUTO-PLAYING / PAUSED / LIVE — YOURS. */
export function AutoplayStatusChip({ session }: { session: AutoplaySession }) {
    const state = useNode(session);
    return (
        <span className="shrink-0 rounded border border-border-token px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-faint">
            {MODE_LABELS[state.mode]}
        </span>
    );
}

/**
 * The hero-style status line: the last mutation that ran (scripted or
 * user-made) plus the mode chip.
 */
export function AutoplayStatusLine({
    session,
    idleLine,
}: {
    session: AutoplaySession;
    idleLine: string;
}) {
    const state = useNode(session);
    const reduceMotion = useReducedMotion();
    const line = state.lastLine === "" ? idleLine : state.lastLine;
    return (
        <p className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-faint">
            <span aria-hidden className="shrink-0 text-accent">
                »
            </span>
            <motion.span
                key={line}
                initial={reduceMotion ? false : { opacity: 0.35 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="truncate text-muted"
            >
                {line}
            </motion.span>
            <span className="ml-auto shrink-0 rounded border border-border-token px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                {MODE_LABELS[state.mode]}
            </span>
        </p>
    );
}

/* ------------------------- typing simulation ------------------------- */

export interface TypingBurst {
    /**
     * Type from the current value toward `target`, one keystroke every
     * `charMs` (backspacing to the common prefix first, then typing
     * forward). Cancels any in-flight burst.
     */
    start(target: string): void;
    cancel(): void;
    /** True while a keystroke timer is pending (a retype is mid-flight). */
    isActive(): boolean;
}

/**
 * Simulates a user retyping a text field one keystroke at a time — every
 * intermediate value goes through `write`, so each keystroke is a real
 * mirrored mutation. The burst stops as soon as `shouldContinue` returns
 * false (pause/take-over) and can always be `cancel()`ed on unmount.
 */
export function createTypingBurst(options: {
    read: () => string;
    write: (value: string) => void;
    shouldContinue: () => boolean;
    charMs: number;
}): TypingBurst {
    const { read, write, shouldContinue, charMs } = options;
    let timeout: number | undefined;

    const cancel = (): void => {
        if (timeout !== undefined) {
            window.clearTimeout(timeout);
            timeout = undefined;
        }
    };

    const stepToward = (target: string): void => {
        timeout = undefined;
        if (!shouldContinue()) return;
        const current = read();
        if (current === target) return;
        const next = target.startsWith(current)
            ? target.slice(0, current.length + 1)
            : current.slice(0, -1);
        write(next);
        timeout = window.setTimeout(() => stepToward(target), charMs);
    };

    return {
        start(target) {
            cancel();
            stepToward(target);
        },
        cancel,
        isActive() {
            return timeout !== undefined;
        },
    };
}
