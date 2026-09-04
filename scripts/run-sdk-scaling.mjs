#!/usr/bin/env node
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "retree-sdk-scaling-"));
try {
    const outfile = join(directory, "benchmark.mjs");
    await build({
        entryPoints: [join(root, "benchmarks/sdk-scaling.mts")],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        define: { "process.env.NODE_ENV": '"production"' },
        alias: {
            "@retreejs/core/internal": join(
                root,
                "packages/retree-core/src/internals/index.ts"
            ),
            "@retreejs/core": join(root, "packages/retree-core/src/index.ts"),
        },
    });
    await import(pathToFileURL(outfile).href);
} finally {
    await rm(directory, { recursive: true, force: true });
}
