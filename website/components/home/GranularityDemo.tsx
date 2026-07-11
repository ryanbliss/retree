"use client";

import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";
import { RenderBadge } from "@/components/visualizer/RenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";
import { DemoButton } from "./DemoButton";

/** Real Retree tree backing feature demo 1 (plain-assignment mutation). */
const dashboard = Retree.root({
    header: { title: "Team dashboard" },
    stats: { views: 0 },
});

const HEADER_TITLES = ["Team dashboard", "Ops dashboard"] as const;

function rotateTitle(): void {
    dashboard.header.title =
        dashboard.header.title === HEADER_TITLES[0]
            ? HEADER_TITLES[1]
            : HEADER_TITLES[0];
}

/**
 * Feature-walk demo 1: two sibling cards subscribe to two sibling nodes.
 * Each button performs the plain assignment printed on it; only the card
 * that reads the mutated node re-renders.
 */
export function GranularityDemo() {
    // The demo shell holds no state and no subscription — its counter
    // staying at 1 while children update is part of the point.
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className="rounded-xl border border-border-token bg-surface p-3 sm:p-4"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs uppercase tracking-widest text-faint">
                    parent — no subscription
                </span>
                <RenderBadge renders={renders} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <HeaderCard />
                <StatsCard />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                <DemoButton onClick={() => (dashboard.stats.views += 1)}>
                    stats.views += 1
                </DemoButton>
                <DemoButton
                    onClick={rotateTitle}
                    ariaLabel="Change the header title"
                >
                    header.title = …
                </DemoButton>
            </div>
        </div>
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
