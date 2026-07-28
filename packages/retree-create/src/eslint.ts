import {
    existsSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const CONFIG_FILE_NAME = "eslint.config.mjs";
const PRESET_SPECIFIER = "@retreejs/react-eslint-plugin/typescript";

export const RETREE_ESLINT_MANUAL_SETUP = [
    `import retree from "${PRESET_SPECIFIER}";`,
    "Add `...retree` at the end of the array exported by eslint.config.mjs.",
].join(" ");

export type EslintConfigUpdateResult =
    | { status: "updated"; configPath: string }
    | { status: "already-configured"; configPath: string }
    | { status: "warning"; message: string };

type EslintConfigTransformResult =
    | { status: "updated"; source: string }
    | { status: "already-configured" }
    | { status: "unsupported"; reason: string };

/**
 * Adds the typed Retree preset to a recognizable ESLint flat config.
 *
 * This intentionally supports a narrow set of shapes. Configuration files
 * are executable JavaScript, so guessing around custom expressions is less
 * safe than leaving the file alone and showing the manual two-line setup.
 */
export function addRetreeEslintPreset(
    source: string
): EslintConfigTransformResult {
    const arrayStart = findExportedConfigArrayStart(source);
    if (arrayStart === undefined) {
        return {
            status: "unsupported",
            reason: "the default export is not a recognizable flat-config array",
        };
    }

    const arrayEnd = findMatchingSquareBracket(source, arrayStart);
    if (arrayEnd === undefined) {
        return {
            status: "unsupported",
            reason: "the exported config array could not be parsed safely",
        };
    }

    const existingImport = findExistingPresetImport(source);
    if (source.includes(PRESET_SPECIFIER) && existingImport === undefined) {
        return {
            status: "unsupported",
            reason: "the Retree preset is already imported in a custom form",
        };
    }
    if (
        source.includes("@retreejs/react-eslint-plugin") &&
        !source.includes(PRESET_SPECIFIER)
    ) {
        return {
            status: "unsupported",
            reason: "the Retree ESLint plugin is already configured manually",
        };
    }

    const importedName = existingImport ?? chooseImportName(source);
    const arrayBody = source.slice(arrayStart + 1, arrayEnd);
    if (containsSpread(arrayBody, importedName)) {
        return { status: "already-configured" };
    }

    const sourceWithPreset = insertPresetSpread(
        source,
        arrayStart,
        arrayEnd,
        importedName
    );
    if (sourceWithPreset === undefined) {
        return {
            status: "unsupported",
            reason: "a safe insertion point in the exported config array could not be identified",
        };
    }

    if (existingImport !== undefined) {
        return { status: "updated", source: sourceWithPreset };
    }

    const newline = detectNewline(source);
    const importStatement = `import ${importedName} from "${PRESET_SPECIFIER}";${newline}`;
    let importOffset = 0;
    if (source.startsWith("#!")) {
        const shebangEnd = source.indexOf(newline);
        if (shebangEnd === -1) {
            return {
                status: "unsupported",
                reason: "the config has an unterminated shebang line",
            };
        }
        importOffset = shebangEnd + newline.length;
    }
    return {
        status: "updated",
        source:
            sourceWithPreset.slice(0, importOffset) +
            importStatement +
            sourceWithPreset.slice(importOffset),
    };
}

/** Best-effort disk update. No read, parse, or write failure escapes. */
export function tryConfigureRetreeEslint(
    cwd: string
): EslintConfigUpdateResult {
    const configPath = resolve(cwd, CONFIG_FILE_NAME);
    if (!existsSync(configPath)) {
        return {
            status: "warning",
            message: `Installed @retreejs/react-eslint-plugin, but ${configPath} does not exist. ${RETREE_ESLINT_MANUAL_SETUP}`,
        };
    }

    let source: string;
    try {
        source = readFileSync(configPath, "utf8");
    } catch (error) {
        return {
            status: "warning",
            message: `Installed @retreejs/react-eslint-plugin, but could not read ${configPath}: ${formatErrorMessage(
                error
            )} ${RETREE_ESLINT_MANUAL_SETUP}`,
        };
    }

    let transformed: ReturnType<typeof addRetreeEslintPreset>;
    try {
        transformed = addRetreeEslintPreset(source);
    } catch (error) {
        return {
            status: "warning",
            message: `Installed @retreejs/react-eslint-plugin, but could not safely inspect ${configPath}: ${formatErrorMessage(
                error
            )} ${RETREE_ESLINT_MANUAL_SETUP}`,
        };
    }
    if (transformed.status === "already-configured") {
        return { status: "already-configured", configPath };
    }
    if (transformed.status === "unsupported") {
        return {
            status: "warning",
            message: `Installed @retreejs/react-eslint-plugin, but left ${configPath} unchanged because ${transformed.reason}. ${RETREE_ESLINT_MANUAL_SETUP}`,
        };
    }

    const temporaryPath = `${configPath}.retree-${process.pid}.tmp`;
    try {
        const mode = statSync(configPath).mode;
        writeFileSync(temporaryPath, transformed.source, { mode });
        renameSync(temporaryPath, configPath);
    } catch (error) {
        try {
            rmSync(temporaryPath, { force: true });
        } catch {
            // The original config is still intact; cleanup is best effort too.
        }
        return {
            status: "warning",
            message: `Installed @retreejs/react-eslint-plugin, but could not update ${configPath}: ${formatErrorMessage(
                error
            )} ${RETREE_ESLINT_MANUAL_SETUP}`,
        };
    }

    return { status: "updated", configPath };
}

function findExistingPresetImport(source: string): string | undefined {
    const match = new RegExp(
        `^\\s*import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["']${escapeRegExp(
            PRESET_SPECIFIER
        )}["']\\s*;?`,
        "m"
    ).exec(source);
    return match?.[1];
}

function chooseImportName(source: string): string {
    const candidates = ["retree", "retreeEslint", "retreeConfig"];
    for (const candidate of candidates) {
        const identifierPattern = new RegExp(`\\b${candidate}\\b`);
        if (!identifierPattern.test(source)) {
            return candidate;
        }
    }
    return "retreeTypescriptConfig";
}

function containsSpread(arrayBody: string, identifier: string): boolean {
    return new RegExp(`\\.\\.\\.\\s*${escapeRegExp(identifier)}\\b`).test(
        arrayBody
    );
}

function findExportedConfigArrayStart(source: string): number | undefined {
    const candidates = new Set<number>();
    collectArrayStarts(
        source,
        /export\s+default\s+defineConfig\s*\(\s*\[/g,
        candidates
    );
    collectArrayStarts(source, /export\s+default\s*\[/g, candidates);

    const variablePattern =
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:defineConfig\s*\(\s*)?\[/g;
    for (const match of source.matchAll(variablePattern)) {
        const variableName = match[1];
        if (variableName === undefined || match.index === undefined) {
            continue;
        }
        const exportPattern = new RegExp(
            `export\\s+default\\s+${escapeRegExp(variableName)}\\s*;?`
        );
        if (!exportPattern.test(source)) {
            continue;
        }
        candidates.add(match.index + match[0].lastIndexOf("["));
    }

    if (candidates.size !== 1) {
        return undefined;
    }
    return candidates.values().next().value;
}

function collectArrayStarts(
    source: string,
    pattern: RegExp,
    candidates: Set<number>
): void {
    for (const match of source.matchAll(pattern)) {
        if (match.index === undefined) {
            continue;
        }
        candidates.add(match.index + match[0].lastIndexOf("["));
    }
}

function findMatchingSquareBracket(
    source: string,
    openingIndex: number
): number | undefined {
    let depth = 0;
    let quote: "'" | '"' | "`" | undefined;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openingIndex; index < source.length; index++) {
        const character = source[index];
        const nextCharacter = source[index + 1];
        if (lineComment) {
            if (character === "\n") {
                lineComment = false;
            }
            continue;
        }
        if (blockComment) {
            if (character === "*" && nextCharacter === "/") {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote !== undefined) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === "\\") {
                escaped = true;
                continue;
            }
            if (character === quote) {
                quote = undefined;
            }
            continue;
        }
        if (character === "/" && nextCharacter === "/") {
            lineComment = true;
            index += 1;
            continue;
        }
        if (character === "/" && nextCharacter === "*") {
            blockComment = true;
            index += 1;
            continue;
        }
        if (character === "/") {
            return undefined;
        }
        if (character === "'" || character === '"' || character === "`") {
            quote = character;
            continue;
        }
        if (character === "[") {
            depth += 1;
            continue;
        }
        if (character !== "]") {
            continue;
        }
        depth -= 1;
        if (depth === 0) {
            return index;
        }
    }
    return undefined;
}

function insertPresetSpread(
    source: string,
    arrayStart: number,
    arrayEnd: number,
    importedName: string
): string | undefined {
    const newline = detectNewline(source);
    const arrayBody = source.slice(arrayStart + 1, arrayEnd);
    if (arrayBody.trim().length === 0) {
        const lineStart = source.lastIndexOf("\n", arrayEnd - 1) + 1;
        const closingIndent = source.slice(lineStart, arrayEnd);
        if (!/^\s*$/.test(closingIndent)) {
            return (
                source.slice(0, arrayStart + 1) +
                `${newline}    ...${importedName},${newline}` +
                source.slice(arrayEnd)
            );
        }
        const itemIndent = `${closingIndent}    `;
        return (
            source.slice(0, lineStart) +
            `${itemIndent}...${importedName},${newline}${closingIndent}` +
            source.slice(arrayEnd)
        );
    }

    const closingLineStart = source.lastIndexOf("\n", arrayEnd - 1) + 1;
    const closingIndent = source.slice(closingLineStart, arrayEnd);
    if (!/^\s*$/.test(closingIndent)) {
        return undefined;
    }
    const itemIndent = inferItemIndent(arrayBody, closingIndent);
    let prefix = source.slice(0, closingLineStart);
    const trimmedBody = arrayBody.trimEnd();
    if (!trimmedBody.endsWith(",")) {
        const finalLineStart = trimmedBody.lastIndexOf("\n") + 1;
        const finalLine = trimmedBody.slice(finalLineStart);
        if (
            finalLine.includes("//") ||
            finalLine.includes("/*") ||
            finalLine.includes("*/")
        ) {
            return undefined;
        }
        const finalCharacterIndex = arrayStart + 1 + trimmedBody.length - 1;
        prefix =
            source.slice(0, finalCharacterIndex + 1) +
            "," +
            source.slice(finalCharacterIndex + 1, closingLineStart);
    }
    return (
        prefix +
        `${itemIndent}...${importedName},${newline}${closingIndent}` +
        source.slice(arrayEnd)
    );
}

function inferItemIndent(arrayBody: string, closingIndent: string): string {
    for (const line of arrayBody.split(/\r?\n/)) {
        if (line.trim().length === 0) {
            continue;
        }
        const indentation = /^\s*/.exec(line)?.[0];
        if (indentation !== undefined) {
            return indentation;
        }
    }
    return `${closingIndent}    `;
}

function detectNewline(source: string): "\r\n" | "\n" {
    return source.includes("\r\n") ? "\r\n" : "\n";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
