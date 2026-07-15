import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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

/**
 * Checks whether `packageName` resolves from `cwd`'s node_modules chain.
 * Ground truth for monorepos where the dependency is declared at the
 * workspace root instead of the target project's own package.json.
 */
export type DependencyResolver = (packageName: string, cwd: string) => boolean;

const nodeRequire = createRequire(import.meta.url);

export const resolveDependencyFromNodeModules: DependencyResolver = (
    packageName,
    cwd
) => {
    try {
        nodeRequire.resolve(`${packageName}/package.json`, {
            paths: [resolve(cwd)],
        });
        return true;
    } catch {
        return false;
    }
};

export function readTargetProject(
    cwd: string,
    resolveDependency: DependencyResolver = resolveDependencyFromNodeModules
): TargetProject | undefined {
    const packageJsonPath = resolve(cwd, "package.json");
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }
    const target = parseTargetProject(
        readFileSync(packageJsonPath, "utf8"),
        packageJsonPath
    );
    return {
        name: target.name,
        hasReact: target.hasReact || resolveDependency("react", cwd),
        hasConvex: target.hasConvex || resolveDependency("convex", cwd),
    };
}

const PACKAGE_MANAGER_MARKERS_IN_DETECTION_ORDER: Array<{
    fileName: string;
    packageManager: PackageManager;
}> = [
    { fileName: "pnpm-lock.yaml", packageManager: "pnpm" },
    { fileName: "pnpm-workspace.yaml", packageManager: "pnpm" },
    { fileName: "yarn.lock", packageManager: "yarn" },
    { fileName: "bun.lockb", packageManager: "bun" },
    { fileName: "bun.lock", packageManager: "bun" },
    { fileName: "package-lock.json", packageManager: "npm" },
];

function detectPackageManagerFromUserAgent(
    userAgent: string | undefined
): PackageManager | undefined {
    if (userAgent === undefined) {
        return undefined;
    }
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
    return undefined;
}

export function detectPackageManager(
    userAgent: string | undefined,
    lockfileExists: (fileName: string) => boolean
): PackageManager {
    return detectPackageManagerAcrossDirectories(
        userAgent,
        ["."],
        (_directory, fileName) => lockfileExists(fileName)
    );
}

/**
 * Detects the package manager from the invoking user agent, then from
 * lockfiles/workspace markers checked per directory (nearest directory
 * first — pass ancestors in walk-up order for monorepo support).
 */
export function detectPackageManagerAcrossDirectories(
    userAgent: string | undefined,
    directories: string[],
    fileExistsInDirectory: (directory: string, fileName: string) => boolean
): PackageManager {
    const fromUserAgent = detectPackageManagerFromUserAgent(userAgent);
    if (fromUserAgent !== undefined) {
        return fromUserAgent;
    }

    for (const directory of directories) {
        for (const marker of PACKAGE_MANAGER_MARKERS_IN_DETECTION_ORDER) {
            if (fileExistsInDirectory(directory, marker.fileName)) {
                return marker.packageManager;
            }
        }
    }

    return "npm";
}

/**
 * Lists `cwd` and its ancestors, stopping (inclusively) at the first
 * directory `isSearchBoundary` accepts — typically the git or workspace
 * root — or at the filesystem root.
 */
export function listPackageManagerSearchDirectories(
    cwd: string,
    isSearchBoundary: (directory: string) => boolean
): string[] {
    const directories: string[] = [];
    let current = resolve(cwd);
    for (;;) {
        directories.push(current);
        if (isSearchBoundary(current)) {
            break;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return directories;
}

function isSearchBoundaryOnDisk(directory: string): boolean {
    if (existsSync(resolve(directory, ".git"))) {
        return true;
    }
    if (existsSync(resolve(directory, "pnpm-workspace.yaml"))) {
        return true;
    }
    return packageJsonDeclaresWorkspaces(directory);
}

function packageJsonDeclaresWorkspaces(directory: string): boolean {
    const packageJsonPath = resolve(directory, "package.json");
    if (!existsSync(packageJsonPath)) {
        return false;
    }
    try {
        const parsed: unknown = JSON.parse(
            readFileSync(packageJsonPath, "utf8")
        );
        if (!isRecord(parsed)) {
            return false;
        }
        return "workspaces" in parsed;
    } catch {
        return false;
    }
}

export function detectPackageManagerInDirectory(cwd: string): PackageManager {
    const directories = listPackageManagerSearchDirectories(
        cwd,
        isSearchBoundaryOnDisk
    );
    return detectPackageManagerAcrossDirectories(
        process.env.npm_config_user_agent,
        directories,
        (directory, fileName) => existsSync(resolve(directory, fileName))
    );
}

function hasDependency(
    packageJson: Record<string, unknown>,
    dependencyName: string
): boolean {
    const dependencyFields = [
        "dependencies",
        "devDependencies",
        "peerDependencies",
    ];
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
