import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
    renderConsoleReport,
    renderConsoleSummaryReport,
    renderMarkdownReport,
    renderMarkdownVerboseReport,
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
        const verboseMarkdown = renderMarkdownVerboseReport(
            createExampleResults()
        );

        expect(markdown).toContain("## Legend");
        expect(markdown).toContain("### Scenario legend");
        expect(markdown).toContain("## Scenario Summary");
        expect(markdown).toContain("Ancestor treeChanged fan-out");
        expect(markdown).toContain("### Column legend");
        expect(markdown).toContain("### Setup operation legend");
        expect(markdown).toContain("broad-set-assignment");
        expect(markdown).toContain("React useNode");
        expect(markdown).toContain("react-root-render");
        expect(markdown).toContain("React measured update breakdown");
        expect(markdown).toContain("React initial render breakdown");
        expect(markdown).toContain("React effect lifecycle breakdown");
        expect(markdown).toContain("react-hook-call");
        expect(markdown).toContain("## Direct nodeChanged");
        expect(markdown).toContain("## Root treeChanged");
        expect(markdown).toContain("## runTransaction overhead");
        expect(markdown).toContain("### Matrix summary");
        expect(markdown).toContain("### Transaction comparison");
        expect(markdown).toContain("Unwrapped avg ms");
        expect(markdown).toContain("### Slowest cases");
        expect(markdown).toContain("### Setup operations");
        expect(markdown).toContain("### Slowest setup cases");
        expect(markdown).toContain("### Mutation types");
        expect(verboseMarkdown).toContain(
            "| Scenario           | Depth title | Depth | Width title | Width |"
        );
        expect(verboseMarkdown).toContain(
            "| Direct nodeChanged | Low         | 2     | Low         | 1"
        );
        expect(markdown).toContain("Average/mean ms");
        expect(markdown).toContain("Mutation warnings");
        expect(markdown).toContain("Skipped cases: 1");
        expect(markdown).not.toContain("### All cases");
        expect(verboseMarkdown).toContain(
            "# Retree Benchmark Results (Verbose)"
        );
        expect(verboseMarkdown).toContain("### All cases");
        expect(verboseMarkdown).toContain("Skipped cases:");
        expectTableBlocksToBeAligned(markdown);
        expectTableBlocksToBeAligned(verboseMarkdown);
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
        const verboseMarkdown = await fs.readFile(
            artifacts.verboseMarkdownPath,
            "utf8"
        );
        const latestVerboseMarkdown = await fs.readFile(
            artifacts.latestVerboseMarkdownPath,
            "utf8"
        );

        expect(json.scenarios[0].cases[0].measurements).toHaveLength(2);
        expect(latestJson.metadata.generatedAtIso).toBe(
            json.metadata.generatedAtIso
        );
        expect(latestMarkdown).toContain("# Retree Benchmark Results");
        expect(latestMarkdown).not.toContain("### All cases");
        expect(verboseMarkdown).toContain(
            "# Retree Benchmark Results (Verbose)"
        );
        expect(verboseMarkdown).toContain("### All cases");
        expect(latestVerboseMarkdown).toBe(verboseMarkdown);
        expect(json.scenarios[0].cases[0].setupMeasurements).toHaveLength(4);
        expect(json.analysis.scenarios[0].dimensions.mutationTypes).toEqual([
            "array-push",
            "scalar-set",
        ]);
        expect(json.analysis.scenarios[0].dimensions.setupOperations).toEqual([
            "broad-set-assignment",
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
        expect(
            json.analysis.scenarios[2].transactionComparisonSummaries[0]
        ).toMatchObject({
            savedListenerCallsSummary: {
                averageMeanMs: 9,
            },
            transactionMutations: 10,
        });
        const reactAnalysis = json.analysis.scenarios.find(
            (scenario: { scenarioId: string }) =>
                scenario.scenarioId === "react-use-node"
        );
        const outsideComponentSummary =
            reactAnalysis.measurementDetailSummaries.find(
                (summary: { operation: string }) =>
                    summary.operation === "react-update-outside-component"
            );
        expect(outsideComponentSummary).toMatchObject({
            operation: "react-update-outside-component",
            samples: 1,
        });
    });

    it("renders colorized console tables with aligned visible widths", () => {
        const report = renderConsoleReport(
            {
                jsonPath: "/tmp/results.json",
                latestJsonPath: "/tmp/retree-benchmark-latest.json",
                latestMarkdownPath: "/tmp/retree-benchmark-latest.md",
                latestVerboseMarkdownPath:
                    "/tmp/retree-benchmark-latest.verbose.md",
                markdownPath: "/tmp/results.md",
                verboseMarkdownPath: "/tmp/results.verbose.md",
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
                latestVerboseMarkdownPath:
                    "/tmp/retree-benchmark-latest.verbose.md",
                markdownPath: "/tmp/results.md",
                verboseMarkdownPath: "/tmp/results.verbose.md",
            },
            createExampleResults()
        );

        expect(report).toContain(
            "full scenario tables were written to the verbose Markdown report"
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
            reactInitialRenderSamples: 20,
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
                                durationMs: 0.25,
                                operation: "broad-set-assignment",
                            },
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
                                ...summarizeDurations([0.25]),
                                operation: "broad-set-assignment",
                            },
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
            {
                cases: [
                    {
                        callbackReadMode: "none",
                        commits: 2,
                        depth: 2,
                        depthTitle: "Low",
                        durationsMs: [0, 0],
                        frequencyTitle: "Low",
                        measurements: [
                            {
                                durationMs: 0,
                                mutationType: "scalar-set",
                                transactionComparison: {
                                    overheadMs: 0,
                                    savedDurationMs: 2,
                                    savedListenerCalls: 9,
                                    signedDeltaMs: -2,
                                    transactionDurationMs: 1,
                                    transactionListenerCalls: 1,
                                    unwrappedDurationMs: 3,
                                    unwrappedListenerCalls: 10,
                                },
                            },
                            {
                                durationMs: 0,
                                mutationType: "array-push",
                                transactionComparison: {
                                    overheadMs: 0,
                                    savedDurationMs: 4,
                                    savedListenerCalls: 9,
                                    signedDeltaMs: -4,
                                    transactionDurationMs: 2,
                                    transactionListenerCalls: 1,
                                    unwrappedDurationMs: 6,
                                    unwrappedListenerCalls: 10,
                                },
                            },
                        ],
                        mutationSummaries: [
                            {
                                ...summarizeDurations([0]),
                                mutationType: "scalar-set",
                            },
                            {
                                ...summarizeDurations([0]),
                                mutationType: "array-push",
                            },
                        ],
                        scenarioId: "run-transaction",
                        scenarioTitle: "runTransaction overhead",
                        setupMeasurements: [
                            {
                                durationMs: 1,
                                operation: "case-setup-total",
                            },
                        ],
                        setupSummaries: [
                            {
                                ...summarizeDurations([1]),
                                operation: "case-setup-total",
                            },
                        ],
                        setupSummary: summarizeDurations([1]),
                        summary: summarizeDurations([0, 0]),
                        transactionMutations: 10,
                        warnings: [],
                        width: 1,
                        widthTitle: "Low",
                    },
                ],
                scenarioId: "run-transaction",
                skipped: [],
                title: "runTransaction overhead",
            },
            {
                cases: [
                    {
                        callbackReadMode: "deep",
                        commits: 1,
                        depth: 2,
                        depthTitle: "Low",
                        durationsMs: [2],
                        frequencyTitle: "Low",
                        measurements: [
                            {
                                details: [
                                    {
                                        durationMs: 0.5,
                                        operation: "react-hook-call",
                                    },
                                    {
                                        durationMs: 0.25,
                                        operation: "react-hook-render-read",
                                    },
                                    {
                                        durationMs: 1,
                                        operation: "react-component-render",
                                    },
                                    {
                                        durationMs: 1,
                                        operation:
                                            "react-update-outside-component",
                                    },
                                ],
                                durationMs: 2,
                                mutationType: "scalar-set",
                            },
                        ],
                        mutationSummaries: [
                            {
                                ...summarizeDurations([2]),
                                mutationType: "scalar-set",
                            },
                        ],
                        scenarioId: "react-use-node",
                        scenarioTitle: "React useNode",
                        setupMeasurements: [
                            {
                                durationMs: 0.1,
                                operation: "react-hook-effect-subscribe",
                            },
                            {
                                durationMs: 1,
                                operation: "react-root-render",
                            },
                        ],
                        setupSummaries: [
                            {
                                ...summarizeDurations([0.1]),
                                operation: "react-hook-effect-subscribe",
                            },
                            {
                                ...summarizeDurations([1]),
                                operation: "react-root-render",
                            },
                        ],
                        setupSummary: summarizeDurations([0.1, 1]),
                        summary: summarizeDurations([2]),
                        warnings: [],
                        width: 1,
                        widthTitle: "Low",
                    },
                ],
                scenarioId: "react-use-node",
                skipped: [],
                title: "React useNode",
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
