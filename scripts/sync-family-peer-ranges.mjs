#!/usr/bin/env node

/**
 * Keep intra-family `peerDependencies` ranges in step with the family version.
 * Both modes run as part of `npm run version:packages`, around
 * `changeset version`:
 *
 *     sync-family-peer-ranges --widen   # before: >=0.8.0 <1.0.0
 *     changeset version                 # 0.8.0 -> 0.9.0
 *     sync-family-peer-ranges           # after:  >=0.9.0 <0.10.0
 *
 * The committed and published shape is the tight one — a family package
 * resolves only against the same minor line of its family peers, which is
 * what "the family moves in lockstep" means and what pre-1.0 minors require,
 * since a minor here can carry behavior changes.
 *
 * The widen step exists because of how changesets decides bump types.
 * `shouldBumpMajor` in @changesets/assemble-release-plan escalates a package
 * to a *major* bump when one of its `peerDependencies` takes a minor bump and
 * the new version does not satisfy that peer range **as written when the
 * release plan is computed**:
 *
 *     depType === "peerDependencies" && nextRelease.type !== "patch" && (
 *       !onlyUpdatePeerDependentsWhenOutOfRange ||
 *       !semverSatisfies(incrementVersion(nextRelease, preInfo), versionRange))
 *
 * A tight range never satisfies the next minor (0.9.0 does not satisfy
 * `<0.9.0`), so leaving the tight range in place while the plan is computed
 * escalates the whole fixed family: a minor changeset released 0.8.0 as 1.0.0.
 * Widening to the major line for the duration of the computation avoids the
 * escalation; tightening straight afterwards means the widened range is never
 * committed, published, or seen by an installer.
 *
 * Since the escalation is only skipped when the pending version is inside the
 * widened range, a genuine major changeset still escalates as it should
 * (2.0.0 does not satisfy `>=1.4.0 <2.0.0`).
 *
 * The publish preflight asserts the tight shape, so a release that skips or
 * half-applies these steps fails before any registry write rather than
 * publishing a family whose ranges disagree with its versions.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publishPackageCatalog } from "./publish-package-selection.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const unknownArgs = args.filter((arg) => arg !== "--widen");
if (unknownArgs.length > 0) {
    throw new Error(
        `sync-family-peer-ranges: unrecognized argument(s) ${unknownArgs.join(
            ", "
        )}. Usage: sync-family-peer-ranges [--widen]. Pass --widen before \`changeset version\` and no arguments after it.`
    );
}
const shouldWiden = args.includes("--widen");

const familyEntries = publishPackageCatalog.filter(
    (entry) => entry.publishByDefault
);
const familyPackageNames = new Set(familyEntries.map((entry) => entry.label));

const manifests = familyEntries.map((entry) => {
    const manifestPath = resolve(rootDir, entry.directory, "package.json");
    const raw = readFileSync(manifestPath, "utf8");
    return { ...entry, manifestPath, raw, manifest: JSON.parse(raw) };
});

const lockstepVersion = manifests[0].manifest.version;
for (const entry of manifests) {
    if (entry.manifest.version !== lockstepVersion) {
        throw new Error(
            `sync-family-peer-ranges: ${entry.label} is at version ${entry.manifest.version}, expected the lockstep version ${lockstepVersion} (from ${manifests[0].label}). Fix: run this immediately before or after \`changeset version\`, which versions the fixed family together.`
        );
    }
}

const versionParts = lockstepVersion.split(".").map(Number);
if (versionParts.length !== 3 || versionParts.some(Number.isNaN)) {
    throw new Error(
        `sync-family-peer-ranges: lockstep version "${lockstepVersion}" is not a plain major.minor.patch version. Fix: release a plain version, or extend this script to handle the versioning scheme in use.`
    );
}
const [major, minor] = versionParts;
const familyPeerRange = shouldWiden
    ? `>=${lockstepVersion} <${major + 1}.0.0`
    : `>=${lockstepVersion} <${major}.${minor + 1}.0`;

const updates = [];
for (const entry of manifests) {
    const peerDependencies = entry.manifest.peerDependencies;
    if (peerDependencies === undefined) {
        continue;
    }
    let updatedRaw = entry.raw;
    for (const [name, range] of Object.entries(peerDependencies)) {
        if (!familyPackageNames.has(name)) {
            continue;
        }
        if (range === familyPeerRange) {
            continue;
        }
        // Rewrite the raw text rather than re-serializing the manifest, so
        // this never reformats a file changesets just wrote.
        const previousRaw = updatedRaw;
        updatedRaw = replacePeerRange(updatedRaw, name, familyPeerRange);
        if (updatedRaw === previousRaw) {
            throw new Error(
                `sync-family-peer-ranges: could not rewrite the ${name} peerDependencies range in ${entry.manifestPath}. Fix: check that the manifest declares "${name}" inside a "peerDependencies" block on its own line.`
            );
        }
        updates.push(
            `${entry.label} peerDependencies.${name}: ${range} -> ${familyPeerRange}`
        );
    }
    if (updatedRaw !== entry.raw) {
        writeFileSync(entry.manifestPath, updatedRaw);
    }
}

const label = shouldWiden
    ? "Widened intra-family peer ranges for version computation"
    : `Intra-family peer range for ${lockstepVersion}`;
if (updates.length === 0) {
    console.log(`${label}: already ${familyPeerRange}`);
} else {
    console.log(`${label}:`);
    for (const update of updates) {
        console.log(`  ${update}`);
    }
}

/**
 * Replace the range of one dependency inside the manifest's
 * `peerDependencies` block only. `dependencies` and `devDependencies` declare
 * the same family packages with exact pins that changesets maintains, so a
 * whole-file replace would silently corrupt them.
 */
function replacePeerRange(raw, dependencyName, range) {
    const blockPattern = /("peerDependencies"\s*:\s*\{)([^}]*)(\})/;
    const blockMatch = blockPattern.exec(raw);
    if (blockMatch === null) {
        return raw;
    }
    const entryPattern = new RegExp(
        `("${escapeForRegExp(dependencyName)}"\\s*:\\s*)"[^"]*"`
    );
    const updatedBlock = blockMatch[2].replace(entryPattern, `$1"${range}"`);
    if (updatedBlock === blockMatch[2]) {
        return raw;
    }
    return (
        raw.slice(0, blockMatch.index) +
        blockMatch[1] +
        updatedBlock +
        blockMatch[3] +
        raw.slice(blockMatch.index + blockMatch[0].length)
    );
}

function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
