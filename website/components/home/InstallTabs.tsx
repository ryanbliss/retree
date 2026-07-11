"use client";

import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/code/CopyButton";
import { PackageIcon, TerminalIcon } from "@/components/home/icons";

/**
 * Hero install block with an audience tab row above the command — the
 * better-auth.com pattern: pick "Package manager" for a classic install or
 * "AI agents" for the skills-CLI one-liner that teaches a coding agent Retree.
 *
 * The package-manager choice shares PMTabs' localStorage key and event, so a
 * selection here syncs with every docs install block (without editing PMTabs).
 */

const PACKAGES = "@retreejs/core @retreejs/react";
/** Verified against the repo README's "Agent docs and skill" section. */
const SKILLS_COMMAND = "npx skills add ryanbliss/retree --skill retree";

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type Manager = (typeof MANAGERS)[number];

const INSTALL_PREFIX: Record<Manager, string> = {
    npm: "npm i",
    pnpm: "pnpm add",
    yarn: "yarn add",
    bun: "bun add",
};

// Must match components/mdx/PMTabs.tsx so the choice syncs across the site.
const PM_STORAGE_KEY = "retree-pm";
const PM_EVENT = "retree-pm-change";

const AUDIENCES = ["pm", "agents"] as const;
type Audience = (typeof AUDIENCES)[number];

const AUDIENCE_LABELS: Record<Audience, string> = {
    pm: "Package manager",
    agents: "AI agents",
};

const AUDIENCE_STORAGE_KEY = "retree-install-audience";
const AUDIENCE_EVENT = "retree-install-audience-change";

function readStoredChoice<T extends string>(
    key: string,
    options: readonly T[],
    fallback: T
): T {
    try {
        const stored = localStorage.getItem(key);
        if (
            stored !== null &&
            (options as readonly string[]).includes(stored)
        ) {
            return stored as T;
        }
    } catch {
        // storage unavailable — fall through to the default
    }
    return fallback;
}

function persistChoice(key: string, value: string, eventName: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // storage unavailable — selection is per-tab only
    }
    window.dispatchEvent(new Event(eventName));
}

function makeSubscribe(eventName: string) {
    return (callback: () => void): (() => void) => {
        window.addEventListener(eventName, callback);
        window.addEventListener("storage", callback);
        return () => {
            window.removeEventListener(eventName, callback);
            window.removeEventListener("storage", callback);
        };
    };
}

const subscribeToManager = makeSubscribe(PM_EVENT);
const subscribeToAudience = makeSubscribe(AUDIENCE_EVENT);

function readManager(): Manager {
    return readStoredChoice(PM_STORAGE_KEY, MANAGERS, "npm");
}

function readAudience(): Audience {
    return readStoredChoice(AUDIENCE_STORAGE_KEY, AUDIENCES, "pm");
}

function CommandFigure({
    command,
    header,
}: {
    command: string;
    header?: React.ReactNode;
}) {
    return (
        <figure className="relative overflow-hidden rounded-lg border border-border-token bg-code-bg">
            {header}
            <pre className="overflow-x-auto py-3 pl-4 pr-12 font-mono text-[13px] text-foreground">
                <span aria-hidden className="select-none text-faint">
                    ${" "}
                </span>
                {command}
            </pre>
            <CopyButton text={command} alwaysVisible />
        </figure>
    );
}

export function InstallTabs() {
    const audience = useSyncExternalStore<Audience>(
        subscribeToAudience,
        readAudience,
        () => "pm"
    );
    const manager = useSyncExternalStore<Manager>(
        subscribeToManager,
        readManager,
        () => "npm"
    );

    const installCommand = `${INSTALL_PREFIX[manager]} ${PACKAGES}`;

    return (
        <div>
            <div
                role="tablist"
                aria-label="Install method"
                className="flex flex-wrap gap-1"
            >
                {AUDIENCES.map((candidate) => {
                    const isActive = candidate === audience;
                    return (
                        <button
                            key={candidate}
                            role="tab"
                            aria-selected={isActive}
                            onClick={() =>
                                persistChoice(
                                    AUDIENCE_STORAGE_KEY,
                                    candidate,
                                    AUDIENCE_EVENT
                                )
                            }
                            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                                isActive
                                    ? "border-accent-glow bg-surface-raised text-accent"
                                    : "border-transparent text-faint hover:text-foreground"
                            }`}
                        >
                            {candidate === "agents" ? (
                                <TerminalIcon size={13} />
                            ) : (
                                <PackageIcon size={13} />
                            )}
                            {AUDIENCE_LABELS[candidate]}
                        </button>
                    );
                })}
            </div>
            <div className="mt-2">
                {audience === "pm" ? (
                    <CommandFigure
                        command={installCommand}
                        header={
                            <div
                                role="tablist"
                                aria-label="Package manager"
                                className="flex gap-1 border-b border-border-token px-2 pt-1.5"
                            >
                                {MANAGERS.map((candidate) => (
                                    <button
                                        key={candidate}
                                        role="tab"
                                        aria-selected={candidate === manager}
                                        onClick={() =>
                                            persistChoice(
                                                PM_STORAGE_KEY,
                                                candidate,
                                                PM_EVENT
                                            )
                                        }
                                        className={`rounded-t-md px-3 py-1.5 font-mono text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                                            candidate === manager
                                                ? "border-b-2 border-accent text-foreground"
                                                : "text-faint hover:text-muted"
                                        }`}
                                    >
                                        {candidate}
                                    </button>
                                ))}
                            </div>
                        }
                    />
                ) : (
                    <>
                        <CommandFigure command={SKILLS_COMMAND} />
                        <p className="mt-2 text-xs text-faint">
                            Teach your coding agent Retree — works with Claude
                            Code, Cursor, and any agent supporting the open
                            skills CLI.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
