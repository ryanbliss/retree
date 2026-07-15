#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
    CliFlags,
    FLAG_HELP_LINES,
    parseCliFlags,
    resolveSelectionsFromFlags,
} from "./args.js";
import {
    applyTsconfigDecoratorFix,
    inspectDecoratorSetup,
    renderDecoratorNote,
} from "./decorators.js";
import {
    detectPackageManagerInDirectory,
    readTargetProject,
} from "./detect.js";
import { CommandRunner, runCommand } from "./install.js";
import {
    formatPlannedCommand,
    InstallSelections,
    PlannedCommand,
    resolveInstallPlan,
} from "./plan.js";
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

/**
 * Thrown when the Retree packages installed successfully but the follow-up
 * AI-skill install step failed, so the exit path can say exactly that
 * instead of implying the whole install failed.
 */
export class SkillInstallFailedError extends Error {
    constructor(skillCommand: PlannedCommand, cause: unknown) {
        super(
            [
                "Retree packages were installed successfully, but installing the Retree AI skill failed:",
                `  ${formatErrorMessage(cause)}`,
                "Retry just the skill step with:",
                `  ${formatPlannedCommand(skillCommand)}`,
            ].join("\n")
        );
        this.name = "SkillInstallFailedError";
    }
}

export async function main(
    argv = process.argv.slice(2),
    options: Partial<MainOptions> = {}
) {
    const flags = parseCliFlags(argv);
    if (flags.help) {
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

    const packageManager =
        flags.packageManager ?? detectPackageManagerInDirectory(cwd);
    const projectLabel = target.name ?? cwd;
    console.log(
        `${colorize("Retree installer", "bold", "cyan")} ${colorize(
            `— ${projectLabel} (${packageManager})`,
            "dim"
        )}`
    );

    const flagSelections = resolveSelectionsFromFlags(flags, {
        react: target.hasReact,
        convex: target.hasConvex,
    });
    let selections: InstallSelections;
    if (flagSelections !== undefined) {
        selections = flagSelections;
    } else if (isTTY) {
        const prompted = await promptAdapter.chooseFeatures({
            react: target.hasReact,
            convex: target.hasConvex,
        });
        selections = { ...prompted, skill: flags.skill ?? prompted.skill };
    } else {
        throw new Error(renderNonInteractiveError());
    }

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

    if (isTTY && !flags.yes) {
        const confirmed = await promptAdapter.confirmPlan();
        if (!confirmed) {
            console.log("No changes made.");
            return;
        }
    }

    console.log(`\n> ${formatPlannedCommand(plan.installCommand)}`);
    await run(plan.installCommand, cwd);

    if (plan.skillCommand !== undefined) {
        console.log(`\n> ${formatPlannedCommand(plan.skillCommand)}`);
        try {
            await run(plan.skillCommand, cwd);
        } catch (error) {
            throw new SkillInstallFailedError(plan.skillCommand, error);
        }
    }

    await reportDecoratorSetup(cwd, isTTY, flags, promptAdapter);

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

/**
 * Prints the optional decorator-authoring note when the target project's
 * tsconfig/TypeScript/Babel setup conflicts with authoring Retree
 * decorators. Offers the tsconfig fix only in interactive runs and only
 * with explicit confirmation — never auto-edits.
 */
async function reportDecoratorSetup(
    cwd: string,
    isTTY: boolean,
    flags: CliFlags,
    promptAdapter: PromptAdapter
): Promise<void> {
    const report = inspectDecoratorSetup(cwd);
    if (report.findings.length === 0) {
        return;
    }
    console.log(`\n${renderDecoratorNote(report.findings)}`);
    if (!isTTY) {
        return;
    }
    if (flags.yes) {
        return;
    }
    if (!report.canOfferTsconfigFix) {
        return;
    }
    if (report.tsconfigPath === undefined) {
        return;
    }
    const applyFix = await promptAdapter.confirmTsconfigDecoratorFix();
    if (!applyFix) {
        return;
    }
    applyTsconfigDecoratorFix(report.tsconfigPath);
    console.log(
        colorize(
            `Updated ${report.tsconfigPath}: "experimentalDecorators" is now false.`,
            "dim"
        )
    );
}

function renderNonInteractiveError() {
    return [
        "@retreejs/create is running without an interactive terminal. Pass flags to run unattended:",
        ...FLAG_HELP_LINES,
        "",
        "Examples:",
        "  npm create @retreejs@latest -- --yes",
        "  npm create @retreejs@latest -- --react --convex --no-skill",
        "",
        "Or install manually:",
        ...MANUAL_INSTALL_COMBOS.map((combo) => `  ${combo}`),
    ].join("\n");
}

function renderHelp() {
    return [
        "Usage: npm create @retreejs@latest [-- options]",
        "",
        "Adds the latest Retree packages to the project in the current",
        "directory. Interactive by default: detects react and convex to",
        "preselect the matching integrations, and can install the Retree AI",
        "skill for coding agents. Pass flags to run unattended (e.g. from",
        "scripts or coding agents).",
        "",
        "Options:",
        ...FLAG_HELP_LINES,
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

function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
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
