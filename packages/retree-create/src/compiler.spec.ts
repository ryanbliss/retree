import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    addRetreeCompilerPlugin,
    tryConfigureRetreeCompiler,
} from "./compiler.js";

describe("addRetreeCompilerPlugin", () => {
    it("inserts the plugin ahead of the decorators plugin, keeping indentation", () => {
        const result = addRetreeCompilerPlugin(
            '{\n\t"plugins": [\n\t\t"other",\n\t\t["@babel/plugin-proposal-decorators", { "version": "2023-11" }]\n\t]\n}\n'
        );
        expect(result).toEqual({
            status: "updated",
            source: '{\n\t"plugins": [\n\t\t"other",\n\t\t"@retreejs/babel-plugin-compiler",\n\t\t[\n\t\t\t"@babel/plugin-proposal-decorators",\n\t\t\t{\n\t\t\t\t"version": "2023-11"\n\t\t\t}\n\t\t]\n\t]\n}\n',
        });
    });

    it("creates the plugins array when the config has none", () => {
        const result = addRetreeCompilerPlugin('{ "presets": ["next/babel"] }');
        expect(result.status).toBe("updated");
        if (result.status !== "updated") return;
        expect(JSON.parse(result.source)).toEqual({
            presets: ["next/babel"],
            plugins: ["@retreejs/babel-plugin-compiler"],
        });
    });

    it("reports an already configured plugin", () => {
        expect(
            addRetreeCompilerPlugin(
                '{ "plugins": [["@retreejs/babel-plugin-compiler", {}]] }'
            )
        ).toEqual({ status: "already-configured" });
    });

    it("rejects configs that are not JSON objects", () => {
        expect(addRetreeCompilerPlugin("module.exports = {}").status).toBe(
            "unsupported"
        );
        expect(addRetreeCompilerPlugin("[]").status).toBe("unsupported");
    });
});

describe("tryConfigureRetreeCompiler", () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(join(tmpdir(), "retree-create-compiler-"));
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    it("warns when no Babel config exists", () => {
        const result = tryConfigureRetreeCompiler(projectDir);
        expect(result.status).toBe("warning");
    });

    it("leaves JavaScript configs alone with the manual step", () => {
        writeFileSync(
            join(projectDir, "babel.config.js"),
            "module.exports = {};"
        );
        const result = tryConfigureRetreeCompiler(projectDir);
        expect(result).toEqual({
            status: "warning",
            message: expect.stringContaining("JavaScript Babel config"),
        });
    });

    it("updates a JSON config in place", () => {
        writeFileSync(
            join(projectDir, "babel.config.json"),
            '{ "plugins": [] }'
        );
        expect(tryConfigureRetreeCompiler(projectDir)).toEqual({
            status: "updated",
            configPath: join(projectDir, "babel.config.json"),
        });
        expect(tryConfigureRetreeCompiler(projectDir)).toEqual({
            status: "already-configured",
            configPath: join(projectDir, "babel.config.json"),
        });
    });
});
