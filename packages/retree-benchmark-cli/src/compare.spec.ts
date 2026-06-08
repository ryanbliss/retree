import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCompareArgs, renderBenchmarkComparison } from "./compare";

describe("benchmark compare", () => {
    it("parses compare args after root-script benchmark flags", () => {
        expect(
            parseCompareArgs([
                "--output-dir",
                "benchmarks/results",
                "compare",
                "AFTER-PHASE-1",
                "AFTER-PHASE-2",
            ])
        ).toEqual({
            leftName: "AFTER-PHASE-1",
            outputDir: "benchmarks/results",
            rightName: "AFTER-PHASE-2",
            verbose: false,
        });
    });

    it("parses --compare as a compare alias with verbose output", () => {
        expect(
            parseCompareArgs([
                "--output-dir=benchmarks/results",
                "--compare",
                "AFTER-PHASE-1",
                "AFTER-PHASE-2.1",
                "--verbose",
            ])
        ).toEqual({
            leftName: "AFTER-PHASE-1",
            outputDir: "benchmarks/results",
            rightName: "AFTER-PHASE-2.1",
            verbose: true,
        });
    });

    it("renders concise compare output by default", async () => {
        const outputDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "retree-benchmark-compare-")
        );
        await fs.writeFile(
            path.join(outputDir, "retree-benchmark-BEFORE.json"),
            JSON.stringify(createFixture(1), null, 4)
        );
        await fs.writeFile(
            path.join(outputDir, "retree-benchmark-AFTER.json"),
            JSON.stringify(createFixture(2), null, 4)
        );

        const rendered = await renderBenchmarkComparison({
            leftName: "BEFORE",
            outputDir,
            rightName: "AFTER",
            verbose: false,
        });

        expect(rendered).toContain("Retree Benchmark Comparison");
        expect(rendered).toContain("Signal Summary");
        expect(rendered).toContain("Direct nodeChanged");
        expect(rendered).toContain("+100.0%");
        expect(rendered).toContain("React Measured Update Breakdown");
        expect(rendered).toContain("React Initial Render Breakdown");
        expect(rendered).toContain("React Effect Lifecycle Breakdown");
        expect(rendered).toContain("React useNode");
        expect(rendered).toContain("react-hook-call");
        expect(rendered).toContain("react-hook-effect-subscribe");
        expect(rendered).not.toContain("Matched Cases");
        expect(rendered).not.toContain("depth Low=2");
    });

    it("renders matched case comparisons in verbose mode", async () => {
        const outputDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "retree-benchmark-compare-")
        );
        await fs.writeFile(
            path.join(outputDir, "retree-benchmark-BEFORE.json"),
            JSON.stringify(createFixture(1), null, 4)
        );
        await fs.writeFile(
            path.join(outputDir, "retree-benchmark-AFTER.json"),
            JSON.stringify(createFixture(2), null, 4)
        );

        const rendered = await renderBenchmarkComparison({
            leftName: "BEFORE",
            outputDir,
            rightName: "AFTER",
            verbose: true,
        });

        expect(rendered).toContain("Matched Cases");
        expect(rendered).toContain("depth Low=2");
    });

    it("renders missing comparison detail metrics as null with NaN deltas", async () => {
        const outputDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "retree-benchmark-compare-")
        );
        await fs.writeFile(
            path.join(outputDir, "retree-benchmark-BEFORE.json"),
            JSON.stringify(
                createFixture(1, {
                    includeReactDetails: false,
                }),
                null,
                4
            )
        );
        await fs.writeFile(
            path.join(outputDir, "retree-benchmark-AFTER.json"),
            JSON.stringify(createFixture(2), null, 4)
        );

        const rendered = await renderBenchmarkComparison({
            leftName: "BEFORE",
            outputDir,
            rightName: "AFTER",
            verbose: false,
        });

        expect(rendered).toContain("null -> 0.500000");
        expect(rendered).toContain("null -> 0.250000");
        expect(rendered).toContain("+NaN%");
    });
});

function createFixture(
    multiplier: number,
    options: { includeReactDetails?: boolean } = {}
) {
    const includeReactDetails = options.includeReactDetails ?? true;
    const benchmarkCase = {
        callbackReadMode: "none",
        commits: 20,
        depth: 2,
        depthTitle: "Low",
        durationsMs: [1 * multiplier, 2 * multiplier],
        frequencyTitle: "Low",
        measurements: [
            {
                durationMs: 1 * multiplier,
                mutationType: "scalar-set",
            },
            {
                durationMs: 2 * multiplier,
                mutationType: "scalar-set",
            },
        ],
        mutationSummaries: [],
        scenarioId: "direct-node-changed",
        scenarioTitle: "Direct nodeChanged",
        setupMeasurements: [],
        setupSummaries: [],
        setupSummary: createSummary(0.5 * multiplier),
        summary: createSummary(multiplier),
        warnings: [],
        width: 1,
        widthTitle: "Low",
    };
    const reactCase = {
        callbackReadMode: "none",
        commits: 20,
        depth: 2,
        depthTitle: "Low",
        durationsMs: [2 * multiplier],
        frequencyTitle: "Low",
        measurements: [
            {
                details: includeReactDetails
                    ? [
                          {
                              durationMs: 0.25 * multiplier,
                              operation: "react-hook-call",
                          },
                          {
                              durationMs: 0.5 * multiplier,
                              operation: "react-component-render",
                          },
                          {
                              durationMs: 1.5 * multiplier,
                              operation: "react-update-outside-component",
                          },
                      ]
                    : undefined,
                durationMs: 2 * multiplier,
                mutationType: "scalar-set",
            },
        ],
        mutationSummaries: [],
        scenarioId: "react-use-node",
        scenarioTitle: "React useNode",
        setupMeasurements: includeReactDetails
            ? [
                  {
                      durationMs: 0.125 * multiplier,
                      operation: "react-hook-effect-subscribe",
                  },
                  {
                      durationMs: 1 * multiplier,
                      operation: "react-root-render",
                  },
              ]
            : [],
        setupSummaries: [],
        setupSummary: createSummary(0.25 * multiplier),
        summary: createSummary(2 * multiplier),
        warnings: [],
        width: 1,
        widthTitle: "Low",
    };
    return {
        metadata: {
            arch: "arm64",
            callbackReadModes: ["none"],
            dependencyDepths: [1, 3, 5],
            dependencyFanouts: [5],
            effectWrites: [1],
            generatedAtIso: `2026-05-28T00:00:0${multiplier}.000Z`,
            listenerFanouts: [5],
            mutationTypes: ["scalar-set"],
            nodeVersion: "v20.0.0",
            parallelWorkers: 1,
            platform: "darwin",
            profileName: "stable",
            reactInitialRenderSamples: 20,
            seed: 422024,
            selectedDepthTiers: ["low"],
            selectedFrequencyTiers: ["low"],
            transactionMutations: [10],
            warmupCommits: 10,
            widthTiers: [
                {
                    key: "low",
                    title: "Low",
                    value: 1,
                },
            ],
        },
        scenarios: [
            {
                cases: [benchmarkCase],
                scenarioId: "direct-node-changed",
                skipped: [],
                title: "Direct nodeChanged",
            },
            {
                cases: [reactCase],
                scenarioId: "react-use-node",
                skipped: [],
                title: "React useNode",
            },
        ],
    };
}

function createSummary(multiplier: number) {
    return {
        averageMeanMs: 1 * multiplier,
        maxMs: 2 * multiplier,
        medianMs: 1 * multiplier,
        minMs: 0.5 * multiplier,
        p95Ms: 1.5 * multiplier,
        samples: 2,
    };
}
