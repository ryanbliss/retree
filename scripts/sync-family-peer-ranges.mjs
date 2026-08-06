#!/usr/bin/env node

/**
 * Advance intra-family `peerDependencies` ranges to the version the family was
 * just versioned to. Runs as part of `npm run version:packages`, immediately
 * after `changeset version`.
 *
 * Why the ranges are not exact pins, and why they still have to move:
 *
 * Changesets escalates a package to a *major* bump when one of its
 * `peerDependencies` receives a minor or major bump and the new version does
 * not satisfy the range as written before the release
 * (`shouldBumpMajor` in @changesets/assemble-release-plan). An exact peer pin
 * never satisfies a new version, so with exact pins every minor changeset
 * escalated the whole fixed family to a major: 0.7.2 released as 1.0.0 rather
 * than 0.8.0, and no minor release of the family was reachable at all.
 *
 * A range whose lower bound is the currently released version satisfies the
 * next minor, so the escalation does not fire, and rewriting that lower bound
 * after each release keeps the range as tight as a pin in the direction that
 * matters: `@retreejs/react@0.9.0` requiring `>=0.9.0 <1.0.0` cannot be paired
 * with `@retreejs/core@0.8.0`. The one pairing a range still permits, and an
 * exact pin would not, is a core *newer* than the version a package shipped
 * against — ordinary peer-dependency forward compatibility.
 *
 * The publish preflight asserts exactly this shape, so a release that skips
 * this step fails before any registry write rather than publishing a family
 * whose ranges disagree with its versions.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publishPackageCatalog } from "./publish-package-selection.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
            `sync-family-peer-ranges: ${entry.label} is at version ${entry.manifest.version}, expected the lockstep version ${lockstepVersion} (from ${manifests[0].label}). Fix: run this immediately after \`changeset version\`, which versions the fixed family together.`
        );
    }
}

const versionParts = lockstepVersion.split(".").map(Number);
if (versionParts.length !== 3 || versionParts.some(Number.isNaN)) {
    throw new Error(
        `sync-family-peer-ranges: lockstep version "${lockstepVersion}" is not a plain major.minor.patch version. Fix: release a plain version, or extend this script to handle the versioning scheme in use.`
    );
}
const familyPeerRange = `>=${lockstepVersion} <${versionParts[0] + 1}.0.0`;

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

if (updates.length === 0) {
    console.log(
        `Intra-family peer ranges already match the lockstep version: ${familyPeerRange}`
    );
} else {
    console.log(`Intra-family peer range for ${lockstepVersion}:`);
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
