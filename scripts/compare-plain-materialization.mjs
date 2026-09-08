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
    ["registry-off", baseline, "0"],
    ["registry-on", baseline, "1"],
    ["footprint-off", repo, "0"],
    ["footprint-on", repo, "1"],
];
const runs = [];
for (let block = 0; block < 8; block++) {
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
                    RETREE_COMPILER: enabled,
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
                    base: "412c83c161d94f49801be385a060c6d73acb2273",
                    runs,
                },
                null,
                2
            )
        );
        console.log(block, variant);
    }
}
