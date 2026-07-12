import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface TargetProject {
    name: string | undefined;
    hasReact: boolean;
    hasConvex: boolean;
}

export function parseTargetProject(
    packageJsonText: string,
    packageJsonPath: string
): TargetProject {
    let parsed: unknown;
    try {
        parsed = JSON.parse(packageJsonText);
    } catch (error) {
        throw new Error(
            `Could not parse ${packageJsonPath} as JSON: ${formatErrorMessage(
                error
            )}`
        );
    }

    if (!isRecord(parsed)) {
        throw new Error(
            `Expected ${packageJsonPath} to contain a JSON object.`
        );
    }

    return {
        name: readOptionalString(parsed, "name"),
        hasReact: hasDependency(parsed, "react"),
        hasConvex: hasDependency(parsed, "convex"),
    };
}

export function readTargetProject(cwd: string): TargetProject | undefined {
    const packageJsonPath = resolve(cwd, "package.json");
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }
    return parseTargetProject(
        readFileSync(packageJsonPath, "utf8"),
        packageJsonPath
    );
}

const LOCKFILES_IN_DETECTION_ORDER: Array<{
    fileName: string;
    packageManager: PackageManager;
}> = [
    { fileName: "pnpm-lock.yaml", packageManager: "pnpm" },
    { fileName: "yarn.lock", packageManager: "yarn" },
    { fileName: "bun.lockb", packageManager: "bun" },
    { fileName: "bun.lock", packageManager: "bun" },
    { fileName: "package-lock.json", packageManager: "npm" },
];

export function detectPackageManager(
    userAgent: string | undefined,
    lockfileExists: (fileName: string) => boolean
): PackageManager {
    if (userAgent !== undefined) {
        if (userAgent.startsWith("pnpm/")) {
            return "pnpm";
        }
        if (userAgent.startsWith("yarn/")) {
            return "yarn";
        }
        if (userAgent.startsWith("bun/")) {
            return "bun";
        }
        if (userAgent.startsWith("npm/")) {
            return "npm";
        }
    }

    for (const lockfile of LOCKFILES_IN_DETECTION_ORDER) {
        if (lockfileExists(lockfile.fileName)) {
            return lockfile.packageManager;
        }
    }

    return "npm";
}

export function detectPackageManagerInDirectory(cwd: string): PackageManager {
    return detectPackageManager(process.env.npm_config_user_agent, (fileName) =>
        existsSync(resolve(cwd, fileName))
    );
}

function hasDependency(
    packageJson: Record<string, unknown>,
    dependencyName: string
): boolean {
    const dependencyFields = ["dependencies", "devDependencies"];
    return dependencyFields.some((field) => {
        const dependencies = packageJson[field];
        if (!isRecord(dependencies)) {
            return false;
        }
        return dependencyName in dependencies;
    });
}

function readOptionalString(
    record: Record<string, unknown>,
    key: string
): string | undefined {
    const value = record[key];
    if (typeof value !== "string") {
        return undefined;
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
