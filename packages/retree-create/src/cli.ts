#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
    detectPackageManagerInDirectory,
    readTargetProject,
} from "./detect.js";
import { CommandRunner, runCommand } from "./install.js";
import { formatPlannedCommand, resolveInstallPlan } from "./plan.js";
import { createInquirerPromptAdapter, PromptAdapter } from "./prompts.js";

export interface MainOptions {
    cwd: string;
    isTTY: boolean;
    promptAdapter: PromptAdapter;
    runCommand: CommandRunner;
}

const MANUAL_INSTALL_COMBOS = [
    "npm i @retreejs/core",
    "npm i @retreejs/core @retreejs/react",
    "npm i @retreejs/core @retreejs/convex convex",
    "npm i @retreejs/core @retreejs/react @retreejs/convex @retreejs/react-convex convex",
];

export async function main(
    argv = process.argv.slice(2),
    options: Partial<MainOptions> = {}
) {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(renderHelp());
        return;
    }

    const cwd = options.cwd ?? process.cwd();
    const isTTY = options.isTTY ?? process.stdin.isTTY === true;
    const promptAdapter =
        options.promptAdapter ?? createInquirerPromptAdapter();
    const run = options.runCommand ?? runCommand;

    const target = readTargetProject(cwd);
    if (target === undefined) {
        throw new Error(
            `@retreejs/create adds Retree to an existing project, but no package.json was found in ${cwd}. Run "npm init" first, then re-run "npm create @retreejs@latest".`
        );
    }

    if (!isTTY) {
        throw new Error(
            [
                "@retreejs/create requires an interactive terminal. Install Retree manually instead:",
                ...MANUAL_INSTALL_COMBOS.map((combo) => `  ${combo}`),
            ].join("\n")
        );
    }

    const packageManager = detectPackageManagerInDirectory(cwd);
    const projectLabel = target.name ?? cwd;
    console.log(
        `${colorize("Retree installer", "bold", "cyan")} ${colorize(
            `— ${projectLabel} (${packageManager})`,
            "dim"
        )}`
    );

    const selections = await promptAdapter.chooseFeatures({
        react: target.hasReact,
        convex: target.hasConvex,
    });
    const plan = resolveInstallPlan(selections, target, packageManager);

    if (plan.includesReactConvex) {
        console.log(
            colorize(
                "Both React and Convex selected — including @retreejs/react-convex (shared ConvexReactClient adapter).",
                "dim"
            )
        );
    }
    if (plan.addsConvexPeer) {
        console.log(
            colorize(
                "convex is not installed yet — adding convex@latest (required peer of @retreejs/convex).",
                "dim"
            )
        );
    }
    if (plan.warnMissingReact) {
        console.log(
            colorize(
                "Heads up: react is not installed. @retreejs/react requires react ^16.8.0 || ^17 || ^18 || ^19 — add React through your framework setup.",
                "yellow"
            )
        );
    }

    console.log(`\nAbout to run in ${cwd}:`);
    console.log(
        `  ${colorize(formatPlannedCommand(plan.installCommand), "bold")}`
    );
    if (plan.skillCommand !== undefined) {
        console.log(
            `  ${colorize(formatPlannedCommand(plan.skillCommand), "bold")}`
        );
    }

    const confirmed = await promptAdapter.confirmPlan();
    if (!confirmed) {
        console.log("No changes made.");
        return;
    }

    console.log(`\n> ${formatPlannedCommand(plan.installCommand)}`);
    await run(plan.installCommand, cwd);

    if (plan.skillCommand !== undefined) {
        console.log(`\n> ${formatPlannedCommand(plan.skillCommand)}`);
        await run(plan.skillCommand, cwd);
    }

    console.log(`\n${colorize("Retree is ready.", "bold", "green")}`);
    console.log(
        [
            "Get started:",
            '  import { Retree } from "@retreejs/core";',
            "  const state = Retree.root({ count: 0 });",
            "  state.count += 1;",
            "",
            "Docs: https://github.com/ryanbliss/retree",
        ].join("\n")
    );
}

function renderHelp() {
    return [
        "Usage: npm create @retreejs@latest",
        "",
        "Interactively adds the latest Retree packages to the project in the",
        "current directory. Detects react and convex to preselect the matching",
        "integrations, and can install the Retree AI skill for coding agents.",
        "",
        "Options:",
        "  -h, --help  Show this help text.",
        "",
        "Manual install combos:",
        ...MANUAL_INSTALL_COMBOS.map((combo) => `  ${combo}`),
    ].join("\n");
}

function isDirectExecution() {
    const entrypoint = process.argv[1];
    if (entrypoint === undefined) {
        return false;
    }
    // Package managers run bins through symlinks (node_modules/.bin), so the
    // entrypoint must be resolved to its real path before comparing.
    let resolvedEntrypoint: string;
    try {
        resolvedEntrypoint = realpathSync(entrypoint);
    } catch {
        resolvedEntrypoint = entrypoint;
    }
    return import.meta.url === pathToFileURL(resolvedEntrypoint).href;
}

function isExitPromptError(error: unknown): boolean {
    return error instanceof Error && error.name === "ExitPromptError";
}

type ConsoleStyle = "bold" | "cyan" | "dim" | "green" | "yellow";

const CONSOLE_STYLE_CODES: Record<ConsoleStyle, number> = {
    bold: 1,
    cyan: 36,
    dim: 2,
    green: 32,
    yellow: 33,
};

function colorize(value: string, ...styles: ConsoleStyle[]) {
    if (styles.length === 0) {
        return value;
    }

    const codes = styles
        .map((styleName) => CONSOLE_STYLE_CODES[styleName])
        .join(";");
    return `\x1b[${codes}m${value}\x1b[0m`;
}

if (isDirectExecution()) {
    main().catch((error: unknown) => {
        if (isExitPromptError(error)) {
            console.error("Cancelled — no changes made.");
            process.exitCode = 130;
            return;
        }
        if (error instanceof Error) {
            console.error(error.message);
        } else {
            console.error(String(error));
        }
        process.exitCode = 1;
    });
}
