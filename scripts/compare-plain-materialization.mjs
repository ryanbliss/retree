import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const repo = process.cwd();
const baseline = process.argv[2];
const output = process.argv[3];
if (!baseline || !output)
    throw Error(
        "Usage: node scripts/compare-plain-materialization.mjs BASELINE_DIRECTORY OUTPUT_JSON"
    );
const variants = [
    ["103", baseline, "0"],
    ["routing-only", repo, "0"],
    ["facade", repo, "1"],
];
const runs = [];
for (let block = 0; block < 6; block++) {
    const order = block % 2 ? [...variants].reverse() : variants;
    for (const [variant, cwd, enabled] of order) {
        const start = performance.now();
        const r = spawnSync(
            process.execPath,
            [
                "--expose-gc",
                "scripts/run-sdk-scaling.mjs",
                "benchmarks/plain-materialization.mts",
            ],
            {
                cwd,
                env: {
                    ...process.env,
                    RETREE_COMPILER: "1",
                    RETREE_PLAIN_FACADES: enabled,
                },
                encoding: "utf8",
            }
        );
        if (r.status !== 0) throw Error(r.stderr);
        runs.push({
            block,
            variant,
            processMs: performance.now() - start,
            measurements: r.stdout.trim().split("\n").map(JSON.parse),
        });
        writeFileSync(
            output,
            JSON.stringify(
                {
                    node: process.version,
                    base: "93ba2bfbc15d7d68389b1493756c72d44f488710",
                    runs,
                },
                null,
                2
            )
        );
        console.log(block, variant);
    }
}
