#!/usr/bin/env node

/**
 * Node load smoke test for every publishable package's built output.
 *
 * Each entry is imported by its published specifier in a CHILD node process
 * started from the repo root, so resolution goes through the real package
 * `exports` maps and the built `bin/` output — never the vitest/website
 * source aliases. This is the regression net for the audit's R1 failure
 * ("Cannot find module .../bin/Retree" from extensionless ESM emit).
 *
 * Prerequisite: `npm run build:packages` (plus the create build) has run.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const importChecks = [
    { specifier: "@retreejs/core", namedExport: "Retree" },
    {
        specifier: "@retreejs/core/internal",
        namedExport: "setRetreeListenerFlushWrapper",
    },
    { specifier: "@retreejs/query", namedExport: "QueryNode" },
    { specifier: "@retreejs/react", namedExport: "useNode" },
    { specifier: "@retreejs/react/testing", namedExport: "createTestRoot" },
    { specifier: "@retreejs/devtools", namedExport: "connectReduxDevTools" },
    { specifier: "@retreejs/convex", namedExport: "ConvexNode" },
    {
        specifier: "@retreejs/react-convex",
        namedExport: "RetreeConvexReactClient",
    },
];

let failed = false;

for (const check of importChecks) {
    const childSource = [
        `const moduleNamespace = await import(${JSON.stringify(
            check.specifier
        )});`,
        `if (moduleNamespace[${JSON.stringify(
            check.namedExport
        )}] === undefined) {`,
        `    throw new Error(${JSON.stringify(
            `import("${check.specifier}") loaded, but the named export "${check.namedExport}" is undefined.`
        )});`,
        `}`,
    ].join("\n");
    const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", childSource],
        { cwd: rootDir, encoding: "utf8" }
    );
    if (result.status === 0) {
        console.log(`ok: import("${check.specifier}").${check.namedExport}`);
    } else {
        failed = true;
        console.error(`FAIL: import("${check.specifier}")`);
        console.error(indent(result.stderr));
    }
}

// @retreejs/create is a bin-only CLI: exercise it the way `npm create`
// does — execute the built entry directly (its --help path is side-effect
// free and proves the emitted output is loadable by plain node).
const createCliPath = resolve(rootDir, "packages/retree-create/bin/cli.js");
if (!existsSync(createCliPath)) {
    failed = true;
    console.error(
        `FAIL: ${createCliPath} does not exist. Run the @retreejs/create build first.`
    );
} else {
    const result = spawnSync(process.execPath, [createCliPath, "--help"], {
        cwd: rootDir,
        encoding: "utf8",
    });
    if (result.status === 0) {
        console.log("ok: node packages/retree-create/bin/cli.js --help");
    } else {
        failed = true;
        console.error("FAIL: node packages/retree-create/bin/cli.js --help");
        console.error(indent(result.stderr));
    }
}

if (failed) {
    console.error("\nNode import smoke test FAILED.");
    process.exit(1);
}
console.log("\nNode import smoke test passed.");

function indent(text) {
    return text
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
}
