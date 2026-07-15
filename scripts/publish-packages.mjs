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
        label: "@retreejs/query",
        directory: "packages/retree-query",
    },
    {
        label: "@retreejs/react",
        directory: "packages/retree-react",
    },
    {
        label: "@retreejs/devtools",
        directory: "packages/retree-devtools",
    },
    {
        label: "@retreejs/convex",
        directory: "packages/retree-convex",
    },
    {
        label: "@retreejs/react-convex",
        directory: "packages/retree-react-convex",
    },
    {
        label: "@retreejs/create",
        directory: "packages/retree-create",
    },
];
const familyPackageNames = new Set(
    packagesToPublish.map((entry) => entry.label)
);

if (process.argv.includes("--help")) {
    console.log(
        [
            "Usage: npm run publish:packages [-- --provenance]",
            "",
            "Publishes the Retree package family in lockstep, in two phases:",
            "",
            "Preflight (no registry writes):",
            "  1. Build every package.",
            "  2. Assert every package has the same version.",
            "  3. Assert every intra-family dependency and peerDependency pin",
            "     matches that version exactly.",
            "  4. Run the publish-shape gates: publint --strict, attw --pack",
            "     --profile esm-only, and the plain-Node import smoke test.",
            "  5. Check the registry: versions already published are skipped",
            "     later (idempotent retry after a partial publish).",
            "  6. npm publish --dry-run for every package.",
            "",
            "Publish:",
            "  7. npm publish each package. If one fails, the script reports",
            "     exactly which packages published and how to retry — rerunning",
            "     this script skips already-published versions.",
            "",
            "Flags:",
            "  --provenance  Pass --provenance to npm publish (CI with OIDC).",
            "",
            "New scoped packages are published with --access public.",
        ].join("\n")
    );
    process.exit(0);
}

const useProvenance = process.argv.includes("--provenance");
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

// -------------------------------------------------------------------------
// Preflight phase: build + validate everything before any registry write.
// Exact intra-family pins are deliberate (lockstep releases); the failure
// mode they punish is a half-published family, so nothing publishes until
// every package builds, agrees on version, and passes a dry run.
// -------------------------------------------------------------------------

console.log("\n=== Preflight ===");

const manifests = packagesToPublish.map((entry) => {
    const packageDir = resolve(rootDir, entry.directory);
    const manifestPath = resolve(packageDir, "package.json");
    if (!existsSync(manifestPath)) {
        throw new Error(`Preflight: ${manifestPath} does not exist.`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return { ...entry, packageDir, manifest };
});

const releaseVersion = manifests[0].manifest.version;
for (const entry of manifests) {
    if (entry.manifest.version !== releaseVersion) {
        throw new Error(
            `Preflight: ${entry.label} is at version ${entry.manifest.version}, expected lockstep version ${releaseVersion} (from ${manifests[0].label}).`
        );
    }
}
console.log(`Lockstep version: ${releaseVersion}`);

for (const entry of manifests) {
    assertFamilyPinsMatch(entry, "dependencies", releaseVersion);
    assertFamilyPinsMatch(entry, "peerDependencies", releaseVersion);
}
console.log("All intra-family pins match the release version.");

for (const entry of manifests) {
    console.log(`\nBuilding ${entry.label}`);
    run("npm", ["run", "build"], entry.packageDir, publishEnv);
}

// Publish-shape gates: publint --strict, attw --pack --profile esm-only
// (ESM-only by policy — audit R1), and the plain-Node import smoke test.
// Runs after every package is built and before any registry read/write.
console.log("\nPackage publish-shape gates (publint + attw + import smoke)");
run("node", ["scripts/lint-packages.mjs"], rootDir, publishEnv);

const publishPlan = [];
for (const entry of manifests) {
    const registryState = npmVersionState(
        entry.label,
        releaseVersion,
        publishEnv
    );
    if (registryState.versionPublished) {
        console.log(
            `${entry.label}@${releaseVersion} is already on the registry; it will be skipped (idempotent retry).`
        );
        continue;
    }
    publishPlan.push({ ...entry, isNewPackage: !registryState.packageExists });
}

if (publishPlan.length === 0) {
    console.log(
        `\nEvery package is already published at ${releaseVersion}. Nothing to do.`
    );
    process.exit(0);
}

for (const entry of publishPlan) {
    console.log(`\nDry run: ${entry.label}`);
    run(
        "npm",
        [...buildPublishArgs(entry), "--dry-run"],
        entry.packageDir,
        publishEnv
    );
}

// -------------------------------------------------------------------------
// Publish phase.
// -------------------------------------------------------------------------

console.log("\n=== Publish ===");

const published = [];
for (const entry of publishPlan) {
    console.log(`\nPublishing ${entry.label}@${releaseVersion}`);
    try {
        run("npm", buildPublishArgs(entry), entry.packageDir, publishEnv);
    } catch (error) {
        const remaining = publishPlan
            .filter((candidate) => !published.includes(candidate.label))
            .map((candidate) => candidate.label);
        console.error(
            [
                "",
                `PARTIAL PUBLISH: ${entry.label}@${releaseVersion} failed.`,
                `Published successfully: ${
                    published.length > 0 ? published.join(", ") : "(none)"
                }`,
                `Not yet published: ${remaining.join(", ")}`,
                "",
                "Recovery: fix the failure and rerun `npm run publish:packages` —",
                "already-published versions are detected and skipped, so the",
                "family converges on the same version.",
            ].join("\n")
        );
        throw error;
    }
    published.push(entry.label);
}

console.log(`\nAll packages published at ${releaseVersion}.`);

function buildPublishArgs(entry) {
    const args = ["publish"];
    if (entry.isNewPackage) {
        args.push("--access", "public");
    }
    if (useProvenance) {
        args.push("--provenance");
    }
    return args;
}

function assertFamilyPinsMatch(entry, field, version) {
    const dependencies = entry.manifest[field];
    if (dependencies === undefined) {
        return;
    }
    for (const [name, range] of Object.entries(dependencies)) {
        if (!familyPackageNames.has(name)) {
            continue;
        }
        if (range !== version) {
            throw new Error(
                `Preflight: ${entry.label} ${field} pins ${name} to "${range}", expected the exact lockstep version "${version}".`
            );
        }
    }
}

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

function npmVersionState(packageName, version, env) {
    const result = spawnSync(
        "npm",
        ["view", packageName, "versions", "--json"],
        {
            cwd: rootDir,
            env,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    if (result.error) {
        throw new Error(
            `npm view ${packageName} versions: failed to start: ${result.error.message}`
        );
    }

    if (result.signal) {
        throw new Error(
            `npm view ${packageName} versions: exited with signal ${result.signal}.`
        );
    }

    if (result.status === 0) {
        const parsed = JSON.parse(result.stdout);
        const versions = Array.isArray(parsed) ? parsed : [parsed];
        return {
            packageExists: true,
            versionPublished: versions.includes(version),
        };
    }

    if (isNpmNotFound(result.stderr)) {
        return { packageExists: false, versionPublished: false };
    }

    const stderr = result.stderr.trim();
    if (stderr.length === 0) {
        throw new Error(
            `npm view ${packageName} versions: exited with status ${String(
                result.status
            )}.`
        );
    }

    throw new Error(
        `npm view ${packageName} versions: exited with status ${String(
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
