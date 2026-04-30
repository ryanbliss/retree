/// <reference types="vitest/config" />

import path from "node:path";
import { defineConfig as defineViteConfig } from "vite";
import react from "@vitejs/plugin-react";
import { defineConfig as defineVitestConfig, mergeConfig } from "vitest/config";

const rootDir = __dirname;

const viteConfig = defineViteConfig({
    plugins: [react()],
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
                find: "@retreejs/react",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-react/src/index.ts"
                ),
            },
        ],
    },
});

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
                        "packages/retree-core/**/*.spec.ts",
                        "packages/retree-core/**/*.spec.tsx",
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
