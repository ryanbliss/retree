import { PackageManager } from "./detect.js";
import { InstallSelections } from "./plan.js";

export interface CliFlags {
    help: boolean;
    react: boolean | undefined;
    convex: boolean | undefined;
    coreOnly: boolean;
    skill: boolean | undefined;
    yes: boolean;
    packageManager: PackageManager | undefined;
}

export const FLAG_HELP_LINES = [
    "  --yes, -y        Accept detected defaults without prompting (React/Convex",
    "                   from the project's dependencies, AI skill on).",
    "  --react          Install @retreejs/react.",
    "  --convex         Install @retreejs/convex (adds the convex peer if missing).",
    "  --core-only      Install only @retreejs/core.",
    "  --skill          Install the Retree AI skill for coding agents.",
    "  --no-skill       Skip the Retree AI skill.",
    "  --pm <name>      Use a specific package manager: npm, pnpm, yarn, or bun.",
    "  -h, --help       Show this help text.",
];

const PACKAGE_MANAGER_VALUES: readonly string[] = [
    "npm",
    "pnpm",
    "yarn",
    "bun",
];

function isPackageManager(value: string): value is PackageManager {
    return PACKAGE_MANAGER_VALUES.includes(value);
}

function parsePackageManagerValue(value: string): PackageManager {
    if (!isPackageManager(value)) {
        throw new Error(
            `--pm received "${value}", which is not a supported package manager. Pass one of "npm", "pnpm", "yarn", "bun".`
        );
    }
    return value;
}

export function parseCliFlags(argv: string[]): CliFlags {
    let help = false;
    let react: boolean | undefined;
    let convex: boolean | undefined;
    let coreOnly = false;
    let skill: boolean | undefined;
    let yes = false;
    let packageManager: PackageManager | undefined;

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") {
            help = true;
            continue;
        }
        if (argument === "--react") {
            react = true;
            continue;
        }
        if (argument === "--convex") {
            convex = true;
            continue;
        }
        if (argument === "--core-only") {
            coreOnly = true;
            continue;
        }
        if (argument === "--skill") {
            if (skill === false) {
                throw new Error(
                    "--skill and --no-skill were both passed. Pass only one of them."
                );
            }
            skill = true;
            continue;
        }
        if (argument === "--no-skill") {
            if (skill === true) {
                throw new Error(
                    "--skill and --no-skill were both passed. Pass only one of them."
                );
            }
            skill = false;
            continue;
        }
        if (argument === "--yes" || argument === "-y") {
            yes = true;
            continue;
        }
        if (argument === "--pm") {
            const value = argv[index + 1];
            if (value === undefined) {
                throw new Error(
                    '--pm requires a value. Pass one of "npm", "pnpm", "yarn", "bun".'
                );
            }
            packageManager = parsePackageManagerValue(value);
            index += 1;
            continue;
        }
        if (argument.startsWith("--pm=")) {
            packageManager = parsePackageManagerValue(
                argument.slice("--pm=".length)
            );
            continue;
        }
        throw new Error(
            `Unknown option "${argument}". Supported options: --react, --convex, --core-only, --skill, --no-skill, --yes, --pm <npm|pnpm|yarn|bun>, --help.`
        );
    }

    if (coreOnly && react === true) {
        throw new Error(
            "--core-only and --react were both passed. --core-only installs only @retreejs/core; drop one of the flags."
        );
    }
    if (coreOnly && convex === true) {
        throw new Error(
            "--core-only and --convex were both passed. --core-only installs only @retreejs/core; drop one of the flags."
        );
    }

    return { help, react, convex, coreOnly, skill, yes, packageManager };
}

/**
 * Derives install selections from CLI flags alone, without prompting.
 *
 * Returns `undefined` when the flags do not describe a complete selection —
 * in that case the caller must fall back to interactive prompts (TTY) or
 * error out (non-TTY).
 */
export function resolveSelectionsFromFlags(
    flags: CliFlags,
    detected: { react: boolean; convex: boolean }
): InstallSelections | undefined {
    const skill = flags.skill ?? flags.yes;
    if (flags.coreOnly) {
        return { react: false, convex: false, skill };
    }
    if (flags.yes) {
        return {
            react: flags.react ?? detected.react,
            convex: flags.convex ?? detected.convex,
            skill,
        };
    }
    if (flags.react !== undefined || flags.convex !== undefined) {
        return {
            react: flags.react ?? false,
            convex: flags.convex ?? false,
            skill,
        };
    }
    return undefined;
}
