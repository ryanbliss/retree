#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    buildNpmPublishArguments,
    parsePublishArguments,
    publishPackageCatalog,
    selectPackagesToPublish,
} from "./publish-package-selection.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(rootDir, ".env");
const options = parsePublishArguments(process.argv.slice(2));
const packagesToPublish = selectPackagesToPublish(options.packageName);
const familyPackageNames = new Set(
    publishPackageCatalog
        .filter((entry) => entry.publishByDefault)
        .map((entry) => entry.label)
);

if (options.showHelp) {
    console.log(
        [
            "Usage: npm run publish:packages [-- --package <name>] [--dry-run] [--provenance]",
            "",
            "Publishes the Retree package family, or exactly one selected package, in two phases:",
            "",
            "Preflight (no registry writes):",
            "  1. Build every package.",
            "  2. Assert the existing Retree family has one lockstep version.",
            "  3. Assert every intra-family dependency pin matches that version",
            "     exactly, and every intra-family peerDependency declares the",
            "     one shared major-line range that version satisfies.",
            "  4. Run the publish-shape gates: publint --strict, attw --pack",
            "     --profile esm-only, and the plain-Node import smoke test.",
            "  5. Check the registry: versions already published are skipped",
            "     later (idempotent retry after a partial publish).",
            "  6. npm publish --dry-run for every selected package.",
            "",
            "Publish:",
            "  7. npm publish each selected package. If one fails, the script reports",
            "     exactly which packages published and how to retry — rerunning",
            "     this script skips already-published versions.",
            "",
            "Flags:",
            "  --package <name>  Publish exactly this configured npm package.",
            "                    Without it, publish the lockstep Retree family.",
            "  --dry-run     Run the complete preflight and npm publish dry runs",
            "                without publishing any package.",
            "  --provenance  Pass --provenance to npm publish (CI with OIDC).",
            "",
            "New scoped packages are published with --access public.",
        ].join("\n")
    );
    process.exit(0);
}

const useProvenance = options.useProvenance;
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
// Lockstep releases are deliberate; the failure mode they punish is a
// half-published family, so nothing publishes until every package builds,
// agrees on version, and passes a dry run. Intra-family dependency pins are
// exact; peerDependencies use one shared major-line range (see
// assertFamilyPeerRangesAreLockstep for why an exact peer pin cannot be
// released as a minor).
// -------------------------------------------------------------------------

console.log("\n=== Preflight ===");

const catalogManifests = publishPackageCatalog.map((entry) => {
    const packageDir = resolve(rootDir, entry.directory);
    const manifestPath = resolve(packageDir, "package.json");
    if (!existsSync(manifestPath)) {
        throw new Error(`Preflight: ${manifestPath} does not exist.`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.name !== entry.label) {
        throw new Error(
            `Preflight: ${manifestPath} declares package name ${String(
                manifest.name
            )}, expected ${entry.label}.`
        );
    }
    if (typeof manifest.version !== "string") {
        throw new Error(
            `Preflight: ${manifestPath} must declare a string version before publishing.`
        );
    }
    return { ...entry, packageDir, manifest };
});
const manifestsByName = new Map(
    catalogManifests.map((entry) => [entry.label, entry])
);
const manifests = packagesToPublish.map((entry) => {
    const manifest = manifestsByName.get(entry.label);
    if (manifest === undefined) {
        throw new Error(
            `Preflight: selected package ${entry.label} has no loaded manifest.`
        );
    }
    return manifest;
});

const lockstepManifests = catalogManifests.filter(
    (entry) => entry.publishByDefault
);
const lockstepVersion = lockstepManifests[0].manifest.version;
for (const entry of lockstepManifests) {
    if (entry.manifest.version !== lockstepVersion) {
        throw new Error(
            `Preflight: ${entry.label} is at version ${entry.manifest.version}, expected lockstep version ${lockstepVersion} (from ${lockstepManifests[0].label}).`
        );
    }
}
console.log(`Lockstep version: ${lockstepVersion}`);
console.log(
    `Selected for publishing: ${manifests
        .map((entry) => `${entry.label}@${entry.manifest.version}`)
        .join(", ")}`
);

for (const entry of manifests) {
    assertFamilyPinsMatch(entry, "dependencies", lockstepVersion);
}
assertFamilyPeerRangesAreLockstep(manifests, lockstepVersion);
console.log("Selected package intra-family pins match the lockstep version.");

// Publish-shape gates: publint --strict, attw --pack --profile esm-only
// (ESM-only by policy — audit R1), and the plain-Node import smoke test.
// Runs after every package is built and before any registry read/write.
console.log("\nBuild and package publish-shape gates");
run("npm", ["run", "lint:packages"], rootDir, publishEnv);

const publishPlan = [];
for (const entry of manifests) {
    const version = entry.manifest.version;
    const registryState = npmVersionState(entry.label, version, publishEnv);
    if (registryState.versionPublished) {
        console.log(
            `${entry.label}@${version} is already on the registry; it will be skipped (idempotent retry).`
        );
        continue;
    }
    publishPlan.push({ ...entry, isNewPackage: !registryState.packageExists });
}

if (publishPlan.length === 0) {
    const selectedVersions = manifests
        .map((entry) => `${entry.label}@${entry.manifest.version}`)
        .join(", ");
    console.log(
        `\nEvery selected package is already published (${selectedVersions}). Nothing to do.`
    );
    process.exit(0);
}

for (const entry of publishPlan) {
    console.log(`\nDry run: ${entry.label}@${entry.manifest.version}`);
    run(
        "npm",
        [
            ...buildNpmPublishArguments({
                isNewPackage: entry.isNewPackage,
                useProvenance,
            }),
            "--dry-run",
        ],
        entry.packageDir,
        publishEnv
    );
}

if (options.dryRunOnly) {
    console.log("\nDry run complete. No packages were published.");
    process.exit(0);
}

// -------------------------------------------------------------------------
// Publish phase.
// -------------------------------------------------------------------------

console.log("\n=== Publish ===");

const published = [];
for (const entry of publishPlan) {
    const packageVersion = `${entry.label}@${entry.manifest.version}`;
    console.log(`\nPublishing ${packageVersion}`);
    try {
        run(
            "npm",
            buildNpmPublishArguments({
                isNewPackage: entry.isNewPackage,
                useProvenance,
            }),
            entry.packageDir,
            publishEnv
        );
    } catch (error) {
        const remaining = publishPlan
            .filter((candidate) => !published.includes(candidate.label))
            .map((candidate) => candidate.label);
        console.error(
            [
                "",
                `PARTIAL PUBLISH: ${packageVersion} failed.`,
                `Published successfully: ${
                    published.length > 0 ? published.join(", ") : "(none)"
                }`,
                `Not yet published: ${remaining.join(", ")}`,
                "",
                "Recovery: fix the failure and rerun `npm run publish:packages` —",
                "already-published versions are detected and skipped, so the",
                "selected package set converges on the requested versions.",
            ].join("\n")
        );
        throw error;
    }
    published.push(entry.label);
}

console.log(
    `\nAll selected packages published: ${publishPlan
        .map((entry) => `${entry.label}@${entry.manifest.version}`)
        .join(", ")}.`
);

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

/**
 * Intra-family peerDependencies use a major-line range rather than an exact
 * pin. An exact peer pin makes every release a breaking change for its peer
 * dependents from changesets' perspective, so a `minor` changeset escalates
 * the whole fixed family to a major bump (0.7.2 would become 1.0.0 rather
 * than 0.8.0). The range keeps ordinary minor releases reachable while still
 * refusing to pair a family package with a different major line.
 *
 * The check stays strict: every intra-family peer range must be the same
 * string across the family, that string must be a `>=lower <nextMajor.0.0`
 * range, and the lockstep version being published must satisfy it. That is
 * what prevents a skewed family publish, which is the failure the exact pins
 * were guarding against.
 */
function assertFamilyPeerRangesAreLockstep(entries, version) {
    const familyPeerRangePattern = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.0\.0$/;
    const lockstepParts = version.split(".").map(Number);
    if (lockstepParts.length !== 3 || lockstepParts.some(Number.isNaN)) {
        throw new Error(
            `Preflight: lockstep version "${version}" is not a plain major.minor.patch version. Intra-family peer range validation only understands plain versions. Fix: publish a plain version, or extend assertFamilyPeerRangesAreLockstep to handle this versioning scheme.`
        );
    }
    let canonicalRange;
    let canonicalSource;
    for (const entry of entries) {
        const peerDependencies = entry.manifest.peerDependencies;
        if (peerDependencies === undefined) {
            continue;
        }
        for (const [name, range] of Object.entries(peerDependencies)) {
            if (!familyPackageNames.has(name)) {
                continue;
            }
            const match = familyPeerRangePattern.exec(range);
            if (match === null) {
                throw new Error(
                    `Preflight: ${
                        entry.label
                    } peerDependencies declares ${name} as "${range}", which is not an intra-family major-line range. Fix: use a range of the form ">=<lowest supported version> <${
                        lockstepParts[0] + 1
                    }.0.0".`
                );
            }
            if (Number(match[4]) !== lockstepParts[0] + 1) {
                throw new Error(
                    `Preflight: ${
                        entry.label
                    } peerDependencies declares ${name} as "${range}", whose upper bound does not exclude the next major after the lockstep version "${version}". Fix: set the upper bound to "<${
                        lockstepParts[0] + 1
                    }.0.0".`
                );
            }
            const lowerParts = [
                Number(match[1]),
                Number(match[2]),
                Number(match[3]),
            ];
            if (compareVersionParts(lowerParts, lockstepParts) > 0) {
                throw new Error(
                    `Preflight: ${entry.label} peerDependencies declares ${name} as "${range}", whose lower bound is above the lockstep version "${version}". Fix: lower the bound to at most "${version}".`
                );
            }
            if (canonicalRange === undefined) {
                canonicalRange = range;
                canonicalSource = `${entry.label} peerDependencies.${name}`;
                continue;
            }
            if (range !== canonicalRange) {
                throw new Error(
                    `Preflight: ${entry.label} peerDependencies declares ${name} as "${range}", but ${canonicalSource} declares "${canonicalRange}". Every intra-family peer range must be identical so the family cannot be paired across ranges. Fix: make both ranges the same string.`
                );
            }
        }
    }
    if (canonicalRange === undefined) {
        console.log("No intra-family peer ranges to validate.");
        return;
    }
    console.log(`Intra-family peer range: ${canonicalRange}`);
}

function compareVersionParts(left, right) {
    for (let index = 0; index < 3; index++) {
        if (left[index] !== right[index]) {
            return left[index] - right[index];
        }
    }
    return 0;
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
