import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addRetreeEslintPreset, tryConfigureRetreeEslint } from "./eslint.js";

describe("addRetreeEslintPreset", () => {
    it("adds the import and preset to a defineConfig export", () => {
        const source = [
            'import { defineConfig } from "eslint/config";',
            'import nextVitals from "eslint-config-next/core-web-vitals";',
            "",
            "export default defineConfig([",
            "    ...nextVitals,",
            "]);",
            "",
        ].join("\n");

        expect(addRetreeEslintPreset(source)).toEqual({
            status: "updated",
            source: [
                'import retree from "@retreejs/react-eslint-plugin/typescript";',
                'import { defineConfig } from "eslint/config";',
                'import nextVitals from "eslint-config-next/core-web-vitals";',
                "",
                "export default defineConfig([",
                "    ...nextVitals,",
                "    ...retree,",
                "]);",
                "",
            ].join("\n"),
        });
    });

    it("supports a named config variable and avoids an occupied import name", () => {
        const source = [
            "const retree = {};",
            "const eslintConfig = defineConfig([",
            "    baseConfig,",
            "]);",
            "export default eslintConfig;",
            "",
        ].join("\n");
        const result = addRetreeEslintPreset(source);
        expect(result.status).toBe("updated");
        if (result.status !== "updated") {
            throw new Error(
                "Expected the named config variable to be updated."
            );
        }
        expect(result.source).toContain(
            'import retreeEslint from "@retreejs/react-eslint-plugin/typescript";'
        );
        expect(result.source).toContain("    ...retreeEslint,\n]);");
    });

    it("is idempotent when the preset is already spread", () => {
        const source = [
            'import retree from "@retreejs/react-eslint-plugin/typescript";',
            "export default [",
            "    ...retree,",
            "];",
        ].join("\n");
        expect(addRetreeEslintPreset(source)).toEqual({
            status: "already-configured",
        });
    });

    it("adds a missing trailing comma before the preset", () => {
        const source = "export default [\n    baseConfig\n];\n";
        const result = addRetreeEslintPreset(source);
        expect(result.status).toBe("updated");
        if (result.status !== "updated") {
            throw new Error("Expected the config array to be updated.");
        }
        expect(result.source).toContain(
            "export default [\n    baseConfig,\n    ...retree,\n];"
        );
    });

    it("refuses a trailing comment without guessing where its comma belongs", () => {
        const source = "export default [\n    baseConfig // keep this\n];\n";
        expect(addRetreeEslintPreset(source)).toEqual({
            status: "unsupported",
            reason: "a safe insertion point in the exported config array could not be identified",
        });
    });

    it("refuses custom executable exports", () => {
        const source = "export default makeConfig();\n";
        expect(addRetreeEslintPreset(source)).toEqual({
            status: "unsupported",
            reason: "the default export is not a recognizable flat-config array",
        });
    });
});

describe("tryConfigureRetreeEslint", () => {
    const directories: string[] = [];

    afterEach(() => {
        for (const directory of directories.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it("updates eslint.config.mjs on disk", () => {
        const directory = mkdtempSync(join(tmpdir(), "retree-eslint-config-"));
        directories.push(directory);
        const configPath = join(directory, "eslint.config.mjs");
        writeFileSync(configPath, "export default [\n];\n");

        expect(tryConfigureRetreeEslint(directory)).toEqual({
            status: "updated",
            configPath,
        });
        expect(readFileSync(configPath, "utf8")).toBe(
            [
                'import retree from "@retreejs/react-eslint-plugin/typescript";',
                "export default [",
                "    ...retree,",
                "];",
                "",
            ].join("\n")
        );
    });

    it("warns instead of throwing when eslint.config.mjs is absent", () => {
        const directory = mkdtempSync(join(tmpdir(), "retree-eslint-config-"));
        directories.push(directory);
        const result = tryConfigureRetreeEslint(directory);
        expect(result.status).toBe("warning");
        if (result.status !== "warning") {
            throw new Error("Expected a warning for the missing config.");
        }
        expect(result.message).toContain("eslint.config.mjs does not exist");
        expect(result.message).toContain(
            "@retreejs/react-eslint-plugin/typescript"
        );
    });
});
