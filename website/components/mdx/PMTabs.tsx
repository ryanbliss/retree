"use client";

import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/code/CopyButton";

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type Manager = (typeof MANAGERS)[number];

const COMMANDS: Record<Manager, { install: string; run: string }> = {
    npm: { install: "npm i", run: "npm run" },
    pnpm: { install: "pnpm add", run: "pnpm" },
    yarn: { install: "yarn add", run: "yarn" },
    bun: { install: "bun add", run: "bun run" },
};

/**
 * `npm create @retreejs` resolves to the @retreejs/create package. bun's
 * bare-scope create mapping is unreliable, so it uses `bunx` instead.
 */
const CREATE_COMMAND: Record<Manager, string> = {
    npm: "npm create @retreejs@latest",
    pnpm: "pnpm create @retreejs",
    yarn: "yarn create @retreejs",
    bun: "bunx @retreejs/create",
};

const STORAGE_KEY = "retree-pm";
const PM_EVENT = "retree-pm-change";

function readStored(): Manager {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (
            stored !== null &&
            (MANAGERS as readonly string[]).includes(stored)
        ) {
            return stored as Manager;
        }
    } catch {
        // storage unavailable — fall through to default
    }
    return "npm";
}

function subscribe(callback: () => void): () => void {
    window.addEventListener(PM_EVENT, callback);
    window.addEventListener("storage", callback);
    return () => {
        window.removeEventListener(PM_EVENT, callback);
        window.removeEventListener("storage", callback);
    };
}

/**
 * Package-manager tabbed install command. The selected manager persists in
 * localStorage and syncs across every PMTabs instance on all pages.
 *
 * Pass `packages` for a direct install, or `create` for the interactive
 * `npm create @retreejs` installer command.
 */
export function PMTabs({
    packages,
    create,
}: {
    packages?: string;
    create?: boolean;
}) {
    const manager = useSyncExternalStore<Manager>(
        subscribe,
        readStored,
        () => "npm"
    );

    const select = (next: Manager) => {
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // storage unavailable — selection is per-tab only
        }
        window.dispatchEvent(new Event(PM_EVENT));
    };

    if (create === true && packages !== undefined) {
        throw new Error(
            "PMTabs accepts either `create` or `packages`, not both."
        );
    }
    if (create !== true && packages === undefined) {
        throw new Error("PMTabs requires either `create` or `packages`.");
    }

    const command =
        create === true
            ? CREATE_COMMAND[manager]
            : `${COMMANDS[manager].install} ${packages}`;

    return (
        <figure className="group relative my-5 overflow-hidden rounded-lg border border-border-token bg-code-bg">
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
                        onClick={() => select(candidate)}
                        className={`rounded-t-md px-3 py-1.5 font-mono text-xs transition-colors ${
                            candidate === manager
                                ? "border-b-2 border-accent text-foreground"
                                : "text-faint hover:text-muted"
                        }`}
                    >
                        {candidate}
                    </button>
                ))}
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] text-foreground">
                <span aria-hidden className="select-none text-faint">
                    ${" "}
                </span>
                {command}
            </pre>
            <CopyButton text={command} />
        </figure>
    );
}
