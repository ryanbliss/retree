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
];

if (process.argv.includes("--help")) {
    console.log(
        [
            "Usage: npm run publish:packages",
            "",
            "Loads root .env variables, then for @retreejs/core, @retreejs/react, and @retreejs/convex:",
            "  1. npm run build",
            "  2. npm publish --dry-run",
            "  3. npm publish",
            "",
            "Publishing stops immediately if build or dry-run fails.",
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
    run("npm", ["publish", "--dry-run"], packageDir, publishEnv);
    run("npm", ["publish"], packageDir, publishEnv);
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
