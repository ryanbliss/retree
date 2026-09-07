/// <reference types="vitest/config" />

import { readFile } from "node:fs/promises";
import path from "node:path";
import { transformAsync as transformWithBabel } from "@babel/core";
import { transform as transformWithEsbuild } from "esbuild";
import retreeCompiler from "./packages/retree-babel-plugin-compiler/src/index.js";
import { defineConfig as defineViteConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
    configDefaults,
    defineConfig as defineVitestConfig,
    mergeConfig,
} from "vitest/config";

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
                find: "@retreejs/core/compiler-runtime",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-core/src/compiler-runtime.ts"
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
                find: "@retreejs/query",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-query/src/index.ts"
                ),
            },
            {
                find: "@retreejs/devtools",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-devtools/src/index.ts"
                ),
            },
            {
                find: "@retreejs/react/benchmark",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-react/src/index.benchmark.ts"
                ),
            },
            {
                find: "@retreejs/react/testing",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-react/src/testing/index.ts"
                ),
            },
            {
                find: "@retreejs/react",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-react/src/index.ts"
                ),
            },
            {
                find: "@retreejs/react-convex",
                replacement: path.resolve(
                    rootDir,
                    "packages/retree-react-convex/src/index.ts"
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

/**
 * Runs the ReactiveNode compiler over core spec files so the compiled
 * managed-class path is covered by the same suite as the Proxy path.
 */
function compileReactiveNodesForVitest(): Plugin {
    const coreDir = path.resolve(rootDir, "packages/retree-core/src");
    const coreModules = [
        "@retreejs/core",
        "./index.js",
        "../index.js",
        "./ReactiveNode.js",
        "../ReactiveNode.js",
        "./decorators.js",
        "../decorators.js",
    ];
    return {
        name: "retree-compile-reactive-nodes-for-vitest",
        enforce: "pre",
        // A load hook runs before the esbuild decorator transform above.
        async load(id: string) {
            if (!id.startsWith(coreDir) || !/\.spec\.tsx?$/.test(id)) {
                return null;
            }
            const code = await readFile(id, "utf8");
            const result = await transformWithBabel(code, {
                filename: id,
                babelrc: false,
                configFile: false,
                sourceMaps: true,
                presets: [
                    [
                        "@babel/preset-typescript",
                        { allExtensions: true, isTSX: id.endsWith("x") },
                    ],
                ],
                plugins: [
                    [retreeCompiler, { coreModules }],
                    [
                        "@babel/plugin-proposal-decorators",
                        { version: "2023-11" },
                    ],
                ],
            });
            if (
                result === null ||
                result.code === null ||
                result.code === undefined
            ) {
                return null;
            }
            return { code: result.code, map: result.map ?? undefined };
        },
    };
}

const coreSpecPattern = /packages\/retree-core\/src\/.*\.spec\.tsx?$/;

const compiledProjectEnabled = process.env.RETREE_SKIP_COMPILED_PROJECT !== "1";

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
                        "packages/retree-babel-plugin-compiler/**/*.spec.ts",
                        "packages/retree-core/**/*.spec.ts",
                        "packages/retree-core/**/*.spec.tsx",
                        "packages/retree-convex/**/*.spec.ts",
                        "packages/retree-create/**/*.spec.ts",
                        "packages/retree-devtools/**/*.spec.ts",
                        "packages/retree-react-eslint-plugin/**/*.spec.ts",
                        "packages/retree-query/**/*.spec.ts",
                        "packages/retree-react-convex/**/*.spec.ts",
                        "scripts/**/*.spec.mjs",
                    ],
                    environment: "node",
                },
            },
            ...(compiledProjectEnabled
                ? [
                      {
                          extends: true,
                          plugins: [compileReactiveNodesForVitest()],
                          // Babel already lowered these files; oxc would
                          // re-lower class fields under the es2020 target.
                          oxc: {
                              exclude: [coreSpecPattern],
                              jsxRefreshExclude: [coreSpecPattern],
                          },
                          test: {
                              name: "core-compiled",
                              env: { RETREE_COMPILED_SPECS: "1" },
                              include: [
                                  "packages/retree-core/**/*.spec.ts",
                                  "packages/retree-core/**/*.spec.tsx",
                              ],
                              environment: "node",
                          },
                      } as const,
                  ]
                : []),
            {
                extends: true,
                test: {
                    name: "react-and-samples",
                    exclude: [
                        ...configDefaults.exclude,
                        "**/useRaw.perf.spec.tsx",
                    ],
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
