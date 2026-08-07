#!/usr/bin/env node

/**
 * Tag a published version and create the matching GitHub release, using the
 * package's own changelog entry as the release notes.
 *
 * Runs at the end of the `Release` workflow, after `npm publish` succeeds, so
 * a tag never points at a version that failed to publish. Idempotent in the
 * same way as the publish step: an existing release for the tag is left alone,
 * so re-running the workflow after a partial failure converges instead of
 * erroring.
 *
 * Two release trains, two tag shapes:
 *
 * - The lockstep runtime family shares one version and one tag, `v0.8.0`,
 *   matching the existing `v0.7.0` / `v0.7.1` tags.
 * - `@retreejs/react-eslint-plugin` is versioned independently, so it gets a
 *   name-scoped tag (`react-eslint-plugin-v0.1.1`) that cannot collide with a
 *   family tag.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publishPackageCatalog } from "./publish-package-selection.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const options = parseArguments(args);

const familyEntries = publishPackageCatalog.filter(
    (entry) => entry.publishByDefault
);

const target =
    options.packageName === undefined
        ? buildFamilyTarget()
        : buildSinglePackageTarget(options.packageName);

if (releaseExists(target.tag)) {
    console.log(
        `${target.tag} already has a GitHub release; leaving it unchanged.`
    );
    process.exit(0);
}

console.log(`Creating GitHub release ${target.tag} (${target.title})`);
if (options.dryRun) {
    console.log("--- notes ---");
    console.log(target.notes);
    console.log("--- end notes ---");
    console.log("Dry run: no tag or release was created.");
    process.exit(0);
}

const result = spawnSync(
    "gh",
    [
        "release",
        "create",
        target.tag,
        "--target",
        readCommitSha(),
        "--title",
        target.title,
        "--notes",
        target.notes,
    ],
    { cwd: rootDir, stdio: "inherit", env: process.env }
);
if (result.error !== undefined) {
    throw result.error;
}
if (result.status !== 0) {
    throw new Error(
        `create-github-release: \`gh release create ${target.tag}\` exited with code ${result.status}. The packages are already published, so rerun the Release workflow to retry only the release creation.`
    );
}
console.log(`Created GitHub release ${target.tag}.`);

function parseArguments(argv) {
    let packageName;
    let dryRun = false;
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--dry-run") {
            dryRun = true;
            continue;
        }
        if (arg === "--package") {
            packageName = argv[index + 1];
            if (packageName === undefined) {
                throw new Error(
                    "create-github-release: --package requires a package name, for example `--package @retreejs/react-eslint-plugin`."
                );
            }
            index++;
            continue;
        }
        throw new Error(
            `create-github-release: unrecognized argument "${arg}". Usage: create-github-release [--package <name>] [--dry-run].`
        );
    }
    return { packageName, dryRun };
}

function buildFamilyTarget() {
    const coreEntry = familyEntries.find(
        (entry) => entry.label === "@retreejs/core"
    );
    if (coreEntry === undefined) {
        throw new Error(
            "create-github-release: @retreejs/core is not in the lockstep publish catalog, so the family version cannot be determined. Fix: check publishPackageCatalog in scripts/publish-package-selection.mjs."
        );
    }
    const version = readManifestVersion(coreEntry);
    for (const entry of familyEntries) {
        const entryVersion = readManifestVersion(entry);
        if (entryVersion !== version) {
            throw new Error(
                `create-github-release: ${entry.label} is at version ${entryVersion}, expected the lockstep version ${version}. Fix: release from a commit where \`npm run version:packages\` has synchronized the family.`
            );
        }
    }
    const notes = [
        readChangelogSection(coreEntry, version),
        "",
        "### Packages",
        "",
        ...familyEntries.map((entry) => `-   \`${entry.label}@${version}\``),
    ].join("\n");
    return { tag: `v${version}`, title: `v${version}`, notes };
}

function buildSinglePackageTarget(packageName) {
    const entry = publishPackageCatalog.find(
        (candidate) => candidate.label === packageName
    );
    if (entry === undefined) {
        throw new Error(
            `create-github-release: ${packageName} is not in the publish catalog. Fix: pass one of ${publishPackageCatalog
                .map((candidate) => candidate.label)
                .join(", ")}.`
        );
    }
    if (entry.publishByDefault) {
        throw new Error(
            `create-github-release: ${packageName} is part of the lockstep family, which shares one release. Fix: run this without --package to tag the whole family.`
        );
    }
    const version = readManifestVersion(entry);
    const tagPrefix = packageName.replace(/^@retreejs\//, "");
    const notes = [
        readChangelogSection(entry, version),
        "",
        "### Packages",
        "",
        `-   \`${packageName}@${version}\``,
    ].join("\n");
    return {
        tag: `${tagPrefix}-v${version}`,
        title: `${packageName}@${version}`,
        notes,
    };
}

function readManifestVersion(entry) {
    const manifestPath = resolve(rootDir, entry.directory, "package.json");
    if (!existsSync(manifestPath)) {
        throw new Error(
            `create-github-release: ${manifestPath} does not exist.`
        );
    }
    const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
    if (typeof version !== "string") {
        throw new Error(
            `create-github-release: ${manifestPath} does not declare a string version.`
        );
    }
    return version;
}

/**
 * Extract one version's section from a package's CHANGELOG.md — everything
 * between its `## <version>` heading and the next `## ` heading. Changesets
 * writes an empty section for a package released only to keep the fixed family
 * in lockstep, so an empty result is expected and falls back to a short note
 * rather than failing the release.
 */
function readChangelogSection(entry, version) {
    const changelogPath = resolve(rootDir, entry.directory, "CHANGELOG.md");
    if (!existsSync(changelogPath)) {
        return `Released \`${entry.label}@${version}\`.`;
    }
    const changelog = readFileSync(changelogPath, "utf8");
    const headingPattern = new RegExp(
        `^## ${escapeForRegExp(version)}\\s*$`,
        "m"
    );
    const headingMatch = headingPattern.exec(changelog);
    if (headingMatch === null) {
        return `Released \`${entry.label}@${version}\`.`;
    }
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const rest = changelog.slice(sectionStart);
    const nextHeading = /^## /m.exec(rest);
    const section = (
        nextHeading === null ? rest : rest.slice(0, nextHeading.index)
    ).trim();
    if (section.length === 0) {
        return `Released \`${entry.label}@${version}\`.`;
    }
    return section;
}

function releaseExists(tag) {
    const result = spawnSync("gh", ["release", "view", tag], {
        cwd: rootDir,
        stdio: "ignore",
        env: process.env,
    });
    if (result.error !== undefined) {
        throw new Error(
            `create-github-release: could not run \`gh\` to check for an existing ${tag} release. Fix: install the GitHub CLI, or run this from a workflow where it is preinstalled. Cause: ${result.error.message}`
        );
    }
    return result.status === 0;
}

function readCommitSha() {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: rootDir,
        encoding: "utf8",
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(
            `create-github-release: \`git rev-parse HEAD\` exited with code ${result.status}. Fix: run this inside a git checkout.`
        );
    }
    return result.stdout.trim();
}

function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
