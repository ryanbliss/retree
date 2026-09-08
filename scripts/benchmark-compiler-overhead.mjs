#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline =
    process.argv[2] ??
    execFileSync("git", ["merge-base", "HEAD", "origin/main"], {
        cwd: root,
        encoding: "utf8",
    }).trim();
const temporary = await mkdtemp(join(tmpdir(), "retree-compiler-overhead-"));
const count = 100_000;
const rounds = 5;
const median = (values) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

try {
    const oldRoot = join(temporary, "baseline");
    await mkdir(oldRoot);
    execFileSync("tar", ["-x", "-C", oldRoot], {
        input: execFileSync(
            "git",
            ["archive", baseline, "packages/retree-core"],
            { cwd: root, maxBuffer: 32 * 1024 * 1024 }
        ),
    });
    const variants = [
        { name: "baseline", directory: oldRoot, runtime: false },
        { name: "compiler-off", directory: root, runtime: false },
        { name: "runtime-loaded", directory: root, runtime: true },
    ];
    const result = { baseline, count, rounds, variants: [] };
    for (const variant of variants) {
        const source = join(variant.directory, "packages/retree-core/src");
        const imports =
            `export * from ${JSON.stringify(join(source, "index.ts"))};\n` +
            (variant.runtime
                ? `export { defineCompiledNode } from ${JSON.stringify(
                      join(source, "compiler-runtime.ts")
                  )};`
                : "");
        const options = {
            absWorkingDir: root,
            bundle: true,
            format: "esm",
            target: "es2022",
            nodePaths: [join(root, "node_modules")],
            write: false,
        };
        const bundle = await build({
            ...options,
            stdin: { contents: imports, resolveDir: root },
            platform: "browser",
            minify: true,
            metafile: true,
        });
        const containsRuntime = Object.keys(bundle.metafile.inputs).some(
            (file) => file.endsWith("internals/compiled-node.ts")
        );
        assert.equal(
            containsRuntime,
            variant.runtime,
            `${variant.name}: optional runtime import boundary`
        );
        const output = bundle.outputFiles[0].contents;
        const worker = `
import { Retree } from ${JSON.stringify(join(source, "index.ts"))};
${
    variant.runtime
        ? `import { defineCompiledNode } from ${JSON.stringify(
              join(source, "compiler-runtime.ts")
          )}; globalThis.optionalRuntime = defineCompiledNode;`
        : ""
}
function materialize(size) {
    const tree = Retree.root({ rows: Array.from({ length: size }, (_, value) => ({ value, nested: { value } })) });
    let sum = 0;
    for (const row of tree.rows) sum += row.value + row.nested.value;
    if (sum !== size * (size - 1)) throw new Error("Materialization checksum mismatch");
    return tree;
}
materialize(2000);
global.gc(); global.gc();
const before = process.memoryUsage().heapUsed;
globalThis.heldTree = materialize(${count});
global.gc(); global.gc();
console.log(JSON.stringify({ retainedBytes: process.memoryUsage().heapUsed - before }));
`;
        const executable = await build({
            ...options,
            stdin: { contents: worker, resolveDir: root },
            platform: "node",
        });
        variant.file = join(temporary, `${variant.name}.mjs`);
        await writeFile(variant.file, executable.outputFiles[0].contents);
        variant.samples = [];
        result.variants.push({
            name: variant.name,
            bundleBytes: output.length,
            gzipBytes: gzipSync(output).length,
            containsRuntime,
        });
    }
    // Separate processes avoid retained state; reverse order on alternating rounds.
    for (let round = 0; round < rounds; round++) {
        for (const variant of round % 2 ? [...variants].reverse() : variants) {
            const sample = JSON.parse(
                execFileSync(process.execPath, ["--expose-gc", variant.file], {
                    encoding: "utf8",
                })
            );
            variant.samples.push(sample.retainedBytes);
        }
    }
    for (let index = 0; index < variants.length; index++) {
        result.variants[index].retainedBytes = variants[index].samples;
        result.variants[index].medianRetainedBytes = median(
            variants[index].samples
        );
    }
    console.log(JSON.stringify(result, null, 2));
} finally {
    await rm(temporary, { recursive: true, force: true });
}
