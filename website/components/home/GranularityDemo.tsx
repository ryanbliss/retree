"use client";

import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import type { ReactNode } from "react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";
import {
    DemoLog,
    clearDemoLog,
    createDemoLog,
    pushDemoLog,
} from "@/components/visualizer/DemoLog";
import {
    AutoplayStatusChip,
    createAutoplaySession,
    takeOver,
    useScriptedAutoplay,
} from "@/components/visualizer/scriptedAutoplay";

/** Real Retree tree backing feature demo 1 (plain-assignment mutation). */
const dashboard = Retree.root({
    header: { title: "Team dashboard" },
    stats: { views: 0 },
});

const demoLog = createDemoLog();

const HEADER_TITLES = ["Team dashboard", "Ops dashboard"] as const;

function rotateTitle(): void {
    dashboard.header.title =
        dashboard.header.title === HEADER_TITLES[0]
            ? HEADER_TITLES[1]
            : HEADER_TITLES[0];
    pushDemoLog(
        demoLog,
        `header.title = ${JSON.stringify(dashboard.header.title)}`,
        true,
        "<HeaderCard /> only"
    );
}

function bumpViews(): void {
    dashboard.stats.views += 1;
    pushDemoLog(
        demoLog,
        `stats.views = ${dashboard.stats.views}`,
        true,
        "<StatsCard /> only"
    );
}

/* ---------------------------- ambient tick ----------------------------
 * Hero convention: a slow scripted write keeps the counters gently
 * accumulating (mostly stats.views, occasionally the title, so both
 * cards get to demonstrate their independence). Hover/focus pauses it;
 * the first real click stops it for good.
 */

const autoplaySession = createAutoplaySession();

let autoplayStep = 0;

function runAutoplayStep(): void {
    const phase = autoplayStep % 3;
    autoplayStep += 1;
    if (phase === 2) {
        rotateTitle();
        return;
    }
    bumpViews();
}

/** Unmount cleanup: back-navigation must start from a clean slate. */
function handleGranularityUnmount(): void {
    autoplayStep = 0;
    dashboard.stats.views = 0;
    dashboard.header.title = HEADER_TITLES[0];
    clearDemoLog(demoLog);
}

/**
 * Feature-walk demo 1: two sibling cards subscribe to two sibling nodes.
 * Each button performs the plain assignment printed on it; only the card
 * that reads the mutated node re-renders.
 *
 * The shell deliberately carries no render badge: it has no subscription,
 * so its count would sit at 1 forever — a number that helps nobody compare
 * anything. The two cards' badges are the evidence.
 */
export function GranularityDemo() {
    const pauseHandlers = useScriptedAutoplay({
        session: autoplaySession,
        intervalMs: 5500,
        initialDelayMs: 1500,
        step: runAutoplayStep,
        maxSteps: 12,
        onUnmount: handleGranularityUnmount,
    });
    return (
        <div
            {...pauseHandlers}
            className="flex h-full flex-col rounded-xl border border-border-token bg-surface p-3 sm:p-4"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-faint">
                    {"<Demo />"} — no subscription
                </span>
                <AutoplayStatusChip session={autoplaySession} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <HeaderCard />
                <StatsCard />
            </div>
            <p className="mt-3 text-xs text-muted">
                Writes fire on their own every few seconds — click one (▶) to
                take over, and watch which card&apos;s counter moves:
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
                <WriteButton
                    onClick={() => {
                        takeOver(autoplaySession, "stats.views += 1");
                        bumpViews();
                    }}
                    ariaLabel="Increment stats.views"
                >
                    stats.views += 1
                </WriteButton>
                <WriteButton
                    onClick={() => {
                        takeOver(autoplaySession, "header.title = …");
                        rotateTitle();
                    }}
                    ariaLabel="Change the header title"
                >
                    header.title = …
                </WriteButton>
            </div>
            <DemoLog log={demoLog} className="mt-3 flex-1" />
        </div>
    );
}

function WriteButton({
    onClick,
    children,
    ariaLabel,
}: {
    onClick: () => void;
    children: ReactNode;
    ariaLabel: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised px-2 py-1 font-mono text-[11px] text-foreground shadow-sm transition-[color,border-color,transform] duration-150 hover:border-[color:var(--accent-glow)] hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.97]"
        >
            <span aria-hidden className="text-[9px] text-accent">
                ▶
            </span>
            {children}
        </button>
    );
}

function HeaderCard() {
    const header = useNode(dashboard.header);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="rounded-lg border border-border-token bg-background p-3"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    {"<HeaderCard />"}
                </span>
                <RenderBadge renders={renders} />
            </div>
            <p className="mt-2 truncate text-sm font-medium text-foreground">
                {header.title}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
                useNode(dashboard.header)
            </p>
        </div>
    );
}

function StatsCard() {
    const stats = useNode(dashboard.stats);
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="rounded-lg border border-border-token bg-background p-3"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-faint">
                    {"<StatsCard />"}
                </span>
                <RenderBadge renders={renders} />
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">
                {stats.views}{" "}
                <span className="text-xs font-normal text-muted">views</span>
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-faint">
                useNode(dashboard.stats)
            </p>
        </div>
    );
}
