#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referencesDir = resolve(rootDir, "skills/retree/references");

const references = [
    {
        output: "llms.md",
        title: "Retree LLM Guide",
        source: "llms.txt",
        note: "Generated from the root llms.txt routing guide.",
    },
    {
        output: "repository.md",
        title: "Retree Repository README",
        source: "README.md",
        note: "Generated from the repository README used by TypeDoc as the docs home page.",
    },
    {
        output: "core.md",
        title: "@retreejs/core README",
        source: "packages/retree-core/README.md",
        note: "Generated from the core package README used by TypeDoc package docs.",
    },
    {
        output: "react.md",
        title: "@retreejs/react README",
        source: "packages/retree-react/README.md",
        note: "Generated from the React package README used by TypeDoc package docs.",
    },
    {
        output: "convex.md",
        title: "@retreejs/convex README",
        source: "packages/retree-convex/README.md",
        note: "Generated from the Convex package README used by TypeDoc package docs.",
    },
    {
        output: "query.md",
        title: "@retreejs/query README",
        source: "packages/retree-query/README.md",
        note: "Generated from the backend-agnostic query package README.",
    },
    {
        output: "devtools.md",
        title: "@retreejs/devtools README",
        source: "packages/retree-devtools/README.md",
        note: "Generated from the devtools package README.",
    },
    {
        output: "react-convex.md",
        title: "@retreejs/react-convex README",
        source: "packages/retree-react-convex/README.md",
        note: "Generated from the React Convex package README used by TypeDoc package docs.",
    },
    {
        output: "benchmark-cli.md",
        title: "@retreejs/benchmark-cli README",
        source: "packages/retree-benchmark-cli/README.md",
        note: "Generated from the benchmark CLI package README.",
    },
];

mkdirSync(referencesDir, { recursive: true });

for (const reference of references) {
    const sourcePath = resolve(rootDir, reference.source);
    const outputPath = resolve(referencesDir, reference.output);
    const body = readFileSync(sourcePath, "utf8");
    const content = [
        `# ${reference.title}`,
        "",
        `> ${reference.note}`,
        `> Source: \`${reference.source}\``,
        "",
        body.trimEnd(),
        "",
    ].join("\n");

    writeFileSync(outputPath, content);
    console.log(
        `Synced ${relative(rootDir, outputPath)} from ${reference.source}.`
    );
}
