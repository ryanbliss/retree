import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findBabelConfigFileName } from "./decorators.js";

export const COMPILER_PLUGIN = "@retreejs/babel-plugin-compiler";
const DECORATORS_PLUGIN = "@babel/plugin-proposal-decorators";
const JSON_BABEL_CONFIG_FILE_NAMES = [
    ".babelrc",
    ".babelrc.json",
    "babel.config.json",
];

export const RETREE_COMPILER_MANUAL_SETUP = `Add "${COMPILER_PLUGIN}" to the plugins array of your Babel config, before ${DECORATORS_PLUGIN}.`;

export type CompilerConfigUpdateResult =
    | { status: "updated"; configPath: string }
    | { status: "already-configured"; configPath: string }
    | { status: "warning"; message: string };

type CompilerConfigTransformResult =
    | { status: "updated"; source: string }
    | { status: "already-configured" }
    | { status: "unsupported"; reason: string };

/**
 * Adds the compiler plugin to a JSON Babel config, ahead of the decorators
 * plugin so it sees `@memo`/`@ignore`/`@link` before they are lowered.
 */
export function addRetreeCompilerPlugin(
    source: string
): CompilerConfigTransformResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        return { status: "unsupported", reason: "the file is not plain JSON" };
    }
    if (!isRecord(parsed)) {
        return {
            status: "unsupported",
            reason: "the config is not a JSON object",
        };
    }
    const plugins = parsed.plugins ?? [];
    if (!Array.isArray(plugins)) {
        return {
            status: "unsupported",
            reason: '"plugins" is not an array',
        };
    }
    if (plugins.some((plugin) => pluginName(plugin) === COMPILER_PLUGIN)) {
        return { status: "already-configured" };
    }
    const decoratorsIndex = plugins.findIndex(
        (plugin) => pluginName(plugin) === DECORATORS_PLUGIN
    );
    const insertAt = decoratorsIndex === -1 ? 0 : decoratorsIndex;
    const nextPlugins = [
        ...plugins.slice(0, insertAt),
        COMPILER_PLUGIN,
        ...plugins.slice(insertAt),
    ];
    const next = { ...parsed, plugins: nextPlugins };
    const indent = detectIndent(source);
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    let output = JSON.stringify(next, null, indent);
    if (newline !== "\n") {
        output = output.replaceAll("\n", newline);
    }
    if (source.endsWith(newline)) {
        output += newline;
    }
    return { status: "updated", source: output };
}

function pluginName(plugin: unknown): string | undefined {
    if (typeof plugin === "string") {
        return plugin;
    }
    if (Array.isArray(plugin) && typeof plugin[0] === "string") {
        return plugin[0];
    }
    return undefined;
}

function detectIndent(source: string): string | number {
    const match = /^[ \t]+(?=")/m.exec(source);
    if (match === null) {
        return 4;
    }
    return match[0];
}

/**
 * Best-effort edit of the target project's Babel config. JavaScript configs
 * are left alone with a warning that carries the manual step.
 */
export function tryConfigureRetreeCompiler(
    cwd: string
): CompilerConfigUpdateResult {
    const fileName = findBabelConfigFileName(cwd);
    if (fileName === undefined) {
        return {
            status: "warning",
            message: `No Babel config was found in ${cwd}. ${RETREE_COMPILER_MANUAL_SETUP}`,
        };
    }
    const configPath = resolve(cwd, fileName);
    if (!JSON_BABEL_CONFIG_FILE_NAMES.includes(fileName)) {
        return {
            status: "warning",
            message: `${configPath} is a JavaScript Babel config, so it was left unchanged. ${RETREE_COMPILER_MANUAL_SETUP}`,
        };
    }
    if (!existsSync(configPath)) {
        return {
            status: "warning",
            message: `${configPath} disappeared before it could be updated. ${RETREE_COMPILER_MANUAL_SETUP}`,
        };
    }
    const source = readFileSync(configPath, "utf8");
    const result = addRetreeCompilerPlugin(source);
    if (result.status === "unsupported") {
        return {
            status: "warning",
            message: `${configPath} was left unchanged because ${result.reason}. ${RETREE_COMPILER_MANUAL_SETUP}`,
        };
    }
    if (result.status === "already-configured") {
        return { status: "already-configured", configPath };
    }
    writeFileSync(configPath, result.source);
    return { status: "updated", configPath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
