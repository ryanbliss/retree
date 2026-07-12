/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Generates the /api reference content for the website.
 *
 * For each Retree package this runs TypeDoc programmatically against the
 * package's TypeScript source (not dist), emitting MDX via
 * typedoc-plugin-markdown into `website/content/api/<pkg>/` plus a
 * `navigation.json` used to render the sidebar. The output directory is a
 * gitignored build artifact regenerated on every website build, so the API
 * reference can never drift from the source in `packages/`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { Application } from "typedoc";

const websiteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(websiteDir);
const outputRoot = path.join(websiteDir, "content", "api");

const PACKAGES = [
    {
        slug: "core",
        dir: "retree-core",
        npmName: "@retreejs/core",
        title: "@retreejs/core",
    },
    {
        slug: "react",
        dir: "retree-react",
        npmName: "@retreejs/react",
        title: "@retreejs/react",
    },
    {
        slug: "convex",
        dir: "retree-convex",
        npmName: "@retreejs/convex",
        title: "@retreejs/convex",
    },
    {
        slug: "react-convex",
        dir: "retree-react-convex",
        npmName: "@retreejs/react-convex",
        title: "@retreejs/react-convex",
    },
];

/**
 * Generate API MDX for one package.
 * @param {{slug: string, dir: string, npmName: string, title: string}} pkg
 */
async function generatePackageDocs(pkg) {
    const packageDir = path.join(repoRoot, "packages", pkg.dir);
    const entryPoint = path.join(packageDir, "src", "index.ts");
    const tsconfig = path.join(packageDir, "tsconfig.json");
    const outDir = path.join(outputRoot, pkg.slug);

    const app = await Application.bootstrapWithPlugins({
        plugin: ["typedoc-plugin-markdown", "typedoc-plugin-frontmatter"],
        entryPoints: [entryPoint],
        tsconfig,
        out: outDir,
        name: pkg.npmName,
        readme: "none",
        excludeInternal: true,
        excludePrivate: true,
        disableSources: false,
        gitRevision: "main",
        // typedoc-plugin-markdown options
        router: "member",
        fileExtension: ".mdx",
        entryFileName: "index",
        hidePageHeader: true,
        hideBreadcrumbs: true,
        useCodeBlocks: true,
        sanitizeComments: true,
        parametersFormat: "table",
        interfacePropertiesFormat: "table",
        classPropertiesFormat: "table",
        typeAliasPropertiesFormat: "table",
        enumMembersFormat: "table",
        propertyMembersFormat: "table",
        publicPath: `/api/${pkg.slug}/`,
        navigationJson: path.join(outDir, "navigation.json"),
        logLevel: "Warn",
    });

    const project = await app.convert();
    if (project === undefined) {
        throw new Error(
            `generate-api-docs: TypeDoc conversion produced no project for package "${pkg.npmName}". Check the entry point at ${entryPoint}.`
        );
    }

    await app.generateOutputs(project);
    // typedoc-plugin-markdown writes markdown through generateOutputs when the
    // markdown router is active; ensure output landed where expected.
    return outDir;
}

async function main() {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });

    for (const pkg of PACKAGES) {
        const started = Date.now();
        // Packages are independent; serial runs keep logs readable.
        await generatePackageDocs(pkg);
        console.log(
            `generate-api-docs: ${pkg.npmName} → content/api/${pkg.slug} (${
                Date.now() - started
            }ms)`
        );
    }

    await writeManifest();
    await writeLlmsTxt();

    console.log("generate-api-docs: done.");
}

/**
 * Publishes the repo llms.txt extended with this site's own resources
 * (docs pages, raw markdown exports, generated API reference) so AI readers
 * discover the new site's content, not only the legacy TypeDoc deployment
 * (spec §8).
 */
async function writeLlmsTxt() {
    const SITE_URL = "https://retreejs.dev";
    const base = await readFile(path.join(repoRoot, "llms.txt"), "utf8");

    const docSlugs = [
        "quick-start",
        "thinking-in-retree",
        "common-pitfalls",
        "react",
        "react/use-root",
        "react/use-node",
        "react/use-tree",
        "react/use-select",
        "react/use-raw",
        "events-and-subscriptions",
        "tree-operations",
        "transactions",
        "view-models",
        "setup-and-decorators",
        "performance",
        "convex",
    ];
    const docLines = docSlugs
        .map(
            (slug) =>
                `- [${slug}](${SITE_URL}/raw/docs/${slug}.md): raw markdown of ${SITE_URL}/docs/${slug}`
        )
        .join("\n");
    const apiLines = PACKAGES.map(
        (pkg) =>
            `- [${pkg.npmName} reference](${SITE_URL}/api/${pkg.slug}): generated from TypeScript source on every deploy`
    ).join("\n");

    const siteSection = `\n## This site (${SITE_URL})\n\nEvery guide below is also served as raw markdown for machine readers:\n\n${docLines}\n\n### Generated API reference\n\n${apiLines}\n`;

    await writeFile(
        path.join(websiteDir, "public", "llms.txt"),
        base.trimEnd() + "\n" + siteSection
    );
}

/** Writes a manifest the /api routes use to enumerate packages. */
async function writeManifest() {
    const manifest = {
        generatedAt: new Date().toISOString(),
        packages: await Promise.all(
            PACKAGES.map(async (pkg) => {
                const packageJsonPath = path.join(
                    repoRoot,
                    "packages",
                    pkg.dir,
                    "package.json"
                );
                const packageJson = JSON.parse(
                    await readFile(packageJsonPath, "utf8")
                );
                return {
                    slug: pkg.slug,
                    npmName: pkg.npmName,
                    title: pkg.title,
                    version: packageJson.version,
                    description: packageJson.description,
                };
            })
        ),
    };
    await writeFile(
        path.join(outputRoot, "manifest.json"),
        JSON.stringify(manifest, null, 4)
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
