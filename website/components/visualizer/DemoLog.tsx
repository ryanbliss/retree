"use client";

import { Retree } from "@retreejs/core";
import { useNode } from "@retreejs/react";

export interface DemoLogEntry {
    id: number;
    /** The write that ran, printed as code (e.g. `stats.views += 1`). */
    text: string;
    /**
     * Whether the write emitted where the demo says it matters (✅) or stayed
     * quiet there (❌) — the same convention as the ✅/❌ comments in the code
     * blocks each demo sits next to.
     */
    emitted: boolean;
    /** Short outcome shown after the write (e.g. `<StatsCard /> only`). */
    note?: string;
}

export interface DemoLogState {
    entries: DemoLogEntry[];
}

let nextEntryId = 1;

const MAX_ENTRIES = 24;

/** A demo's write log — itself a Retree tree, read below with `useNode`. */
export function createDemoLog(): DemoLogState {
    return Retree.root<DemoLogState>({ entries: [] });
}

export function pushDemoLog(
    log: DemoLogState,
    text: string,
    emitted: boolean,
    note?: string
): void {
    log.entries.unshift({ id: nextEntryId, text, emitted, note });
    nextEntryId += 1;
    if (log.entries.length > MAX_ENTRIES) {
        log.entries.splice(MAX_ENTRIES, log.entries.length - MAX_ENTRIES);
    }
}

export function clearDemoLog(log: DemoLogState): void {
    log.entries.splice(0, log.entries.length);
}

/**
 * Scrolling feed of the writes a demo has run, newest first. Give it
 * `flex-1` inside a stretched demo column and it soaks up whatever height
 * the code block next door needs — up to the `max-h` cap. The entries list
 * is absolutely positioned inside a `flex-1` shim so accumulating entries
 * (autoplay runs for a while) contribute zero intrinsic height: the log can
 * only ever be stretched from outside, never grow the demo column itself.
 */
export function DemoLog({
    log,
    className = "",
}: {
    log: DemoLogState;
    className?: string;
}) {
    const entries = useNode(log.entries);
    return (
        <div
            className={`flex max-h-72 min-h-24 flex-col overflow-hidden rounded-lg border border-border-token bg-background p-3 ${className}`}
        >
            <p className="shrink-0 font-mono text-[11px] text-faint">
                write log — a Retree tree too: useNode(log.entries)
            </p>
            {entries.length === 0 ? (
                <p className="mt-2 font-mono text-[11px] text-faint">
                    {"// writes will show up here"}
                </p>
            ) : (
                <div className="relative mt-2 flex-1">
                    <ul className="absolute inset-0 space-y-1 overflow-y-auto">
                        {entries.map((entry) => (
                            <li
                                key={entry.id}
                                className="flex items-baseline gap-1.5 font-mono text-[11px] leading-4"
                            >
                                <span
                                    aria-hidden
                                    className="shrink-0 text-[10px]"
                                >
                                    {entry.emitted ? "✅" : "❌"}
                                </span>
                                <span className="min-w-0 text-muted">
                                    {entry.text}
                                    {entry.note !== undefined ? (
                                        <span className="text-faint">
                                            {" "}
                                            — {entry.note}
                                        </span>
                                    ) : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
