import { describe, expect, it } from "vitest";
import { detectPackageManager, parseTargetProject } from "./detect.js";

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
});
