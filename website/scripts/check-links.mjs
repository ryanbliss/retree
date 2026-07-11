/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Build-time dead-link check (spec §7.5). Scans every MDX file under
 * content/ for internal /docs and /api links and verifies each target file
 * exists. Fails the build on the first pass with a full list of broken
 * links, so guides and the generated reference can never link into a void.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

const websiteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contentDir = path.join(websiteDir, "content");

async function collectMdxFiles(dir, files = []) {
    for (const entry of await readdir(dir)) {
        const fullPath = path.join(dir, entry);
        if ((await stat(fullPath)).isDirectory()) {
            await collectMdxFiles(fullPath, files);
        } else if (entry.endsWith(".mdx")) {
            files.push(fullPath);
        }
    }
    return files;
}

/** Extracts internal link targets from markdown + JSX href attributes. */
function extractInternalLinks(source) {
    const links = [];
    const patterns = [
        /\]\((\/(?:docs|api)\/[^)\s#]*)(?:#[^)\s]*)?\)/g,
        /href="(\/(?:docs|api)\/[^"#]*)(?:#[^"]*)?"/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            links.push(match[1]);
        }
    }
    return links;
}

function targetExists(link) {
    const clean = link.replace(/\/$/, "").replace(/\.mdx$/, "");
    if (clean === "/docs" || clean === "/api") return true;
    if (clean.startsWith("/docs/")) {
        const slug = clean.slice("/docs/".length);
        return existsSync(path.join(contentDir, "docs", `${slug}.mdx`));
    }
    if (clean.startsWith("/api/")) {
        const slug = clean.slice("/api/".length);
        if (existsSync(path.join(contentDir, "api", slug, "index.mdx"))) {
            return true;
        }
        return existsSync(path.join(contentDir, "api", `${slug}.mdx`));
    }
    return true;
}

const files = await collectMdxFiles(contentDir);
const broken = [];
for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const link of extractInternalLinks(source)) {
        if (!targetExists(link)) {
            broken.push({ file: path.relative(websiteDir, file), link });
        }
    }
}

if (broken.length > 0) {
    console.error(`check-links: found ${broken.length} broken internal links:`);
    for (const entry of broken) {
        console.error(`  ${entry.file} → ${entry.link}`);
    }
    process.exitCode = 1;
} else {
    console.log(
        `check-links: ${files.length} MDX files scanned, no broken links.`
    );
}
