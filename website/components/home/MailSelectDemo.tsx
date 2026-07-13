"use client";

import { Retree } from "@retreejs/core";
import { useNode, useSelect } from "@retreejs/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BurstRenderBadge } from "@/components/visualizer/BurstRenderBadge";
import { useRenderGlow } from "@/components/visualizer/useRenderGlow";
import {
    AutoplayStatusLine,
    createAutoplaySession,
    createTypingBurst,
    takeOver,
    useScriptedAutoplay,
} from "@/components/visualizer/scriptedAutoplay";

type Folder = "Inbox" | "Archive";

interface MailMessage {
    id: number;
    from: string;
    subject: string;
    folder: Folder;
}

interface Mailbox {
    search: string;
    folder: Folder;
    messages: MailMessage[];
}

/** Real Retree tree backing feature demo 2 — the video's mail search. */
const mailbox = Retree.root<Mailbox>({
    search: "",
    folder: "Inbox",
    messages: [
        {
            id: 1,
            from: "Ana Woods",
            subject: "Quarterly growth report",
            folder: "Inbox",
        },
        {
            id: 2,
            from: "Anders Lind",
            subject: "Design review notes",
            folder: "Inbox",
        },
        { id: 3, from: "Elle Pine", subject: "Standup notes", folder: "Inbox" },
        {
            id: 4,
            from: "Ana Woods",
            subject: "Re: offsite agenda",
            folder: "Archive",
        },
        {
            id: 5,
            from: "Dana Field",
            subject: "Benchmark rerun results",
            folder: "Archive",
        },
    ],
});

function filterMessages(mail: Mailbox): MailMessage[] {
    const search = mail.search.toLowerCase();
    return mail.messages.filter(
        (message) =>
            message.from.toLowerCase().includes(search) &&
            message.folder === mail.folder
    );
}

/** Instrumentation shown in the demo: how many times the list's selector
 * has run. Only <Results /> uses this counted wrapper. */
let selectorRuns = 0;

function selectResults(mail: Mailbox): MailMessage[] {
    selectorRuns += 1;
    return filterMessages(mail);
}

/** Element-wise identity: re-render the list only when the results change. */
function sameResults(a: MailMessage[], b: MailMessage[]): boolean {
    return a.length === b.length && a.every((message, i) => message === b[i]);
}

/* The selector-run counter is displayed via this probe: a plain (non-React)
 * subscription mirrors the module counter into it after every emission's
 * synchronous listeners have run, so the badge never races the selector. */
const runsProbe = Retree.root({ count: 0 });
Retree.on(mailbox, "treeChanged", () => {
    window.setTimeout(() => {
        runsProbe.count = selectorRuns;
    }, 0);
});

/* ---------------------------- scripted loop ----------------------------
 * The video's beat: type "ana" one keystroke at a time, then flip the
 * folder to Archive — every dependency write re-runs the selector.
 */

const autoplaySession = createAutoplaySession();

const searchBurst = createTypingBurst({
    read: () => mailbox.search,
    write: (value) => {
        mailbox.search = value;
        autoplaySession.lastLine = `mailbox.search = ${JSON.stringify(value)}`;
    },
    shouldContinue: () =>
        autoplaySession.mode === "auto" || autoplaySession.mode === "done",
    charMs: 420,
});

type AutoplayAction =
    | { kind: "search"; value: string }
    | { kind: "folder"; value: Folder };

const AUTOPLAY_ACTIONS: AutoplayAction[] = [
    { kind: "search", value: "ana" },
    { kind: "folder", value: "Archive" },
    { kind: "folder", value: "Inbox" },
    { kind: "search", value: "" },
    { kind: "search", value: "elle" },
    { kind: "search", value: "" },
];

let autoplayStep = 0;

function setFolder(folder: Folder): void {
    mailbox.folder = folder;
    autoplaySession.lastLine = `mailbox.folder = ${JSON.stringify(folder)}`;
}

function runAutoplayStep(): boolean | void {
    if (searchBurst.isActive()) return false;
    const action = AUTOPLAY_ACTIONS[autoplayStep % AUTOPLAY_ACTIONS.length];
    autoplayStep += 1;
    if (action.kind === "search") {
        searchBurst.start(action.value);
        return;
    }
    setFolder(action.value);
}

function userSetSearch(value: string): void {
    searchBurst.cancel();
    takeOver(autoplaySession, `mailbox.search = ${JSON.stringify(value)}`);
    mailbox.search = value;
}

function userSetFolder(folder: Folder): void {
    searchBurst.cancel();
    takeOver(autoplaySession, `mailbox.folder = ${JSON.stringify(folder)}`);
    mailbox.folder = folder;
}

/** Unmount cleanup: back-navigation must start from a clean slate. */
function handleMailUnmount(): void {
    searchBurst.cancel();
    autoplayStep = 0;
    selectorRuns = 0;
    runsProbe.count = 0;
    mailbox.search = "";
    mailbox.folder = "Inbox";
}

/**
 * Feature-walk demo 2 (the video's mail search): searching and switching
 * folders are plain writes to the mailbox; useSelect re-runs the selector
 * on every one of them and re-renders the list only when the results
 * actually change.
 */
export function MailSelectDemo() {
    const pauseHandlers = useScriptedAutoplay({
        session: autoplaySession,
        intervalMs: 3600,
        initialDelayMs: 1100,
        step: runAutoplayStep,
        maxSteps: 14,
        onUnmount: handleMailUnmount,
    });
    return (
        <div
            {...pauseHandlers}
            className="flex h-full flex-col rounded-xl border border-border-token bg-surface p-3 shadow-[var(--glass-shadow)] sm:p-4"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-faint">
                    <span aria-hidden className="text-accent">
                        ●
                    </span>{" "}
                    mail · useSelect
                </span>
                <SelectorRunsBadge />
            </div>
            <SearchControls />
            <MailList />
            <DependencyStrip />
            <div className="mt-auto pt-3">
                <AutoplayStatusLine
                    session={autoplaySession}
                    idleLine="// scripted searches start in a moment"
                />
            </div>
        </div>
    );
}

/** Flashes and increments every time the selector runs — the video's chip. */
function SelectorRunsBadge() {
    const probe = useNode(runsProbe);
    const { ref } = useRenderGlow<HTMLSpanElement>();
    return (
        <span
            ref={ref}
            className="rounded border border-border-token bg-background px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-faint"
        >
            selector ran:{" "}
            <span
                suppressHydrationWarning
                className="font-semibold text-accent"
            >
                {probe.count}
            </span>
        </span>
    );
}

function SearchControls() {
    const mail = useNode(mailbox);
    return (
        <div className="mt-3">
            <div className="flex items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 py-1.5">
                <span aria-hidden className="text-sm text-faint">
                    ⌕
                </span>
                <input
                    value={mail.search}
                    onChange={(event) => userSetSearch(event.target.value)}
                    placeholder="search sender…"
                    aria-label="Search mail by sender"
                    className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-faint"
                />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
                {(["Inbox", "Archive"] as const).map((folder) => (
                    <button
                        key={folder}
                        type="button"
                        onClick={() => userSetFolder(folder)}
                        aria-pressed={mail.folder === folder}
                        className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                            mail.folder === folder
                                ? "border-[color:var(--accent-glow)] bg-[color:var(--accent-glow-soft)] text-accent"
                                : "border-border-strong text-muted hover:text-foreground"
                        }`}
                    >
                        {folder}
                    </button>
                ))}
                <ResultsCount />
            </div>
        </div>
    );
}

function ResultsCount() {
    const count = useSelect(mailbox, (mail) => filterMessages(mail).length, {
        listenerType: "treeChanged",
    });
    return (
        <span className="ml-auto font-mono text-[11px] tabular-nums text-faint">
            {count} result{count === 1 ? "" : "s"}
        </span>
    );
}

function MailList() {
    const results = useSelect(mailbox, selectResults, {
        listenerType: "treeChanged",
        equals: sameResults,
    });
    const { ref, renders } = useRenderGlow<HTMLDivElement>();
    const reduceMotion = useReducedMotion();
    return (
        <div
            ref={ref}
            className="mt-2 rounded-lg border border-border-token bg-background"
        >
            <div className="flex items-center justify-between gap-2 border-b border-border-token px-2.5 py-1.5">
                <span className="font-mono text-[11px] text-faint">
                    {"<Results />"} — useSelect
                </span>
                <BurstRenderBadge renders={renders} />
            </div>
            <ul>
                <AnimatePresence initial={false}>
                    {results.map((message) => (
                        <motion.li
                            key={message.id}
                            initial={
                                reduceMotion ? false : { height: 0, opacity: 0 }
                            }
                            animate={{ height: "auto", opacity: 1 }}
                            exit={
                                reduceMotion
                                    ? undefined
                                    : { height: 0, opacity: 0 }
                            }
                            transition={{ duration: 0.22, ease: "easeOut" }}
                            className="overflow-hidden border-b border-border-token last:border-b-0"
                        >
                            <div className="flex items-center gap-2 px-2.5 py-2">
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold text-foreground">
                                        {message.from}
                                    </span>
                                    <span className="block truncate text-[11px] text-muted">
                                        {message.subject}
                                    </span>
                                </span>
                                <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-faint">
                                    {message.folder}
                                </span>
                            </div>
                        </motion.li>
                    ))}
                </AnimatePresence>
                {results.length === 0 ? (
                    <li className="px-2.5 py-2 font-mono text-[11px] text-faint">
                        {"// no messages match"}
                    </li>
                ) : null}
            </ul>
        </div>
    );
}

/** The selector's dependencies — each pill flashes when its value changes. */
function DependencyStrip() {
    const mail = useNode(mailbox);
    return (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-faint">
            deps:
            <DepPill label="mail.search" value={mail.search} />
            <DepPill label="mail.folder" value={mail.folder} />
        </p>
    );
}

function DepPill({ label, value }: { label: string; value: string }) {
    return (
        <code
            key={value}
            className="dep-flash rounded-md border border-border-token bg-surface-raised px-1.5 py-0.5 text-foreground"
        >
            {label}
        </code>
    );
}
