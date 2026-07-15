import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    detectPackageManager,
    detectPackageManagerAcrossDirectories,
    listPackageManagerSearchDirectories,
    parseTargetProject,
    readTargetProject,
} from "./detect.js";

describe("detectPackageManager", () => {
    const noLockfiles = () => false;

    it("detects pnpm from the user agent", () => {
        expect(
            detectPackageManager("pnpm/9.1.0 npm/? node/v22.0.0", noLockfiles)
        ).toBe("pnpm");
    });

    it("detects yarn from the user agent", () => {
        expect(
            detectPackageManager("yarn/4.2.2 npm/? node/v22.0.0", noLockfiles)
        ).toBe("yarn");
    });

    it("detects bun from the user agent", () => {
        expect(
            detectPackageManager("bun/1.1.0 npm/? node/v22.0.0", noLockfiles)
        ).toBe("bun");
    });

    it("detects npm from the user agent", () => {
        expect(
            detectPackageManager("npm/10.8.1 node/v22.0.0", noLockfiles)
        ).toBe("npm");
    });

    it("prefers the user agent over lockfiles", () => {
        expect(
            detectPackageManager(
                "pnpm/9.1.0 npm/? node/v22.0.0",
                (fileName) => fileName === "yarn.lock"
            )
        ).toBe("pnpm");
    });

    it("falls back to pnpm-lock.yaml without a user agent", () => {
        expect(
            detectPackageManager(
                undefined,
                (fileName) => fileName === "pnpm-lock.yaml"
            )
        ).toBe("pnpm");
    });

    it("falls back to yarn.lock without a user agent", () => {
        expect(
            detectPackageManager(
                undefined,
                (fileName) => fileName === "yarn.lock"
            )
        ).toBe("yarn");
    });

    it("falls back to bun lockfiles without a user agent", () => {
        expect(
            detectPackageManager(
                undefined,
                (fileName) => fileName === "bun.lockb"
            )
        ).toBe("bun");
        expect(
            detectPackageManager(
                undefined,
                (fileName) => fileName === "bun.lock"
            )
        ).toBe("bun");
    });

    it("falls back to package-lock.json without a user agent", () => {
        expect(
            detectPackageManager(
                undefined,
                (fileName) => fileName === "package-lock.json"
            )
        ).toBe("npm");
    });

    it("defaults to npm with no user agent and no lockfiles", () => {
        expect(detectPackageManager(undefined, noLockfiles)).toBe("npm");
    });
});

describe("detectPackageManagerAcrossDirectories", () => {
    it("prefers the user agent over any directory marker", () => {
        expect(
            detectPackageManagerAcrossDirectories(
                "bun/1.1.0 npm/? node/v22.0.0",
                ["/repo/apps/web", "/repo"],
                () => true
            )
        ).toBe("bun");
    });

    it("finds a lockfile in an ancestor directory", () => {
        expect(
            detectPackageManagerAcrossDirectories(
                undefined,
                ["/repo/apps/web", "/repo/apps", "/repo"],
                (directory, fileName) =>
                    directory === "/repo" && fileName === "pnpm-lock.yaml"
            )
        ).toBe("pnpm");
    });

    it("prefers the nearest directory when multiple have lockfiles", () => {
        expect(
            detectPackageManagerAcrossDirectories(
                undefined,
                ["/repo/apps/web", "/repo"],
                (directory, fileName) => {
                    if (directory === "/repo/apps/web") {
                        return fileName === "yarn.lock";
                    }
                    return fileName === "pnpm-lock.yaml";
                }
            )
        ).toBe("yarn");
    });

    it("treats pnpm-workspace.yaml as a pnpm marker", () => {
        expect(
            detectPackageManagerAcrossDirectories(
                undefined,
                ["/repo/packages/app", "/repo"],
                (directory, fileName) =>
                    directory === "/repo" && fileName === "pnpm-workspace.yaml"
            )
        ).toBe("pnpm");
    });

    it("defaults to npm when no directory has a marker", () => {
        expect(
            detectPackageManagerAcrossDirectories(
                undefined,
                ["/repo/apps/web", "/repo"],
                () => false
            )
        ).toBe("npm");
    });
});

describe("listPackageManagerSearchDirectories", () => {
    it("stops at (and includes) the boundary directory", () => {
        expect(
            listPackageManagerSearchDirectories(
                "/repo/apps/web",
                (directory) => directory === "/repo"
            )
        ).toEqual(["/repo/apps/web", "/repo/apps", "/repo"]);
    });

    it("includes only the start directory when it is the boundary", () => {
        expect(
            listPackageManagerSearchDirectories("/repo", () => true)
        ).toEqual(["/repo"]);
    });

    it("stops at the filesystem root without a boundary", () => {
        const directories = listPackageManagerSearchDirectories(
            "/a/b",
            () => false
        );
        expect(directories).toEqual(["/a/b", "/a", "/"]);
    });
});

describe("parseTargetProject", () => {
    it("detects react in dependencies", () => {
        const target = parseTargetProject(
            JSON.stringify({
                name: "my-app",
                dependencies: { react: "^19.0.0" },
            }),
            "/tmp/package.json"
        );
        expect(target.name).toBe("my-app");
        expect(target.hasReact).toBe(true);
        expect(target.hasConvex).toBe(false);
    });

    it("detects react in devDependencies", () => {
        const target = parseTargetProject(
            JSON.stringify({ devDependencies: { react: "^19.0.0" } }),
            "/tmp/package.json"
        );
        expect(target.hasReact).toBe(true);
    });

    it("detects convex in dependencies", () => {
        const target = parseTargetProject(
            JSON.stringify({ dependencies: { convex: "^1.39.1" } }),
            "/tmp/package.json"
        );
        expect(target.hasConvex).toBe(true);
        expect(target.hasReact).toBe(false);
    });

    it("detects both react and convex", () => {
        const target = parseTargetProject(
            JSON.stringify({
                dependencies: { convex: "^1.39.1" },
                devDependencies: { react: "^19.0.0" },
            }),
            "/tmp/package.json"
        );
        expect(target.hasReact).toBe(true);
        expect(target.hasConvex).toBe(true);
    });

    it("detects neither when no dependency fields exist", () => {
        const target = parseTargetProject(
            JSON.stringify({ name: "bare" }),
            "/tmp/package.json"
        );
        expect(target.hasReact).toBe(false);
        expect(target.hasConvex).toBe(false);
    });

    it("omits the name when it is not a string", () => {
        const target = parseTargetProject(
            JSON.stringify({ name: 42 }),
            "/tmp/package.json"
        );
        expect(target.name).toBeUndefined();
    });

    it("throws for malformed JSON", () => {
        expect(() =>
            parseTargetProject("{ not json", "/tmp/package.json")
        ).toThrow(/Could not parse \/tmp\/package\.json as JSON/);
    });

    it("throws for non-object JSON", () => {
        expect(() =>
            parseTargetProject('"just a string"', "/tmp/package.json")
        ).toThrow("Expected /tmp/package.json to contain a JSON object.");
    });

    it("detects react in peerDependencies", () => {
        const target = parseTargetProject(
            JSON.stringify({ peerDependencies: { react: "^18 || ^19" } }),
            "/tmp/package.json"
        );
        expect(target.hasReact).toBe(true);
    });

    it("detects convex in peerDependencies", () => {
        const target = parseTargetProject(
            JSON.stringify({ peerDependencies: { convex: "^1.0.0" } }),
            "/tmp/package.json"
        );
        expect(target.hasConvex).toBe(true);
    });
});

describe("readTargetProject", () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(join(tmpdir(), "retree-create-detect-"));
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    it("returns undefined when there is no package.json", () => {
        expect(readTargetProject(projectDir, () => false)).toBeUndefined();
    });

    it("keeps package.json detection when the resolver misses", () => {
        writeFileSync(
            join(projectDir, "package.json"),
            JSON.stringify({
                name: "my-app",
                dependencies: { react: "^19.0.0" },
            })
        );
        const target = readTargetProject(projectDir, () => false);
        expect(target).toEqual({
            name: "my-app",
            hasReact: true,
            hasConvex: false,
        });
    });

    it("uses module resolution as ground truth when package.json misses", () => {
        writeFileSync(
            join(projectDir, "package.json"),
            JSON.stringify({ name: "workspace-member" })
        );
        const resolved: string[] = [];
        const target = readTargetProject(projectDir, (packageName, cwd) => {
            resolved.push(packageName);
            expect(cwd).toBe(projectDir);
            return packageName === "react";
        });
        expect(target).toEqual({
            name: "workspace-member",
            hasReact: true,
            hasConvex: false,
        });
        expect(resolved).toEqual(["react", "convex"]);
    });
});
