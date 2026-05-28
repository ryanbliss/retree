import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    renderConsoleReport,
    renderConsoleSummaryReport,
    renderMarkdownReport,
    writeBenchmarkArtifacts,
} from "./report";
import { summarizeDurations } from "./stats";
import { BenchmarkResults } from "./types";

describe("benchmark stats and reports", () => {
    it("summarizes raw durations", () => {
        expect(summarizeDurations([3, 1, 4, 2])).toEqual({
            averageMeanMs: 2.5,
            maxMs: 4,
            medianMs: 2,
            minMs: 1,
            p95Ms: 4,
            samples: 4,
        });
    });

    it("renders one Markdown result table per scenario", () => {
        const markdown = renderMarkdownReport(createExampleResults());

        expect(markdown).toContain("## Legend");
        expect(markdown).toContain("### Scenario legend");
        expect(markdown).toContain("Ancestor treeChanged fan-out");
        expect(markdown).toContain("### Column legend");
        expect(markdown).toContain("### Setup operation legend");
        expect(markdown).toContain("## Direct nodeChanged");
        expect(markdown).toContain("## Root treeChanged");
        expect(markdown).toContain("### Matrix summary");
        expect(markdown).toContain("### Slowest cases");
        expect(markdown).toContain("### Setup operations");
        expect(markdown).toContain("### Slowest setup cases");
        expect(markdown).toContain("### Mutation types");
        expect(markdown).toContain(
            "| Scenario           | Depth title | Depth | Width title | Width |"
        );
        expect(markdown).toContain(
            "| Direct nodeChanged | Low         | 2     | Low         | 1"
        );
        expect(markdown).toContain("Average/mean ms");
        expect(markdown).toContain("Mutation warnings");
        expect(markdown).toContain("Skipped cases:");
        expectTableBlocksToBeAligned(markdown);
    });

    it("writes JSON analysis alongside raw case measurements", async () => {
        const outputDir = await fs.mkdtemp(
            path.join(os.tmpdir(), "retree-benchmark-report-")
        );
        const artifacts = await writeBenchmarkArtifacts(
            createExampleResults(),
            outputDir
        );
        const json = JSON.parse(await fs.readFile(artifacts.jsonPath, "utf8"));
        const latestJson = JSON.parse(
            await fs.readFile(artifacts.latestJsonPath, "utf8")
        );
        const latestMarkdown = await fs.readFile(
            artifacts.latestMarkdownPath,
            "utf8"
        );

        expect(json.scenarios[0].cases[0].measurements).toHaveLength(2);
        expect(latestJson.metadata.generatedAtIso).toBe(
            json.metadata.generatedAtIso
        );
        expect(latestMarkdown).toContain("# Retree Benchmark Results");
        expect(json.scenarios[0].cases[0].setupMeasurements).toHaveLength(3);
        expect(json.analysis.scenarios[0].dimensions.mutationTypes).toEqual([
            "array-push",
            "scalar-set",
        ]);
        expect(json.analysis.scenarios[0].dimensions.setupOperations).toEqual([
            "case-setup-total",
            "raw-tree-construction",
            "root-proxy",
        ]);
        expect(json.analysis.scenarios[0].mutationSummaries[0]).toMatchObject({
            mutationType: "array-push",
            samples: 1,
        });
        expect(json.analysis.scenarios[0].slowestCases[0]).toMatchObject({
            scenarioDetail: "base",
        });
        expect(json.analysis.scenarios[0].slowestSetupCases[0]).toMatchObject({
            scenarioDetail: "base",
            slowestSetupOperation: "case-setup-total (7.000000 ms P95)",
        });
    });

    it("renders colorized console tables with aligned visible widths", () => {
        const report = renderConsoleReport(
            {
                jsonPath: "/tmp/results.json",
                latestJsonPath: "/tmp/retree-benchmark-latest.json",
                latestMarkdownPath: "/tmp/retree-benchmark-latest.md",
                markdownPath: "/tmp/results.md",
            },
            createExampleResults()
        );

        expect(report).toContain("\x1b[1;36mRetree Benchmark Results\x1b[0m");
        expect(report).toContain("\x1b[1mJSON results:\x1b[0m");
        expect(report).toContain("\x1b[1mLatest aliases:\x1b[0m");
        expect(report).toContain("\x1b[1;35mDirect nodeChanged\x1b[0m");
        expect(report).toContain("\x1b[1;36mScenario");
        expect(report).toContain("\x1b[33mToo deep");
        expectTableBlocksToBeAligned(report);
    });

    it("renders a compact console summary without every case row", () => {
        const report = renderConsoleSummaryReport(
            {
                jsonPath: "/tmp/results.json",
                latestJsonPath: "/tmp/retree-benchmark-latest.json",
                latestMarkdownPath: "/tmp/retree-benchmark-latest.md",
                markdownPath: "/tmp/results.md",
            },
            createExampleResults()
        );

        expect(report).toContain(
            "Full scenario tables were written to Markdown."
        );
        expect(report).toContain("Direct nodeChanged");
        expect(report).toContain("Cases");
        expect(report).not.toContain("Dependency depth");
        expectTableBlocksToBeAligned(report);
    });
});

function createExampleResults(): BenchmarkResults {
    return {
        metadata: {
            arch: "arm64",
            callbackReadModes: ["none"],
            dependencyDepths: [1, 3, 5],
            dependencyFanouts: [10],
            effectWrites: [1],
            generatedAtIso: "2026-05-27T00:00:00.000Z",
            listenerFanouts: [10],
            mutationTypes: ["scalar-set", "array-push"],
            nodeVersion: "v22.13.1",
            parallelWorkers: 1,
            platform: "darwin 24.0.0",
            profileName: "stable",
            seed: 1,
            selectedDepthTiers: ["low"],
            selectedFrequencyTiers: ["low"],
            transactionMutations: [10],
            warmupCommits: 1,
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
                cases: [
                    {
                        callbackReadMode: "none",
                        commits: 2,
                        depth: 2,
                        depthTitle: "Low",
                        durationsMs: [1, 2],
                        frequencyTitle: "Low",
                        measurements: [
                            {
                                durationMs: 1,
                                mutationType: "scalar-set",
                            },
                            {
                                durationMs: 2,
                                mutationType: "array-push",
                            },
                        ],
                        mutationSummaries: [
                            {
                                ...summarizeDurations([1]),
                                mutationType: "scalar-set",
                            },
                            {
                                ...summarizeDurations([2]),
                                mutationType: "array-push",
                            },
                        ],
                        scenarioId: "direct-node-changed",
                        scenarioTitle: "Direct nodeChanged",
                        setupMeasurements: [
                            {
                                durationMs: 3,
                                operation: "raw-tree-construction",
                            },
                            {
                                durationMs: 4,
                                operation: "root-proxy",
                            },
                            {
                                durationMs: 7,
                                operation: "case-setup-total",
                            },
                        ],
                        setupSummaries: [
                            {
                                ...summarizeDurations([3]),
                                operation: "raw-tree-construction",
                            },
                            {
                                ...summarizeDurations([4]),
                                operation: "root-proxy",
                            },
                            {
                                ...summarizeDurations([7]),
                                operation: "case-setup-total",
                            },
                        ],
                        setupSummary: summarizeDurations([3, 4, 7]),
                        summary: summarizeDurations([1, 2]),
                        warnings: [],
                        width: 1,
                        widthTitle: "Low",
                    },
                ],
                scenarioId: "direct-node-changed",
                skipped: [],
                title: "Direct nodeChanged",
            },
            {
                cases: [],
                scenarioId: "root-tree-changed",
                skipped: [
                    {
                        callbackReadMode: "none",
                        commits: 2,
                        dependencyDepth: 3,
                        depth: 2,
                        depthTitle: "Low",
                        frequencyTitle: "Low",
                        reason: "Too deep",
                        scenarioId: "root-tree-changed",
                        scenarioTitle: "Root treeChanged",
                        width: 1,
                        widthTitle: "Low",
                    },
                ],
                title: "Root treeChanged",
            },
        ],
    };
}

function expectTableBlocksToBeAligned(report: string) {
    const tableBlocks = extractTableBlocks(report);
    expect(tableBlocks.length).toBeGreaterThan(0);

    for (const block of tableBlocks) {
        const visibleWidths = block.map((line) => stripAnsi(line).length);
        expect(new Set(visibleWidths).size).toBe(1);
    }
}

function extractTableBlocks(report: string) {
    const blocks: string[][] = [];
    let currentBlock: string[] = [];

    for (const line of report.split("\n")) {
        if (stripAnsi(line).startsWith("|")) {
            currentBlock.push(line);
            continue;
        }
        if (currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [];
        }
    }

    if (currentBlock.length > 0) {
        blocks.push(currentBlock);
    }

    return blocks;
}

function stripAnsi(value: string) {
    const ansiEscape = String.fromCharCode(27);
    return value.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
}
