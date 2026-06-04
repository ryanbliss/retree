#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(rootDir, ".env");
const packagesToPublish = [
    {
        label: "@retreejs/core",
        directory: "packages/retree-core",
    },
    {
        label: "@retreejs/react",
        directory: "packages/retree-react",
    },
    {
        label: "@retreejs/convex",
        directory: "packages/retree-convex",
    },
    {
        label: "@retreejs/react-convex",
        directory: "packages/retree-react-convex",
    },
];

if (process.argv.includes("--help")) {
    console.log(
        [
            "Usage: npm run publish:packages",
            "",
            "Loads root .env variables, then for each Retree package:",
            "  1. npm run build",
            "  2. npm view <package> version",
            "  3. npm publish --dry-run",
            "  4. npm publish",
            "",
            "New scoped packages are published with --access public.",
            "Publishing stops immediately if build, registry check, dry-run, or publish fails.",
        ].join("\n")
    );
    process.exit(0);
}

const publishEnv = {
    ...process.env,
    ...readEnvFile(envPath),
};

if (!publishEnv.NODE_AUTH_TOKEN && publishEnv.NPM_TOKEN) {
    publishEnv.NODE_AUTH_TOKEN = publishEnv.NPM_TOKEN;
}

if (existsSync(envPath)) {
    console.log("Loaded publish environment from root .env.");
} else {
    console.log("No root .env found; using existing process environment.");
}

for (const packageToPublish of packagesToPublish) {
    const packageDir = resolve(rootDir, packageToPublish.directory);
    console.log(`\nPublishing ${packageToPublish.label}`);
    run("npm", ["run", "build"], packageDir, publishEnv);

    const packageExists = npmPackageExists(packageToPublish.label, publishEnv);
    const publishArgs = packageExists
        ? ["publish"]
        : ["publish", "--access", "public"];
    if (!packageExists) {
        console.log(
            `${packageToPublish.label} does not exist on npm yet; publishing as a new public scoped package.`
        );
    }

    run("npm", [...publishArgs, "--dry-run"], packageDir, publishEnv);
    run("npm", publishArgs, packageDir, publishEnv);
}

console.log("\nAll packages published.");

function readEnvFile(path) {
    if (!existsSync(path)) {
        return {};
    }

    const env = {};
    const file = readFileSync(path, "utf8");
    const lines = file.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith("#")) {
            continue;
        }

        const match =
            /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(
                trimmedLine
            );
        if (!match) {
            throw new Error(
                `.env line ${index + 1}: expected KEY=value syntax.`
            );
        }

        const [, key, rawValue] = match;
        env[key] = parseEnvValue(rawValue);
    }

    return env;
}

function parseEnvValue(rawValue) {
    const trimmedValue = rawValue.trim();
    if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
        return trimmedValue
            .slice(1, -1)
            .replaceAll("\\n", "\n")
            .replaceAll('\\"', '"')
            .replaceAll("\\\\", "\\");
    }
    if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
        return trimmedValue.slice(1, -1);
    }

    return trimmedValue.replace(/\s+#.*$/u, "");
}

function npmPackageExists(packageName, env) {
    const result = spawnSync("npm", ["view", packageName, "version"], {
        cwd: rootDir,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.error) {
        throw new Error(
            `npm view ${packageName} version: failed to start: ${result.error.message}`
        );
    }

    if (result.signal) {
        throw new Error(
            `npm view ${packageName} version: exited with signal ${result.signal}.`
        );
    }

    if (result.status === 0) {
        const version = result.stdout.trim();
        console.log(`${packageName} exists on npm at version ${version}.`);
        return true;
    }

    if (isNpmNotFound(result.stderr)) {
        return false;
    }

    const stderr = result.stderr.trim();
    if (stderr.length === 0) {
        throw new Error(
            `npm view ${packageName} version: exited with status ${String(
                result.status
            )}.`
        );
    }

    throw new Error(
        `npm view ${packageName} version: exited with status ${String(
            result.status
        )}: ${stderr}`
    );
}

function isNpmNotFound(stderr) {
    if (stderr.includes("E404")) {
        return true;
    }

    if (stderr.includes("404 Not Found")) {
        return true;
    }

    return stderr.includes("is not in this registry");
}

function run(command, args, cwd, env) {
    const printableCommand = [command, ...args].join(" ");
    console.log(`\n> ${printableCommand}`);
    const result = spawnSync(command, args, {
        cwd,
        env,
        stdio: "inherit",
    });

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
