import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { PlannedCommand } from "./plan.js";
import { PromptAdapter } from "./prompts.js";

interface RanCommand {
    plannedCommand: PlannedCommand;
    cwd: string;
}

function createRecordingRunner(ranCommands: RanCommand[]) {
    return async (plannedCommand: PlannedCommand, cwd: string) => {
        ranCommands.push({ plannedCommand, cwd });
    };
}

function createUnusablePromptAdapter(): PromptAdapter {
    return {
        chooseFeatures() {
            throw new Error("chooseFeatures must not be called in this test.");
        },
        confirmPlan() {
            throw new Error("confirmPlan must not be called in this test.");
        },
        confirmTsconfigDecoratorFix() {
            throw new Error(
                "confirmTsconfigDecoratorFix must not be called in this test."
            );
        },
    };
}

describe("main", () => {
    let projectDir: string;
    let ranCommands: RanCommand[];

    beforeEach(() => {
        projectDir = mkdtempSync(join(tmpdir(), "retree-create-cli-"));
        ranCommands = [];
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    function writePackageJson(contents: Record<string, unknown>) {
        writeFileSync(
            join(projectDir, "package.json"),
            JSON.stringify(contents)
        );
    }

    it("errors without a package.json", async () => {
        await expect(
            main(["--yes"], {
                cwd: projectDir,
                isTTY: false,
                promptAdapter: createUnusablePromptAdapter(),
                runCommand: createRecordingRunner(ranCommands),
            })
        ).rejects.toThrow(/no package\.json was found/);
        expect(ranCommands).toEqual([]);
    });

    it("errors in non-TTY mode without deciding flags, listing them", async () => {
        writePackageJson({ name: "my-app" });
        await expect(
            main([], {
                cwd: projectDir,
                isTTY: false,
                promptAdapter: createUnusablePromptAdapter(),
                runCommand: createRecordingRunner(ranCommands),
            })
        ).rejects.toThrow(
            /without an interactive terminal[\s\S]*--yes[\s\S]*--react[\s\S]*--convex[\s\S]*--core-only[\s\S]*--skill[\s\S]*--no-skill[\s\S]*--pm/
        );
        expect(ranCommands).toEqual([]);
    });

    it("runs unattended in non-TTY mode with --yes, using detected defaults", async () => {
        writePackageJson({
            name: "my-app",
            dependencies: { react: "^19.0.0" },
        });
        await main(["--yes", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });
        expect(ranCommands).toHaveLength(2);
        expect(ranCommands[0].plannedCommand).toEqual({
            command: "npm",
            args: [
                "install",
                "@retreejs/core@latest",
                "@retreejs/react@latest",
            ],
        });
        expect(ranCommands[0].cwd).toBe(projectDir);
        expect(ranCommands[1].plannedCommand).toEqual({
            command: "npx",
            args: ["skills", "add", "ryanbliss/retree", "--skill", "retree"],
        });
    });

    it("runs unattended in non-TTY mode with --core-only --no-skill", async () => {
        writePackageJson({
            name: "my-app",
            dependencies: { react: "^19.0.0" },
        });
        await main(["--core-only", "--no-skill", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });
        expect(ranCommands).toHaveLength(1);
        expect(ranCommands[0].plannedCommand).toEqual({
            command: "npm",
            args: ["install", "@retreejs/core@latest"],
        });
    });

    it("uses the --pm override for the install and skill commands", async () => {
        writePackageJson({ name: "my-app" });
        await main(["--core-only", "--skill", "--pm", "pnpm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });
        expect(ranCommands).toHaveLength(2);
        expect(ranCommands[0].plannedCommand.command).toBe("pnpm");
        expect(ranCommands[0].plannedCommand.args[0]).toBe("add");
        expect(ranCommands[1].plannedCommand).toEqual({
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

    it("distinguishes a skill-step failure after the packages installed", async () => {
        writePackageJson({ name: "my-app" });
        const runCommand = async (
            plannedCommand: PlannedCommand,
            cwd: string
        ) => {
            ranCommands.push({ plannedCommand, cwd });
            if (plannedCommand.args.includes("skills")) {
                throw new Error("npx skills: exited with status 1.");
            }
        };
        await expect(
            main(["--core-only", "--skill", "--pm", "npm"], {
                cwd: projectDir,
                isTTY: false,
                promptAdapter: createUnusablePromptAdapter(),
                runCommand,
            })
        ).rejects.toThrow(
            /packages were installed successfully[\s\S]*skill failed[\s\S]*Retry just the skill step with:[\s\S]*npx skills add ryanbliss\/retree/
        );
        expect(ranCommands).toHaveLength(2);
    });

    it("keeps the interactive flow in TTY mode and applies the tsconfig fix on confirmation", async () => {
        writePackageJson({ name: "my-app" });
        const tsconfigPath = join(projectDir, "tsconfig.json");
        writeFileSync(
            tsconfigPath,
            '{\n  "compilerOptions": {\n    "experimentalDecorators": true\n  }\n}'
        );
        const promptAdapter: PromptAdapter = {
            async chooseFeatures(defaults) {
                expect(defaults).toEqual({
                    react: false,
                    convex: false,
                    eslint: false,
                    eslintAvailable: false,
                });
                return {
                    react: false,
                    convex: false,
                    eslint: false,
                    skill: false,
                };
            },
            async confirmPlan() {
                return true;
            },
            async confirmTsconfigDecoratorFix() {
                return true;
            },
        };
        await main(["--pm", "npm"], {
            cwd: projectDir,
            isTTY: true,
            promptAdapter,
            runCommand: createRecordingRunner(ranCommands),
        });
        expect(ranCommands).toHaveLength(1);
        expect(readFileSync(tsconfigPath, "utf8")).toContain(
            '"experimentalDecorators": false'
        );
    });

    it("prints the decorator note without editing in non-TTY runs", async () => {
        writePackageJson({ name: "my-app" });
        const tsconfigPath = join(projectDir, "tsconfig.json");
        writeFileSync(
            tsconfigPath,
            '{ "compilerOptions": { "experimentalDecorators": true } }'
        );
        await main(["--core-only", "--no-skill", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });
        const loggedNote = vi
            .mocked(console.log)
            .mock.calls.map((call) => String(call[0]))
            .find((message) =>
                message.includes("Retree works without decorators")
            );
        expect(loggedNote).toBeDefined();
        expect(loggedNote).toContain(
            "https://www.retree.dev/docs/setup-and-decorators"
        );
        expect(readFileSync(tsconfigPath, "utf8")).toContain(
            '"experimentalDecorators": true'
        );
    });

    it("makes no changes when the plan is declined in TTY mode", async () => {
        writePackageJson({ name: "my-app" });
        const promptAdapter: PromptAdapter = {
            async chooseFeatures() {
                return {
                    react: false,
                    convex: false,
                    eslint: false,
                    skill: false,
                };
            },
            async confirmPlan() {
                return false;
            },
            async confirmTsconfigDecoratorFix() {
                throw new Error(
                    "confirmTsconfigDecoratorFix must not be called after declining."
                );
            },
        };
        await main([], {
            cwd: projectDir,
            isTTY: true,
            promptAdapter,
            runCommand: createRecordingRunner(ranCommands),
        });
        expect(ranCommands).toEqual([]);
    });

    it("selects and configures the ESLint rule by default when all prerequisites are detected", async () => {
        writePackageJson({
            name: "typed-react-app",
            dependencies: { react: "^19.0.0" },
            devDependencies: { eslint: "^9.0.0", typescript: "^6.0.0" },
        });
        const configPath = join(projectDir, "eslint.config.mjs");
        writeFileSync(
            configPath,
            [
                'import { defineConfig } from "eslint/config";',
                "export default defineConfig([",
                "    baseConfig,",
                "]);",
                "",
            ].join("\n")
        );

        await main(["--yes", "--no-skill", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });

        expect(ranCommands).toHaveLength(2);
        expect(ranCommands[1].plannedCommand).toEqual({
            command: "npm",
            args: [
                "install",
                "--save-dev",
                "@retreejs/react-eslint-plugin@latest",
            ],
        });
        const config = readFileSync(configPath, "utf8");
        expect(config).toContain(
            'import retree from "@retreejs/react-eslint-plugin/typescript";'
        );
        expect(config).toContain("    ...retree,\n]);");
    });

    it("lets --no-eslint disable the detected default", async () => {
        writePackageJson({
            name: "typed-react-app",
            dependencies: { react: "^19.0.0" },
            devDependencies: { eslint: "^9.0.0", typescript: "^6.0.0" },
        });
        const configPath = join(projectDir, "eslint.config.mjs");
        writeFileSync(configPath, "export default [\n];\n");

        await main(["--yes", "--no-eslint", "--no-skill", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });

        expect(ranCommands).toHaveLength(1);
        expect(readFileSync(configPath, "utf8")).toBe("export default [\n];\n");
    });

    it("lets the interactive checklist disable its detected ESLint default", async () => {
        writePackageJson({
            name: "typed-react-app",
            dependencies: { react: "^19.0.0" },
            devDependencies: { eslint: "^9.0.0", typescript: "^6.0.0" },
        });
        const promptAdapter: PromptAdapter = {
            async chooseFeatures(defaults) {
                expect(defaults).toEqual({
                    react: true,
                    convex: false,
                    eslint: true,
                    eslintAvailable: true,
                });
                return {
                    react: true,
                    convex: false,
                    eslint: false,
                    skill: false,
                };
            },
            async confirmPlan() {
                return true;
            },
            async confirmTsconfigDecoratorFix() {
                return false;
            },
        };

        await main(["--pm", "npm"], {
            cwd: projectDir,
            isTTY: true,
            promptAdapter,
            runCommand: createRecordingRunner(ranCommands),
        });

        expect(ranCommands).toHaveLength(1);
        expect(ranCommands[0].plannedCommand.args).not.toContain(
            "@retreejs/react-eslint-plugin@latest"
        );
    });

    it("warns and skips an explicitly selected ESLint rule when prerequisites are missing", async () => {
        writePackageJson({ name: "plain-app" });

        await main(["--eslint", "--no-skill", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });

        expect(ranCommands).toHaveLength(1);
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
            expect.stringContaining("missing React, ESLint, TypeScript")
        );
    });

    it("warns without throwing when eslint.config.mjs cannot be edited safely", async () => {
        writePackageJson({
            name: "typed-react-app",
            dependencies: { react: "^19.0.0" },
            devDependencies: { eslint: "^9.0.0", typescript: "^6.0.0" },
        });
        const configPath = join(projectDir, "eslint.config.mjs");
        writeFileSync(configPath, "export default makeConfig();\n");

        await main(["--yes", "--no-skill", "--pm", "npm"], {
            cwd: projectDir,
            isTTY: false,
            promptAdapter: createUnusablePromptAdapter(),
            runCommand: createRecordingRunner(ranCommands),
        });

        expect(readFileSync(configPath, "utf8")).toBe(
            "export default makeConfig();\n"
        );
        expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
            expect.stringContaining("left")
        );
    });
});
