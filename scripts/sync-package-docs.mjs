#!/usr/bin/env node

import {
    copyFileSync,
    existsSync,
    readFileSync,
    rmSync,
    statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootLlmsPath = resolve(rootDir, "llms.txt");
const packageDirectories = [
    "packages/retree-core",
    "packages/retree-react",
    "packages/retree-convex",
    "packages/retree-react-convex",
    "packages/retree-benchmark-cli",
    "packages/retree-create",
];

const rawArgs = process.argv.slice(2);
const cleanIndex = rawArgs.indexOf("--clean");
const shouldClean = cleanIndex !== -1;
if (shouldClean) {
    rawArgs.splice(cleanIndex, 1);
}

if (!existsSync(rootLlmsPath)) {
    throw new Error(`Expected root llms.txt at ${rootLlmsPath}.`);
}

const packageDirs = resolvePackageDirs(rawArgs);
for (const packageDir of packageDirs) {
    const llmsPath = resolve(packageDir, "llms.txt");
    if (shouldClean) {
        cleanGeneratedLlms(llmsPath);
    } else {
        copyFileSync(rootLlmsPath, llmsPath);
        console.log(`Copied llms.txt to ${relative(rootDir, llmsPath)}.`);
    }
}

function resolvePackageDirs(rawTargets) {
    if (rawTargets.length === 0) {
        return packageDirectories.map((packageDirectory) =>
            resolve(rootDir, packageDirectory)
        );
    }

    return rawTargets.map((rawTarget) => {
        const packageDir = resolve(process.cwd(), rawTarget);
        assertKnownPackageDir(packageDir, rawTarget);
        return packageDir;
    });
}

function assertKnownPackageDir(packageDir, rawTarget) {
    if (!existsSync(packageDir)) {
        throw new Error(
            `Package docs target ${rawTarget} does not exist at ${packageDir}.`
        );
    }

    if (!statSync(packageDir).isDirectory()) {
        throw new Error(
            `Package docs target ${rawTarget} is not a directory at ${packageDir}.`
        );
    }

    const packageJsonPath = resolve(packageDir, "package.json");
    if (!existsSync(packageJsonPath)) {
        throw new Error(
            `Package docs target ${rawTarget} is missing package.json at ${packageJsonPath}.`
        );
    }

    const knownPackageDirs = new Set(
        packageDirectories.map((packageDirectory) =>
            resolve(rootDir, packageDirectory)
        )
    );
    if (!knownPackageDirs.has(packageDir)) {
        throw new Error(
            `Package docs target ${rawTarget} is not one of the configured publish packages.`
        );
    }
}

function cleanGeneratedLlms(llmsPath) {
    if (!existsSync(llmsPath)) {
        return;
    }

    const rootLlms = readFileSync(rootLlmsPath, "utf8");
    const packageLlms = readFileSync(llmsPath, "utf8");
    if (packageLlms !== rootLlms) {
        throw new Error(
            `Refusing to remove ${llmsPath} because it does not match the root llms.txt.`
        );
    }

    rmSync(llmsPath);
    console.log(`Removed generated ${relative(rootDir, llmsPath)}.`);
}
