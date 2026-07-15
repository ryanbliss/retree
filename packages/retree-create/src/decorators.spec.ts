import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    applyTsconfigDecoratorFix,
    collectDecoratorFindings,
    inspectDecoratorSetup,
    parseJsonWithComments,
    parseMajorVersion,
    renderDecoratorNote,
} from "./decorators.js";

describe("parseJsonWithComments", () => {
    it("parses plain JSON", () => {
        expect(parseJsonWithComments('{"a": 1}', "/tmp/tsconfig.json")).toEqual(
            { a: 1 }
        );
    });

    it("strips line comments", () => {
        const text = '{\n  // comment\n  "a": 1 // trailing\n}';
        expect(parseJsonWithComments(text, "/tmp/tsconfig.json")).toEqual({
            a: 1,
        });
    });

    it("strips block comments", () => {
        const text = '{ /* block\n comment */ "a": /* inline */ 1 }';
        expect(parseJsonWithComments(text, "/tmp/tsconfig.json")).toEqual({
            a: 1,
        });
    });

    it("strips trailing commas in objects and arrays", () => {
        const text = '{\n  "a": [1, 2,],\n  "b": true,\n}';
        expect(parseJsonWithComments(text, "/tmp/tsconfig.json")).toEqual({
            a: [1, 2],
            b: true,
        });
    });

    it("drops a trailing comma separated from the brace by a comment", () => {
        const text = '{"a": 1, /* last */ }';
        expect(parseJsonWithComments(text, "/tmp/tsconfig.json")).toEqual({
            a: 1,
        });
    });

    it("preserves comment-like and comma content inside strings", () => {
        const text =
            '{"url": "https://x", "csv": "a,b,", "quote": "say \\"//\\""}';
        expect(parseJsonWithComments(text, "/tmp/tsconfig.json")).toEqual({
            url: "https://x",
            csv: "a,b,",
            quote: 'say "//"',
        });
    });

    it("throws a pinpoint error for unparseable text", () => {
        expect(() =>
            parseJsonWithComments("{ not json", "/tmp/tsconfig.json")
        ).toThrow(/Could not parse \/tmp\/tsconfig\.json as JSON/);
    });
});

describe("parseMajorVersion", () => {
    it("reads caret and tilde ranges", () => {
        expect(parseMajorVersion("^4.9.5")).toBe(4);
        expect(parseMajorVersion("~5.3.0")).toBe(5);
    });

    it("reads comparison ranges", () => {
        expect(parseMajorVersion(">=4.5 <5.0")).toBe(4);
    });

    it("returns undefined for tags", () => {
        expect(parseMajorVersion("latest")).toBeUndefined();
        expect(parseMajorVersion("*")).toBeUndefined();
    });
});

describe("collectDecoratorFindings", () => {
    const cleanInput = {
        compilerOptions: { strict: true },
        typescriptVersionRange: "^5.4.0",
        babelConfigFileName: undefined,
        babelConfigHasDecoratorsPlugin: false,
    };

    it("finds nothing for a clean setup", () => {
        expect(collectDecoratorFindings(cleanInput)).toEqual([]);
    });

    it("finds nothing when there is no tsconfig or typescript at all", () => {
        expect(
            collectDecoratorFindings({
                compilerOptions: undefined,
                typescriptVersionRange: undefined,
                babelConfigFileName: undefined,
                babelConfigHasDecoratorsPlugin: false,
            })
        ).toEqual([]);
    });

    it("flags experimentalDecorators: true", () => {
        const findings = collectDecoratorFindings({
            ...cleanInput,
            compilerOptions: { experimentalDecorators: true },
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].kind).toBe("experimental-decorators");
    });

    it("does not flag experimentalDecorators: false", () => {
        expect(
            collectDecoratorFindings({
                ...cleanInput,
                compilerOptions: { experimentalDecorators: false },
            })
        ).toEqual([]);
    });

    it("flags TypeScript below 5", () => {
        const findings = collectDecoratorFindings({
            ...cleanInput,
            typescriptVersionRange: "^4.9.5",
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].kind).toBe("typescript-below-5");
        expect(findings[0].message).toContain("^4.9.5");
    });

    it("flags a Babel config without the decorators plugin", () => {
        const findings = collectDecoratorFindings({
            ...cleanInput,
            babelConfigFileName: "babel.config.js",
            babelConfigHasDecoratorsPlugin: false,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].kind).toBe("babel-missing-plugin");
        expect(findings[0].message).toContain("babel.config.js");
        expect(findings[0].message).toContain('{ version: "2023-11" }');
    });

    it("does not flag a Babel config that has the plugin", () => {
        expect(
            collectDecoratorFindings({
                ...cleanInput,
                babelConfigFileName: ".babelrc",
                babelConfigHasDecoratorsPlugin: true,
            })
        ).toEqual([]);
    });
});

describe("inspectDecoratorSetup", () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(join(tmpdir(), "retree-create-decorators-"));
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    it("reports no findings for an empty project", () => {
        const report = inspectDecoratorSetup(projectDir);
        expect(report.findings).toEqual([]);
        expect(report.tsconfigPath).toBeUndefined();
        expect(report.canOfferTsconfigFix).toBe(false);
    });

    it("flags experimentalDecorators in a commented tsconfig and offers the fix", () => {
        writeFileSync(
            join(projectDir, "tsconfig.json"),
            '{\n  // legacy decorators\n  "compilerOptions": {\n    "experimentalDecorators": true,\n  },\n}'
        );
        const report = inspectDecoratorSetup(projectDir);
        expect(report.findings.map((finding) => finding.kind)).toEqual([
            "experimental-decorators",
        ]);
        expect(report.tsconfigPath).toBe(join(projectDir, "tsconfig.json"));
        expect(report.canOfferTsconfigFix).toBe(true);
    });

    it("resolves a local extends one level and does not offer a fix for inherited options", () => {
        writeFileSync(
            join(projectDir, "tsconfig.base.json"),
            '{ "compilerOptions": { "experimentalDecorators": true } }'
        );
        writeFileSync(
            join(projectDir, "tsconfig.json"),
            '{ "extends": "./tsconfig.base.json", "compilerOptions": { "strict": true } }'
        );
        const report = inspectDecoratorSetup(projectDir);
        expect(report.findings.map((finding) => finding.kind)).toEqual([
            "experimental-decorators",
        ]);
        expect(report.canOfferTsconfigFix).toBe(false);
    });

    it("lets a child tsconfig override an extended experimentalDecorators", () => {
        writeFileSync(
            join(projectDir, "tsconfig.base.json"),
            '{ "compilerOptions": { "experimentalDecorators": true } }'
        );
        writeFileSync(
            join(projectDir, "tsconfig.json"),
            '{ "extends": "./tsconfig.base.json", "compilerOptions": { "experimentalDecorators": false } }'
        );
        expect(inspectDecoratorSetup(projectDir).findings).toEqual([]);
    });

    it("flags TypeScript below 5 from devDependencies", () => {
        writeFileSync(
            join(projectDir, "package.json"),
            JSON.stringify({ devDependencies: { typescript: "~4.8.0" } })
        );
        const report = inspectDecoratorSetup(projectDir);
        expect(report.findings.map((finding) => finding.kind)).toEqual([
            "typescript-below-5",
        ]);
    });

    it("flags a babel config missing the decorators plugin", () => {
        writeFileSync(
            join(projectDir, "babel.config.js"),
            'module.exports = { presets: ["@babel/preset-env"] };'
        );
        const report = inspectDecoratorSetup(projectDir);
        expect(report.findings.map((finding) => finding.kind)).toEqual([
            "babel-missing-plugin",
        ]);
    });

    it("does not flag a babel config that includes the decorators plugin", () => {
        writeFileSync(
            join(projectDir, ".babelrc"),
            JSON.stringify({
                plugins: [
                    [
                        "@babel/plugin-proposal-decorators",
                        { version: "2023-11" },
                    ],
                ],
            })
        );
        expect(inspectDecoratorSetup(projectDir).findings).toEqual([]);
    });

    it("swallows an unparseable tsconfig instead of throwing", () => {
        writeFileSync(join(projectDir, "tsconfig.json"), "{ not json");
        const report = inspectDecoratorSetup(projectDir);
        expect(report.findings).toEqual([]);
        expect(report.canOfferTsconfigFix).toBe(false);
    });
});

describe("renderDecoratorNote", () => {
    it("frames the findings as optional setup and links the docs", () => {
        const note = renderDecoratorNote([
            { kind: "experimental-decorators", message: "the finding" },
        ]);
        expect(note).toContain("Retree works without decorators");
        expect(note).toContain("  - the finding");
        expect(note).toContain(
            "https://www.retree.dev/docs/setup-and-decorators"
        );
    });
});

describe("applyTsconfigDecoratorFix", () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(join(tmpdir(), "retree-create-fix-"));
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    it("flips experimentalDecorators to false while preserving comments", () => {
        const tsconfigPath = join(projectDir, "tsconfig.json");
        writeFileSync(
            tsconfigPath,
            '{\n  // keep me\n  "compilerOptions": {\n    "experimentalDecorators" : true\n  }\n}'
        );
        applyTsconfigDecoratorFix(tsconfigPath);
        const updated = readFileSync(tsconfigPath, "utf8");
        expect(updated).toContain("// keep me");
        expect(updated).toContain('"experimentalDecorators" : false');
        expect(updated).not.toContain("true");
    });

    it("throws when the file does not exist", () => {
        const missingPath = join(projectDir, "tsconfig.json");
        expect(() => applyTsconfigDecoratorFix(missingPath)).toThrow(
            `Cannot update ${missingPath}: the file does not exist.`
        );
    });

    it("throws when no experimentalDecorators: true entry exists", () => {
        const tsconfigPath = join(projectDir, "tsconfig.json");
        writeFileSync(tsconfigPath, '{ "compilerOptions": {} }');
        expect(() => applyTsconfigDecoratorFix(tsconfigPath)).toThrow(
            /no "experimentalDecorators": true entry was found/
        );
    });
});
