#!/usr/bin/env node
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = process.argv[2] ?? "benchmarks/sdk-scaling.mts";
// RETREE_COMPILER=1 runs the ReactiveNode compiler over the benchmark
// sources so the same scenarios measure the compiled path.
const useCompiler = process.env.RETREE_COMPILER === "1";
const directory = await mkdtemp(join(tmpdir(), "retree-benchmark-"));
const alias = {
    "@retreejs/core/compiler-runtime": join(
        root,
        "packages/retree-core/src/compiler-runtime.ts"
    ),
    "@retreejs/core/internal": join(
        root,
        "packages/retree-core/src/internals/index.ts"
    ),
    "@retreejs/core": join(root, "packages/retree-core/src/index.ts"),
};

async function compileReactiveNodesPlugin() {
    const pluginFile = join(directory, "retree-compiler.mjs");
    await build({
        entryPoints: [
            join(root, "packages/retree-babel-plugin-compiler/src/index.ts"),
        ],
        outfile: pluginFile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
    });
    const [{ transformAsync }, { default: retreeCompiler }] = await Promise.all(
        [import("@babel/core"), import(pathToFileURL(pluginFile).href)]
    );
    return {
        name: "retree-compiler",
        setup(api) {
            api.onLoad({ filter: /benchmarks\/.*\.mts$/ }, async (args) => {
                const source = await readFile(args.path, "utf8");
                const result = await transformAsync(source, {
                    filename: args.path,
                    babelrc: false,
                    configFile: false,
                    sourceMaps: false,
                    presets: [
                        ["@babel/preset-typescript", { allExtensions: true }],
                    ],
                    plugins: [
                        ...(["prepared", "inline"].includes(
                            process.env.RETREE_DIRECT_CALLS
                        )
                            ? [
                                  [
                                      (
                                          await import(
                                              pathToFileURL(
                                                  join(
                                                      root,
                                                      "benchmarks/test-fixtures/method-call-compiler.mjs"
                                                  )
                                              ).href
                                          )
                                      ).default,
                                      {
                                          strategy:
                                              process.env.RETREE_DIRECT_CALLS,
                                          runtimeModule: join(
                                              root,
                                              "benchmarks/test-fixtures/method-call-runtime.mts"
                                          ),
                                          coreModules: [
                                              "@retreejs/core",
                                              "../packages/retree-core/src/index.js",
                                          ],
                                      },
                                  ],
                              ]
                            : []),
                        [
                            retreeCompiler,
                            {
                                coreModules: [
                                    "@retreejs/core",
                                    "../packages/retree-core/src/index.js",
                                ],
                            },
                        ],
                        [
                            "@babel/plugin-proposal-decorators",
                            { version: "2023-11" },
                        ],
                    ],
                });
                return { contents: result.code, loader: "js" };
            });
        },
    };
}

try {
    const outfile = join(directory, "benchmark.mjs");
    await build({
        entryPoints: [join(root, entry)],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        // A concrete target makes esbuild lower standard decorators.
        target: "node22",
        define: { "process.env.NODE_ENV": '"production"' },
        alias,
        plugins: useCompiler ? [await compileReactiveNodesPlugin()] : [],
    });
    await import(pathToFileURL(outfile).href);
} finally {
    await rm(directory, { recursive: true, force: true });
}
