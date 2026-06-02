/// <reference types="vitest/config" />

import path from "node:path";
import { transform as transformWithEsbuild } from "esbuild";
import { defineConfig as defineViteConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig as defineVitestConfig, mergeConfig } from "vitest/config";

const rootDir = __dirname;

const viteConfig = defineViteConfig({
    plugins: [react(), transformDecoratorsForVitest()],
    oxc: {
        jsx: {
            runtime: "automatic",
            importSource: "react",
        },
    },
    resolve: {
        preserveSymlinks: true,
        alias: [
            {
                find: "@retreejs/core/internal",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-core/src/internals/index.ts"
                ),
            },
            {
                find: "@retreejs/core",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-core/src/index.ts"
                ),
            },
            {
                find: "@retreejs/convex",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-convex/src/index.ts"
                ),
            },
            {
                find: "@retreejs/react",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-react/src/index.ts"
                ),
            },
        ],
    },
});

function transformDecoratorsForVitest(): Plugin {
    return {
        name: "retree-transform-decorators-for-vitest",
        enforce: "pre",
        async transform(code: string, id: string) {
            if (!/\.[cm]?[jt]sx?$/.test(id)) {
                return null;
            }
            if (!/^\s*@/m.test(code)) {
                return null;
            }
            const result = await transformWithEsbuild(code, {
                loader: id.endsWith("x") ? "tsx" : "ts",
                jsx: "automatic",
                jsxImportSource: "react",
                sourcefile: id,
                sourcemap: true,
                target: "es2022",
            });
            return {
                code: result.code,
                map: result.map,
            };
        },
    };
}

const vitestConfig = defineVitestConfig({
    test: {
        setupFiles: ["./vitest.setup.ts"],
        restoreMocks: true,
        clearMocks: true,
        projects: [
            {
                extends: true,
                test: {
                    name: "core",
                    include: [
                        "packages/retree-benchmark-cli/**/*.spec.ts",
                        "packages/retree-core/**/*.spec.ts",
                        "packages/retree-core/**/*.spec.tsx",
                        "packages/retree-convex/**/*.spec.ts",
                    ],
                    environment: "node",
                },
            },
            {
                extends: true,
                test: {
                    name: "react-and-samples",
                    include: [
                        "packages/retree-react/**/*.spec.ts",
                        "packages/retree-react/**/*.spec.tsx",
                        "samples/**/*.spec.ts",
                        "samples/**/*.spec.tsx",
                    ],
                    environment: "jsdom",
                },
            },
        ],
    },
});

export default mergeConfig(viteConfig, vitestConfig);
