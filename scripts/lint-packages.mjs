#!/usr/bin/env node

/**
 * Publish-shape gates for every publishable package:
 *
 * 1. `publint --strict` — package.json/exports/files correctness.
 * 2. `attw --pack --profile esm-only` — type-resolution correctness for the
 *    packed tarball. The `esm-only` profile is deliberate: the family ships
 *    ESM only (audit R1, resolved 2026-07-14), so attw's CJS-consumer
 *    caveats (`CJSResolvesToESM`, node10 subpath resolution) are accepted
 *    by policy — modern Node supports `require(esm)` and all bundlers
 *    consume ESM.
 * 3. `scripts/smoke-node-imports.mjs` — plain-Node dynamic import of every
 *    built entry (regression net for extensionless-ESM emit).
 *
 * Prerequisite: packages are built (`npm run lint:packages` handles this).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const publishablePackageDirectories = [
    "packages/retree-core",
    "packages/retree-query",
    "packages/retree-react",
    "packages/retree-devtools",
    "packages/retree-convex",
    "packages/retree-react-convex",
    "packages/retree-create",
];

for (const directory of publishablePackageDirectories) {
    const packageDir = resolve(rootDir, directory);
    if (!existsSync(resolve(packageDir, "package.json"))) {
        throw new Error(
            `lint:packages: ${packageDir}/package.json does not exist.`
        );
    }
    run("npx", ["publint", "--strict"], packageDir);
    run("npx", ["attw", "--pack", "--profile", "esm-only"], packageDir);
}

run(
    process.execPath,
    [resolve(rootDir, "scripts/smoke-node-imports.mjs")],
    rootDir
);

console.log("\nlint:packages passed for every publishable package.");

function run(command, args, cwd) {
    const printableCommand = [command, ...args].join(" ");
    console.log(`\n[${cwd.replace(`${rootDir}/`, "")}] > ${printableCommand}`);
    const result = spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.error) {
        throw new Error(
            `${printableCommand}: failed to start in ${cwd}: ${result.error.message}`
        );
    }
    if (result.signal) {
        throw new Error(
            `${printableCommand}: exited with signal ${result.signal}.`
        );
    }
    if (result.status !== 0) {
        throw new Error(
            `${printableCommand}: exited with status ${String(result.status)}.`
        );
    }
}
