import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(packageDir, "../..");

export default defineConfig({
    resolve: {
        alias: [
            {
                find: "@retreejs/core/internal",
                replacement: path.resolve(
                    repoDir,
                    "packages/retree-core/src/internals/index.ts"
                ),
            },
            {
                find: "@retreejs/core",
                replacement: path.resolve(
                    repoDir,
                    "packages/retree-core/src/index.ts"
                ),
            },
            {
                find: "@retreejs/react/benchmark",
                replacement: path.resolve(
                    repoDir,
                    "packages/retree-react/src/index.benchmark.ts"
                ),
            },
            {
                find: "@retreejs/react",
                replacement: path.resolve(
                    repoDir,
                    "packages/retree-react/src/index.ts"
                ),
            },
        ],
    },
    build: {
        outDir: "bin",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                cli: path.resolve(packageDir, "src/cli.ts"),
                index: path.resolve(packageDir, "src/index.ts"),
                "scenario-worker": path.resolve(
                    packageDir,
                    "src/scenario-worker.ts"
                ),
            },
            output: {
                banner: (chunk) =>
                    chunk.fileName === "cli.js" ? "#!/usr/bin/env node" : "",
                entryFileNames: "[name].js",
                chunkFileNames: "chunks/[name]-[hash].js",
                format: "es",
            },
        },
        sourcemap: true,
        ssr: true,
        target: "node22",
    },
});
