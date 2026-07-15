import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DecoratorFindingKind =
    | "experimental-decorators"
    | "typescript-below-5"
    | "babel-missing-plugin";

export interface DecoratorFinding {
    kind: DecoratorFindingKind;
    message: string;
}

export interface DecoratorSetupReport {
    findings: DecoratorFinding[];
    /**
     * Path to the target project's tsconfig.json, when one exists.
     */
    tsconfigPath: string | undefined;
    /**
     * True when `"experimentalDecorators": true` appears literally in the
     * local tsconfig text, so a targeted text edit can flip it to `false`
     * without disturbing comments or formatting.
     */
    canOfferTsconfigFix: boolean;
}

export const DECORATOR_DOCS_URL =
    "https://www.retree.dev/docs/setup-and-decorators";

const EXPERIMENTAL_DECORATORS_TRUE_PATTERN =
    /("experimentalDecorators"\s*:\s*)true/;

const BABEL_CONFIG_FILE_NAMES = [
    ".babelrc",
    ".babelrc.json",
    ".babelrc.js",
    ".babelrc.cjs",
    ".babelrc.mjs",
    "babel.config.json",
    "babel.config.js",
    "babel.config.cjs",
    "babel.config.mjs",
    "babel.config.ts",
];

const BABEL_DECORATORS_PLUGIN = "@babel/plugin-proposal-decorators";

/**
 * Parses JSON that may contain `//` and `/* *\/` comments and trailing
 * commas (the tsconfig.json dialect).
 */
export function parseJsonWithComments(text: string, filePath: string): unknown {
    const sanitized = stripCommentsAndTrailingCommas(text);
    try {
        return JSON.parse(sanitized);
    } catch (error) {
        throw new Error(
            `Could not parse ${filePath} as JSON (after stripping comments and trailing commas): ${formatErrorMessage(
                error
            )}`
        );
    }
}

function stripCommentsAndTrailingCommas(text: string): string {
    let result = "";
    let index = 0;
    let inString = false;
    while (index < text.length) {
        const char = text[index];
        if (inString) {
            result += char;
            if (char === "\\" && index + 1 < text.length) {
                result += text[index + 1];
                index += 2;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            index += 1;
            continue;
        }
        if (char === '"') {
            inString = true;
            result += char;
            index += 1;
            continue;
        }
        if (char === "/" && text[index + 1] === "/") {
            index = skipLineComment(text, index);
            continue;
        }
        if (char === "/" && text[index + 1] === "*") {
            index = skipBlockComment(text, index);
            continue;
        }
        if (char === ",") {
            const nextMeaningful =
                text[findNextMeaningfulIndex(text, index + 1)];
            if (nextMeaningful === "}" || nextMeaningful === "]") {
                // Trailing comma — drop it.
                index += 1;
                continue;
            }
        }
        result += char;
        index += 1;
    }
    return result;
}

function skipLineComment(text: string, startIndex: number): number {
    let index = startIndex;
    while (index < text.length && text[index] !== "\n") {
        index += 1;
    }
    return index;
}

function skipBlockComment(text: string, startIndex: number): number {
    let index = startIndex + 2;
    while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
    ) {
        index += 1;
    }
    return Math.min(index + 2, text.length);
}

function findNextMeaningfulIndex(text: string, startIndex: number): number {
    let index = startIndex;
    while (index < text.length) {
        const char = text[index];
        if (char === " " || char === "\t" || char === "\n" || char === "\r") {
            index += 1;
            continue;
        }
        if (char === "/" && text[index + 1] === "/") {
            index = skipLineComment(text, index);
            continue;
        }
        if (char === "/" && text[index + 1] === "*") {
            index = skipBlockComment(text, index);
            continue;
        }
        break;
    }
    return index;
}

/**
 * Extracts the major version from a semver range like `^4.9.5`, `~5.3.0`,
 * or `>=4.5 <5`. Returns `undefined` for tags like `latest` or `*`.
 */
export function parseMajorVersion(range: string): number | undefined {
    const match = /(\d+)/.exec(range);
    if (match === null) {
        return undefined;
    }
    return Number.parseInt(match[1], 10);
}

export interface DecoratorInspectionInput {
    compilerOptions: Record<string, unknown> | undefined;
    typescriptVersionRange: string | undefined;
    babelConfigFileName: string | undefined;
    babelConfigHasDecoratorsPlugin: boolean;
}

/**
 * Pure detection of decorator-authoring conflicts. Retree does not require
 * decorators; each finding only affects authoring `@memo`/`@select`/
 * `@ignore`/`@link` in the consumer's own classes.
 */
export function collectDecoratorFindings(
    input: DecoratorInspectionInput
): DecoratorFinding[] {
    const findings: DecoratorFinding[] = [];

    if (input.compilerOptions?.experimentalDecorators === true) {
        findings.push({
            kind: "experimental-decorators",
            message:
                'tsconfig.json sets "experimentalDecorators": true (legacy decorators). Remove it or set it to false so TypeScript 5+ standard decorators apply.',
        });
    }

    if (input.typescriptVersionRange !== undefined) {
        const major = parseMajorVersion(input.typescriptVersionRange);
        if (major !== undefined && major < 5) {
            findings.push({
                kind: "typescript-below-5",
                message: `typescript "${input.typescriptVersionRange}" in package.json is older than 5.0. Authoring Retree decorators requires TypeScript 5+ standard decorators.`,
            });
        }
    }

    if (
        input.babelConfigFileName !== undefined &&
        !input.babelConfigHasDecoratorsPlugin
    ) {
        findings.push({
            kind: "babel-missing-plugin",
            message: `${input.babelConfigFileName} does not include ${BABEL_DECORATORS_PLUGIN}. Add it with { version: "2023-11" } to author Retree decorators in a Babel-transformed toolchain.`,
        });
    }

    return findings;
}

/**
 * Best-effort inspection of the target project's tsconfig.json (resolving a
 * local `extends` one level), TypeScript version, and Babel config. Never
 * throws — unparseable inputs simply produce no findings.
 */
export function inspectDecoratorSetup(cwd: string): DecoratorSetupReport {
    const tsconfigPath = resolve(cwd, "tsconfig.json");
    const tsconfigExists = existsSync(tsconfigPath);
    let compilerOptions: Record<string, unknown> | undefined;
    let tsconfigRawText: string | undefined;
    if (tsconfigExists) {
        try {
            tsconfigRawText = readFileSync(tsconfigPath, "utf8");
            compilerOptions = resolveCompilerOptions(
                tsconfigRawText,
                tsconfigPath
            );
        } catch {
            // Best-effort: an unreadable/unparseable tsconfig produces no findings.
        }
    }

    const babelConfig = readBabelConfig(cwd);
    const findings = collectDecoratorFindings({
        compilerOptions,
        typescriptVersionRange: readTypescriptVersionRange(cwd),
        babelConfigFileName: babelConfig?.fileName,
        babelConfigHasDecoratorsPlugin:
            babelConfig?.hasDecoratorsPlugin === true,
    });

    const hasExperimentalDecoratorsFinding = findings.some(
        (finding) => finding.kind === "experimental-decorators"
    );
    const canOfferTsconfigFix =
        hasExperimentalDecoratorsFinding &&
        tsconfigRawText !== undefined &&
        EXPERIMENTAL_DECORATORS_TRUE_PATTERN.test(tsconfigRawText);

    let reportedTsconfigPath: string | undefined;
    if (tsconfigExists) {
        reportedTsconfigPath = tsconfigPath;
    }
    return {
        findings,
        tsconfigPath: reportedTsconfigPath,
        canOfferTsconfigFix,
    };
}

function resolveCompilerOptions(
    tsconfigText: string,
    tsconfigPath: string
): Record<string, unknown> | undefined {
    const parsed = parseJsonWithComments(tsconfigText, tsconfigPath);
    if (!isRecord(parsed)) {
        return undefined;
    }
    let ownOptions: Record<string, unknown> = {};
    if (isRecord(parsed.compilerOptions)) {
        ownOptions = parsed.compilerOptions;
    }
    const inheritedOptions = readExtendedCompilerOptions(parsed, tsconfigPath);
    return { ...inheritedOptions, ...ownOptions };
}

function readExtendedCompilerOptions(
    tsconfig: Record<string, unknown>,
    tsconfigPath: string
): Record<string, unknown> {
    const extendsValue = tsconfig.extends;
    if (typeof extendsValue !== "string") {
        return {};
    }
    const isLocalExtends =
        extendsValue.startsWith("./") || extendsValue.startsWith("../");
    if (!isLocalExtends) {
        // Package-based extends (e.g. "@tsconfig/node20") are not resolved.
        return {};
    }
    const resolvedBase = resolve(dirname(tsconfigPath), extendsValue);
    let basePath = resolvedBase;
    if (!resolvedBase.endsWith(".json")) {
        basePath = `${resolvedBase}.json`;
    }
    if (!existsSync(basePath)) {
        return {};
    }
    try {
        const baseParsed = parseJsonWithComments(
            readFileSync(basePath, "utf8"),
            basePath
        );
        if (isRecord(baseParsed) && isRecord(baseParsed.compilerOptions)) {
            return baseParsed.compilerOptions;
        }
    } catch {
        // Best-effort: an unparseable base config contributes nothing.
    }
    return {};
}

function readTypescriptVersionRange(cwd: string): string | undefined {
    const packageJsonPath = resolve(cwd, "package.json");
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    } catch {
        return undefined;
    }
    if (!isRecord(parsed)) {
        return undefined;
    }
    for (const field of ["devDependencies", "dependencies"]) {
        const dependencies = parsed[field];
        if (!isRecord(dependencies)) {
            continue;
        }
        const range = dependencies.typescript;
        if (typeof range === "string") {
            return range;
        }
    }
    return undefined;
}

function readBabelConfig(
    cwd: string
): { fileName: string; hasDecoratorsPlugin: boolean } | undefined {
    for (const fileName of BABEL_CONFIG_FILE_NAMES) {
        const filePath = resolve(cwd, fileName);
        if (!existsSync(filePath)) {
            continue;
        }
        let hasDecoratorsPlugin = false;
        try {
            hasDecoratorsPlugin = readFileSync(filePath, "utf8").includes(
                BABEL_DECORATORS_PLUGIN
            );
        } catch {
            // Best-effort: an unreadable config is treated as missing the plugin.
        }
        return { fileName, hasDecoratorsPlugin };
    }
    return undefined;
}

/**
 * Renders the optional-feature note printed when conflicts are detected.
 * Framed as optional setup: none of the findings block using Retree.
 */
export function renderDecoratorNote(findings: DecoratorFinding[]): string {
    return [
        "Optional decorator setup (Retree works without decorators):",
        ...findings.map((finding) => `  - ${finding.message}`),
        "  Decorators are only needed to author @memo/@select/@ignore/@link in your own classes.",
        `  Details: ${DECORATOR_DOCS_URL}`,
    ].join("\n");
}

/**
 * Flips `"experimentalDecorators": true` to `false` in place, preserving
 * comments and formatting. Only call after the user explicitly confirmed.
 */
export function applyTsconfigDecoratorFix(tsconfigPath: string): void {
    if (!existsSync(tsconfigPath)) {
        throw new Error(
            `Cannot update ${tsconfigPath}: the file does not exist.`
        );
    }
    const text = readFileSync(tsconfigPath, "utf8");
    if (!EXPERIMENTAL_DECORATORS_TRUE_PATTERN.test(text)) {
        throw new Error(
            `Cannot update ${tsconfigPath}: no "experimentalDecorators": true entry was found in the file text.`
        );
    }
    writeFileSync(
        tsconfigPath,
        text.replace(EXPERIMENTAL_DECORATORS_TRUE_PATTERN, "$1false")
    );
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
