import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const publishPackageCatalog = [
    {
        label: "@retreejs/core",
        directory: "packages/retree-core",
        publishByDefault: true,
    },
    {
        label: "@retreejs/query",
        directory: "packages/retree-query",
        publishByDefault: true,
    },
    {
        label: "@retreejs/react",
        directory: "packages/retree-react",
        publishByDefault: true,
    },
    {
        label: "@retreejs/devtools",
        directory: "packages/retree-devtools",
        publishByDefault: true,
    },
    {
        label: "@retreejs/convex",
        directory: "packages/retree-convex",
        publishByDefault: true,
    },
    {
        label: "@retreejs/react-convex",
        directory: "packages/retree-react-convex",
        publishByDefault: true,
    },
    {
        label: "@retreejs/create",
        directory: "packages/retree-create",
        publishByDefault: true,
    },
    {
        label: "@retreejs/react-eslint-plugin",
        directory: "packages/retree-react-eslint-plugin",
        publishByDefault: false,
    },
    {
        label: "@retreejs/babel-plugin-compiler",
        directory: "packages/retree-babel-plugin-compiler",
        publishByDefault: true,
    },
];

export function parsePublishArguments(args) {
    let dryRunOnly = false;
    let packageName;
    let showHelp = false;
    let useProvenance = false;

    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--help") {
            showHelp = true;
            continue;
        }
        if (argument === "--provenance") {
            useProvenance = true;
            continue;
        }
        if (argument === "--dry-run") {
            dryRunOnly = true;
            continue;
        }
        if (argument === "--package") {
            if (packageName !== undefined) {
                throw new Error(
                    "Publish arguments: --package may only be provided once."
                );
            }
            const value = args[index + 1];
            if (value === undefined) {
                throw new Error(
                    "Publish arguments: --package requires an exact package name."
                );
            }
            if (value.startsWith("--")) {
                throw new Error(
                    `Publish arguments: --package requires a package name before ${value}.`
                );
            }
            packageName = value;
            index++;
            continue;
        }
        if (argument.startsWith("--package=")) {
            if (packageName !== undefined) {
                throw new Error(
                    "Publish arguments: --package may only be provided once."
                );
            }
            const value = argument.slice("--package=".length);
            if (value.length === 0) {
                throw new Error(
                    "Publish arguments: --package= requires an exact package name."
                );
            }
            packageName = value;
            continue;
        }

        throw new Error(`Publish arguments: unknown argument ${argument}.`);
    }

    return { dryRunOnly, packageName, showHelp, useProvenance };
}

export function selectPackagesToPublish(packageName) {
    if (packageName === undefined) {
        return publishPackageCatalog.filter((entry) => entry.publishByDefault);
    }

    const selectedPackage = publishPackageCatalog.find(
        (entry) => entry.label === packageName
    );
    if (selectedPackage === undefined) {
        const packageNames = publishPackageCatalog
            .map((entry) => entry.label)
            .join(", ");
        throw new Error(
            `Publish arguments: unknown package ${packageName}. Expected one of: ${packageNames}.`
        );
    }

    return [selectedPackage];
}

export function buildNpmPublishArguments({ isNewPackage, useProvenance }) {
    const args = ["publish"];
    if (isNewPackage) {
        args.push("--access", "public");
    }
    if (useProvenance) {
        args.push("--provenance");
    }
    return args;
}

/**
 * Whether `packageName` exists on the registry and whether `version` is
 * already published there. Reads only, so it needs no token.
 */
export function npmVersionState(packageName, version, env = process.env) {
    const result = spawnSync(
        "npm",
        ["view", packageName, "versions", "--json"],
        {
            cwd: rootDir,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    if (result.error) {
        throw new Error(
            `npm view ${packageName} versions: failed to start: ${result.error.message}`
        );
    }

    if (result.signal) {
        throw new Error(
            `npm view ${packageName} versions: exited with signal ${result.signal}.`
        );
    }

    if (result.status === 0) {
        const parsed = JSON.parse(result.stdout);
        const versions = Array.isArray(parsed) ? parsed : [parsed];
        return {
            packageExists: true,
            versionPublished: versions.includes(version),
        };
    }

    if (isNpmNotFound(result.stderr)) {
        return { packageExists: false, versionPublished: false };
    }

    const stderr = result.stderr.trim();
    if (stderr.length === 0) {
        throw new Error(
            `npm view ${packageName} versions: exited with status ${String(
                result.status
            )}.`
        );
    }

    throw new Error(
        `npm view ${packageName} versions: exited with status ${String(
            result.status
        )}: ${stderr}`
    );
}

/**
 * How long to wait between registry reads while a just-published version
 * propagates. npm accepts a publish before every read replica serves it, so
 * the packages published last are the ones a read right after the publish
 * step can still miss.
 */
export const registryPropagationDelaysMs = [2000, 4000, 8000, 16000, 30000];

/**
 * Which of `packages` ({ label, version }) are still not on npm, after giving
 * the registry `delaysMs` chances to catch up. Re-reads only the versions
 * still missing, and returns how long it waited so a caller can say so.
 */
export async function findUnpublishedVersions(
    packages,
    {
        readVersionState = npmVersionState,
        delaysMs = registryPropagationDelaysMs,
        wait = sleep,
        onWait = () => {},
    } = {}
) {
    let missing = packages.filter(
        (entry) =>
            !readVersionState(entry.label, entry.version).versionPublished
    );
    let waitedMs = 0;
    for (const delayMs of delaysMs) {
        if (missing.length === 0) {
            return { missing, waitedMs };
        }
        onWait({ missing, delayMs });
        await wait(delayMs);
        waitedMs += delayMs;
        missing = missing.filter(
            (entry) =>
                !readVersionState(entry.label, entry.version).versionPublished
        );
    }
    return { missing, waitedMs };
}

function sleep(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isNpmNotFound(stderr) {
    if (stderr.includes("E404")) {
        return true;
    }

    if (stderr.includes("404 Not Found")) {
        return true;
    }

    return stderr.includes("is not in this registry");
}
