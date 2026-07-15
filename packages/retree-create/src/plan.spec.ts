import { describe, expect, it } from "vitest";
import { TargetProject } from "./detect.js";
import { InstallSelections, resolveInstallPlan } from "./plan.js";

const bareTarget: TargetProject = {
    name: "my-app",
    hasReact: false,
    hasConvex: false,
};

function selections(
    overrides: Partial<InstallSelections> = {}
): InstallSelections {
    return { react: false, convex: false, skill: false, ...overrides };
}

describe("resolveInstallPlan", () => {
    it("installs core only for an empty selection", () => {
        const plan = resolveInstallPlan(selections(), bareTarget, "npm");
        expect(plan.packageSpecs).toEqual(["@retreejs/core@latest"]);
        expect(plan.includesReactConvex).toBe(false);
        expect(plan.addsConvexPeer).toBe(false);
        expect(plan.warnMissingReact).toBe(false);
        expect(plan.skillCommand).toBeUndefined();
    });

    it("adds @retreejs/react when react is selected", () => {
        const plan = resolveInstallPlan(
            selections({ react: true }),
            { ...bareTarget, hasReact: true },
            "npm"
        );
        expect(plan.packageSpecs).toEqual([
            "@retreejs/core@latest",
            "@retreejs/react@latest",
        ]);
        expect(plan.warnMissingReact).toBe(false);
    });

    it("warns when react is selected but not installed", () => {
        const plan = resolveInstallPlan(
            selections({ react: true }),
            bareTarget,
            "npm"
        );
        expect(plan.warnMissingReact).toBe(true);
        expect(plan.packageSpecs).not.toContain("react@latest");
    });

    it("adds the convex peer when convex is selected but not installed", () => {
        const plan = resolveInstallPlan(
            selections({ convex: true }),
            bareTarget,
            "npm"
        );
        expect(plan.packageSpecs).toEqual([
            "@retreejs/core@latest",
            "@retreejs/convex@latest",
            "convex@latest",
        ]);
        expect(plan.addsConvexPeer).toBe(true);
    });

    it("skips the convex peer when convex is already installed", () => {
        const plan = resolveInstallPlan(
            selections({ convex: true }),
            { ...bareTarget, hasConvex: true },
            "npm"
        );
        expect(plan.packageSpecs).toEqual([
            "@retreejs/core@latest",
            "@retreejs/convex@latest",
        ]);
        expect(plan.addsConvexPeer).toBe(false);
    });

    it("includes @retreejs/react-convex when react and convex are both selected", () => {
        const plan = resolveInstallPlan(
            selections({ react: true, convex: true }),
            { ...bareTarget, hasReact: true, hasConvex: true },
            "npm"
        );
        expect(plan.packageSpecs).toEqual([
            "@retreejs/core@latest",
            "@retreejs/react@latest",
            "@retreejs/convex@latest",
            "@retreejs/react-convex@latest",
        ]);
        expect(plan.includesReactConvex).toBe(true);
    });

    it("builds an npm install command", () => {
        const plan = resolveInstallPlan(selections(), bareTarget, "npm");
        expect(plan.installCommand).toEqual({
            command: "npm",
            args: ["install", "@retreejs/core@latest"],
        });
    });

    it("builds a pnpm add command", () => {
        const plan = resolveInstallPlan(selections(), bareTarget, "pnpm");
        expect(plan.installCommand).toEqual({
            command: "pnpm",
            args: ["add", "@retreejs/core@latest"],
        });
    });

    it("builds a yarn add command", () => {
        const plan = resolveInstallPlan(selections(), bareTarget, "yarn");
        expect(plan.installCommand).toEqual({
            command: "yarn",
            args: ["add", "@retreejs/core@latest"],
        });
    });

    it("builds a bun add command", () => {
        const plan = resolveInstallPlan(selections(), bareTarget, "bun");
        expect(plan.installCommand).toEqual({
            command: "bun",
            args: ["add", "@retreejs/core@latest"],
        });
    });

    it("includes the skill command when the skill is selected", () => {
        const plan = resolveInstallPlan(
            selections({ skill: true }),
            bareTarget,
            "npm"
        );
        expect(plan.skillCommand).toEqual({
            command: "npx",
            args: ["skills", "add", "ryanbliss/retree", "--skill", "retree"],
        });
    });

    it("runs the skill through pnpm dlx for pnpm projects", () => {
        const plan = resolveInstallPlan(
            selections({ skill: true }),
            bareTarget,
            "pnpm"
        );
        expect(plan.skillCommand).toEqual({
            command: "pnpm",
            args: [
                "dlx",
                "skills",
                "add",
                "ryanbliss/retree",
                "--skill",
                "retree",
            ],
        });
    });

    it("runs the skill through yarn dlx for yarn projects", () => {
        const plan = resolveInstallPlan(
            selections({ skill: true }),
            bareTarget,
            "yarn"
        );
        expect(plan.skillCommand).toEqual({
            command: "yarn",
            args: [
                "dlx",
                "skills",
                "add",
                "ryanbliss/retree",
                "--skill",
                "retree",
            ],
        });
    });

    it("runs the skill through bunx for bun projects", () => {
        const plan = resolveInstallPlan(
            selections({ skill: true }),
            bareTarget,
            "bun"
        );
        expect(plan.skillCommand).toEqual({
            command: "bunx",
            args: ["skills", "add", "ryanbliss/retree", "--skill", "retree"],
        });
    });
});
