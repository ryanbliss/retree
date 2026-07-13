import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OUTPUT_DIR } from "./config";
import {
    BenchmarkCaseResult,
    BenchmarkMeasurementDetailOperation,
    BenchmarkResults,
    BenchmarkScenarioResult,
    BenchmarkSummary,
    BenchmarkSetupOperation,
} from "./types";

export interface ParsedCompareArgs {
    leftName: string;
    outputDir: string;
    rightName: string;
    verbose: boolean;
}

interface BenchmarkJsonResults extends BenchmarkResults {
    analysis?: {
        scenarios?: BenchmarkAnalysisScenario[];
    };
}

interface BenchmarkAnalysisScenario {
    measurementDetailSummaries?: BenchmarkOperationSummary[];
    scenarioId: string;
    setupSummaries?: BenchmarkOperationSummary[];
    summary: BenchmarkScenarioAnalysisSummary;
    title: string;
}

interface BenchmarkOperationSummary extends BenchmarkSummary {
    operation: string;
}

interface BenchmarkScenarioAnalysisSummary {
    averageMeanMs: number;
    medianMs: number;
    p95Ms: number;
    samples: number;
    setupAverageMeanMs: number;
    setupP95Ms: number;
    setupSamples: number;
    warnings: number;
}

export function parseCompareArgs(argv: string[]): ParsedCompareArgs {
    const compareIndex = findCompareIndex(argv);
    const compareArgs =
        compareIndex === -1 ? argv : argv.slice(compareIndex + 1);
    const prefixArgs = compareIndex === -1 ? [] : argv.slice(0, compareIndex);
    let outputDir = readOutputDir(prefixArgs) ?? DEFAULT_OUTPUT_DIR;
    const names: string[] = [];
    let verbose = false;

    for (let index = 0; index < compareArgs.length; index++) {
        const current = compareArgs[index];
        if (current === "--verbose") {
            verbose = true;
            continue;
        }
        if (current === "--output-dir") {
            const value = compareArgs[index + 1];
            if (value === undefined) {
                throw new Error("compare --output-dir requires a value.");
            }
            outputDir = value;
            index++;
            continue;
        }
        if (current.startsWith("--output-dir=")) {
            outputDir = current.slice("--output-dir=".length);
            if (outputDir.length === 0) {
                throw new Error("compare --output-dir requires a value.");
            }
            continue;
        }
        if (current.startsWith("--")) {
            throw new Error(`Unknown benchmark compare option: ${current}`);
        }
        names.push(current);
    }

    if (names.length !== 2) {
        throw new Error(
            "benchmark compare requires exactly two artifact names or JSON paths."
        );
    }

    return {
        leftName: names[0],
        outputDir,
        rightName: names[1],
        verbose,
    };
}

function findCompareIndex(argv: string[]) {
    const subcommandIndex = argv.indexOf("compare");
    const flagIndex = argv.indexOf("--compare");
    if (subcommandIndex === -1) {
        return flagIndex;
    }
    if (flagIndex === -1) {
        return subcommandIndex;
    }
    return Math.min(subcommandIndex, flagIndex);
}

export async function renderBenchmarkComparison(args: ParsedCompareArgs) {
    const leftPath = await resolveBenchmarkJsonPath(
        args.outputDir,
        args.leftName
    );
    const rightPath = await resolveBenchmarkJsonPath(
        args.outputDir,
        args.rightName
    );
    const left = await readBenchmarkJson(leftPath);
    const right = await readBenchmarkJson(rightPath);

    const lines = [
        colorize("Retree Benchmark Comparison", "bold", "cyan"),
        "",
        `${colorize("Left:", "bold")} ${colorize(leftPath, "green")}`,
        `${colorize("Right:", "bold")} ${colorize(rightPath, "green")}`,
        "",
        renderMetadataComparison(left, right),
        "",
        renderSignalSummaryComparison(left, right),
        "",
        renderScenarioComparison(left, right),
        "",
        renderMeasurementDetailComparison(left, right),
        "",
        renderReactInitialRenderOperationComparison(left, right),
        "",
        renderReactEffectLifecycleOperationComparison(left, right),
    ];

    if (args.verbose) {
        lines.push("");
        lines.push(renderCaseComparison(left, right));
    }

    return lines.join("\n");
}

function readOutputDir(argv: string[]) {
    for (let index = 0; index < argv.length; index++) {
        const current = argv[index];
        if (current === "--output-dir") {
            const value = argv[index + 1];
            if (value === undefined) {
                throw new Error(
                    "--output-dir requires a value before compare."
                );
            }
            return value;
        }
        if (current.startsWith("--output-dir=")) {
            const value = current.slice("--output-dir=".length);
            if (value.length === 0) {
                throw new Error(
                    "--output-dir requires a value before compare."
                );
            }
            return value;
        }
    }
    return undefined;
}

async function resolveBenchmarkJsonPath(outputDir: string, nameOrPath: string) {
    const candidates = createPathCandidates(outputDir, nameOrPath);
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch (error: unknown) {
            if (isNodeError(error) && error.code === "ENOENT") {
                continue;
            }
            throw error;
        }
    }

    throw new Error(
        `Could not find benchmark JSON "${nameOrPath}". Checked: ${candidates.join(
            ", "
        )}`
    );
}

function createPathCandidates(outputDir: string, nameOrPath: string) {
    if (path.isAbsolute(nameOrPath) || nameOrPath.includes(path.sep)) {
        return [path.resolve(nameOrPath)];
    }

    const resolvedOutputDir = path.resolve(outputDir);
    const names = new Set<string>();
    names.add(nameOrPath);
    if (!nameOrPath.endsWith(".json")) {
        names.add(`${nameOrPath}.json`);
    }
    if (!nameOrPath.startsWith("retree-benchmark-")) {
        names.add(`retree-benchmark-${nameOrPath}.json`);
    }
    return [...names].map((name) => path.join(resolvedOutputDir, name));
}

async function readBenchmarkJson(
    filePath: string
): Promise<BenchmarkJsonResults> {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isBenchmarkJsonResults(parsed)) {
        throw new Error(
            `Benchmark compare expected ${filePath} to contain Retree benchmark JSON results.`
        );
    }
    return parsed;
}

function isBenchmarkJsonResults(value: unknown): value is BenchmarkJsonResults {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    if (!("metadata" in value) || !("scenarios" in value)) {
        return false;
    }
    const candidate = value as {
        metadata?: unknown;
        scenarios?: unknown;
    };
    return (
        typeof candidate.metadata === "object" &&
        candidate.metadata !== null &&
        Array.isArray(candidate.scenarios)
    );
}

function renderMetadataComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    return renderSectionTable("Metadata", [
        ["Field", "Left", "Right"],
        [
            "Generated",
            left.metadata.generatedAtIso,
            right.metadata.generatedAtIso,
        ],
        ["Profile", left.metadata.profileName, right.metadata.profileName],
        [
            "Depth tiers",
            left.metadata.selectedDepthTiers.join(", "),
            right.metadata.selectedDepthTiers.join(", "),
        ],
        [
            "Frequency tiers",
            left.metadata.selectedFrequencyTiers.join(", "),
            right.metadata.selectedFrequencyTiers.join(", "),
        ],
        ["Width tiers", formatWidthTiers(left), formatWidthTiers(right)],
        [
            "Workers",
            String(left.metadata.parallelWorkers),
            String(right.metadata.parallelWorkers),
        ],
        [
            "React initial render samples",
            formatOptionalMetadataNumber(
                left.metadata.reactInitialRenderSamples
            ),
            formatOptionalMetadataNumber(
                right.metadata.reactInitialRenderSamples
            ),
        ],
    ]);
}

function formatOptionalMetadataNumber(value: number | undefined): string {
    if (value === undefined) {
        return "null";
    }
    return String(value);
}

function renderScenarioComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    const leftScenarios = getAnalysisScenarioMap(left);
    const rightScenarios = getAnalysisScenarioMap(right);
    const rows = [
        [
            "Scenario",
            "Samples",
            "Avg ms",
            "Avg Δ",
            "P95 ms",
            "P95 Δ",
            "Setup P95 ms",
            "Setup Δ",
        ],
    ];

    for (const [scenarioId, leftScenario] of leftScenarios) {
        const rightScenario = rightScenarios.get(scenarioId);
        if (rightScenario === undefined) {
            continue;
        }
        rows.push([
            leftScenario.title,
            `${leftScenario.summary.samples} -> ${rightScenario.summary.samples}`,
            `${formatMs(leftScenario.summary.averageMeanMs)} -> ${formatMs(
                rightScenario.summary.averageMeanMs
            )}`,
            formatDelta(
                leftScenario.summary.averageMeanMs,
                rightScenario.summary.averageMeanMs
            ),
            `${formatMs(leftScenario.summary.p95Ms)} -> ${formatMs(
                rightScenario.summary.p95Ms
            )}`,
            formatDelta(
                leftScenario.summary.p95Ms,
                rightScenario.summary.p95Ms
            ),
            `${formatMs(leftScenario.summary.setupP95Ms)} -> ${formatMs(
                rightScenario.summary.setupP95Ms
            )}`,
            formatDelta(
                leftScenario.summary.setupP95Ms,
                rightScenario.summary.setupP95Ms
            ),
        ]);
    }

    return renderSectionTable("Scenario Summary", rows);
}

function renderMeasurementDetailComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    const leftDetails = getMeasurementDetailSummaryMap(left);
    const rightDetails = getMeasurementDetailSummaryMap(right);
    const rows = [
        [
            "Scenario",
            "Operation",
            "Samples",
            "Avg ms",
            "Avg Δ",
            "Median ms",
            "Median Δ",
            "P95 ms",
            "P95 Δ",
        ],
    ];

    for (const summaryKey of getSortedUnionKeys(leftDetails, rightDetails)) {
        const leftSummary = leftDetails.get(summaryKey);
        const rightSummary = rightDetails.get(summaryKey);
        const displaySummary = leftSummary ?? rightSummary;
        if (displaySummary === undefined) {
            continue;
        }
        rows.push([
            displaySummary.scenarioTitle,
            displaySummary.operation,
            `${formatNullableInteger(
                leftSummary?.samples
            )} -> ${formatNullableInteger(rightSummary?.samples)}`,
            `${formatNullableMs(
                leftSummary?.averageMeanMs
            )} -> ${formatNullableMs(rightSummary?.averageMeanMs)}`,
            formatNullableDelta(
                leftSummary?.averageMeanMs,
                rightSummary?.averageMeanMs
            ),
            `${formatNullableMs(leftSummary?.medianMs)} -> ${formatNullableMs(
                rightSummary?.medianMs
            )}`,
            formatNullableDelta(leftSummary?.medianMs, rightSummary?.medianMs),
            `${formatNullableMs(leftSummary?.p95Ms)} -> ${formatNullableMs(
                rightSummary?.p95Ms
            )}`,
            formatNullableDelta(leftSummary?.p95Ms, rightSummary?.p95Ms),
        ]);
    }

    if (rows.length === 1) {
        rows.push(["No measurement details", "", "", "", "", "", "", "", ""]);
    }

    return renderSectionTable("React Measured Update Breakdown", rows);
}

function renderReactInitialRenderOperationComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    return renderReactSetupOperationComparison(
        "React Initial Render Breakdown",
        getReactInitialRenderOperationSummaryMap(left),
        getReactInitialRenderOperationSummaryMap(right)
    );
}

function renderReactEffectLifecycleOperationComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    return renderReactSetupOperationComparison(
        "React Effect Lifecycle Breakdown",
        getReactEffectLifecycleOperationSummaryMap(left),
        getReactEffectLifecycleOperationSummaryMap(right)
    );
}

function renderReactSetupOperationComparison(
    title: string,
    leftOperations: Map<string, ScenarioOperationSummary>,
    rightOperations: Map<string, ScenarioOperationSummary>
) {
    const rows = [
        [
            "Scenario",
            "Operation",
            "Samples",
            "Avg ms",
            "Avg Δ",
            "P95 ms",
            "P95 Δ",
            "Max ms",
            "Max Δ",
        ],
    ];

    for (const summaryKey of getSortedUnionKeys(
        leftOperations,
        rightOperations
    )) {
        const leftSummary = leftOperations.get(summaryKey);
        const rightSummary = rightOperations.get(summaryKey);
        const displaySummary = leftSummary ?? rightSummary;
        if (displaySummary === undefined) {
            continue;
        }
        rows.push([
            displaySummary.scenarioTitle,
            displaySummary.operation,
            `${formatNullableInteger(
                leftSummary?.samples
            )} -> ${formatNullableInteger(rightSummary?.samples)}`,
            `${formatNullableMs(
                leftSummary?.averageMeanMs
            )} -> ${formatNullableMs(rightSummary?.averageMeanMs)}`,
            formatNullableDelta(
                leftSummary?.averageMeanMs,
                rightSummary?.averageMeanMs
            ),
            `${formatNullableMs(leftSummary?.p95Ms)} -> ${formatNullableMs(
                rightSummary?.p95Ms
            )}`,
            formatNullableDelta(leftSummary?.p95Ms, rightSummary?.p95Ms),
            `${formatNullableMs(leftSummary?.maxMs)} -> ${formatNullableMs(
                rightSummary?.maxMs
            )}`,
            formatNullableDelta(leftSummary?.maxMs, rightSummary?.maxMs),
        ]);
    }

    if (rows.length === 1) {
        rows.push([
            "No React setup operations",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ]);
    }

    return renderSectionTable(title, rows);
}

function renderSignalSummaryComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    const leftCases = getCasesByScenario(left.scenarios);
    const rightCases = getCaseMap(right.scenarios);
    const rows = [
        [
            "Scenario",
            "Matched",
            "Avg win/loss",
            "Weighted avg Δ",
            "Median avg Δ",
            "Median median Δ",
            "Median P95 Δ",
            "Median setup P95 Δ",
            "Signal",
        ],
    ];

    for (const [scenarioId, cases] of leftCases) {
        const matchedCases = cases
            .map((leftCase) => ({
                leftCase,
                rightCase: rightCases.get(formatCaseKey(leftCase)),
            }))
            .filter(isMatchedCasePair);
        if (matchedCases.length === 0) {
            continue;
        }
        const summary = summarizeMatchedCaseSignal(matchedCases);
        rows.push([
            summary.scenarioTitle,
            String(summary.matchedCases),
            `${summary.averageWins}/${summary.averageLosses}`,
            formatPercent(summary.weightedAverageDeltaPercent),
            formatPercent(summary.medianAverageDeltaPercent),
            formatPercent(summary.medianMedianDeltaPercent),
            formatPercent(summary.medianP95DeltaPercent),
            formatPercent(summary.medianSetupP95DeltaPercent),
            formatSignalLabel(summary),
        ]);
    }

    if (rows.length === 1) {
        rows.push(["No matched cases", "", "", "", "", "", "", "", ""]);
    }

    return renderSectionTable("Signal Summary", rows);
}

function renderCaseComparison(
    left: BenchmarkJsonResults,
    right: BenchmarkJsonResults
) {
    const leftCases = getCaseMap(left.scenarios);
    const rightCases = getCaseMap(right.scenarios);
    const rows = [
        [
            "Scenario",
            "Case",
            "Avg ms",
            "Avg Δ",
            "Median Δ",
            "P95 Δ",
            "Setup P95 Δ",
        ],
    ];

    for (const [caseKey, leftCase] of leftCases) {
        const rightCase = rightCases.get(caseKey);
        if (rightCase === undefined) {
            continue;
        }
        rows.push([
            leftCase.scenarioTitle,
            formatCaseLabel(leftCase),
            `${formatMs(leftCase.summary.averageMeanMs)} -> ${formatMs(
                rightCase.summary.averageMeanMs
            )}`,
            formatDelta(
                leftCase.summary.averageMeanMs,
                rightCase.summary.averageMeanMs
            ),
            formatDelta(leftCase.summary.medianMs, rightCase.summary.medianMs),
            formatDelta(leftCase.summary.p95Ms, rightCase.summary.p95Ms),
            formatDelta(
                leftCase.setupSummary.p95Ms,
                rightCase.setupSummary.p95Ms
            ),
        ]);
    }

    if (rows.length === 1) {
        rows.push(["No matched cases", "", "", "", "", "", ""]);
    }

    return renderSectionTable("Matched Cases", rows);
}

function getAnalysisScenarioMap(
    results: BenchmarkJsonResults
): Map<string, BenchmarkAnalysisScenario> {
    const analysisScenarios = results.analysis?.scenarios;
    if (analysisScenarios !== undefined) {
        return new Map(
            analysisScenarios.map((scenario) => [scenario.scenarioId, scenario])
        );
    }

    return new Map(
        results.scenarios.map((scenario) => [
            scenario.scenarioId,
            {
                scenarioId: scenario.scenarioId,
                summary: summarizeScenario(scenario),
                title: scenario.title,
            },
        ])
    );
}

interface ScenarioOperationSummary extends BenchmarkOperationSummary {
    scenarioId: string;
    scenarioTitle: string;
}

function getMeasurementDetailSummaryMap(results: BenchmarkJsonResults) {
    return getScenarioOperationSummaryMap(
        getMeasurementDetailSummaries(results)
    );
}

function getReactInitialRenderOperationSummaryMap(
    results: BenchmarkJsonResults
) {
    return getScenarioOperationSummaryMap(
        getSetupOperationSummaries(results).filter((summary) =>
            isReactInitialRenderOperation(summary.operation)
        )
    );
}

function getReactEffectLifecycleOperationSummaryMap(
    results: BenchmarkJsonResults
) {
    return getScenarioOperationSummaryMap(
        getSetupOperationSummaries(results).filter((summary) =>
            isReactEffectLifecycleOperation(summary.operation)
        )
    );
}

function isReactInitialRenderOperation(operation: string) {
    return (
        operation === "react-component-render" ||
        operation === "react-hook-call" ||
        operation === "react-hook-render-reproxy" ||
        operation === "react-hook-snapshot-read" ||
        operation === "react-hook-initial-reproxy-state" ||
        operation === "react-hook-render-base-proxy" ||
        operation === "react-hook-render-read" ||
        operation === "react-hook-render-read-first" ||
        operation === "react-hook-render-read-second" ||
        operation === "react-hook-render-reproxy-reset" ||
        operation === "react-hook-render-state-base-proxy" ||
        operation === "react-root-render"
    );
}

function isReactEffectLifecycleOperation(operation: string) {
    return (
        operation === "react-hook-effect-cleanup" ||
        operation === "react-hook-effect-subscribe" ||
        operation === "react-hook-external-store-cleanup" ||
        operation === "react-hook-external-store-subscribe" ||
        operation === "react-root-unmount"
    );
}

function getScenarioOperationSummaryMap(summaries: ScenarioOperationSummary[]) {
    const summaryMap = new Map<string, ScenarioOperationSummary>();
    for (const summary of summaries) {
        summaryMap.set(`${summary.scenarioId}|${summary.operation}`, summary);
    }
    return summaryMap;
}

function getSortedUnionKeys(
    left: Map<string, ScenarioOperationSummary>,
    right: Map<string, ScenarioOperationSummary>
) {
    return [...new Set([...left.keys(), ...right.keys()])].sort(
        (leftKey, rightKey) => leftKey.localeCompare(rightKey)
    );
}

function getMeasurementDetailSummaries(
    results: BenchmarkJsonResults
): ScenarioOperationSummary[] {
    const analysisSummaries = getAnalysisOperationSummaries(
        results,
        "measurementDetailSummaries"
    );
    if (analysisSummaries.length > 0) {
        return analysisSummaries;
    }

    const summaries: ScenarioOperationSummary[] = [];
    for (const scenario of results.scenarios) {
        const durationsByOperation = new Map<
            BenchmarkMeasurementDetailOperation,
            number[]
        >();
        for (const benchmarkCase of scenario.cases) {
            for (const measurement of benchmarkCase.measurements) {
                for (const detail of measurement.details ?? []) {
                    const durations =
                        durationsByOperation.get(detail.operation) ?? [];
                    durations.push(detail.durationMs);
                    durationsByOperation.set(detail.operation, durations);
                }
            }
        }
        for (const [operation, durations] of durationsByOperation) {
            summaries.push({
                ...summarizeDurations(durations),
                operation,
                scenarioId: scenario.scenarioId,
                scenarioTitle: scenario.title,
            });
        }
    }
    return summaries;
}

function getSetupOperationSummaries(
    results: BenchmarkJsonResults
): ScenarioOperationSummary[] {
    const analysisSummaries = getAnalysisOperationSummaries(
        results,
        "setupSummaries"
    );
    if (analysisSummaries.length > 0) {
        return analysisSummaries;
    }

    const summaries: ScenarioOperationSummary[] = [];
    for (const scenario of results.scenarios) {
        const durationsByOperation = new Map<
            BenchmarkSetupOperation,
            number[]
        >();
        for (const benchmarkCase of scenario.cases) {
            for (const measurement of benchmarkCase.setupMeasurements) {
                const durations =
                    durationsByOperation.get(measurement.operation) ?? [];
                durations.push(measurement.durationMs);
                durationsByOperation.set(measurement.operation, durations);
            }
        }
        for (const [operation, durations] of durationsByOperation) {
            summaries.push({
                ...summarizeDurations(durations),
                operation,
                scenarioId: scenario.scenarioId,
                scenarioTitle: scenario.title,
            });
        }
    }
    return summaries;
}

function getAnalysisOperationSummaries(
    results: BenchmarkJsonResults,
    key: "measurementDetailSummaries" | "setupSummaries"
): ScenarioOperationSummary[] {
    const analysisScenarios = results.analysis?.scenarios;
    if (analysisScenarios === undefined) {
        return [];
    }

    const summaries: ScenarioOperationSummary[] = [];
    for (const scenario of analysisScenarios) {
        for (const summary of scenario[key] ?? []) {
            summaries.push({
                ...summary,
                scenarioId: scenario.scenarioId,
                scenarioTitle: scenario.title,
            });
        }
    }
    return summaries;
}

function getCaseMap(scenarios: BenchmarkScenarioResult[]) {
    const cases = new Map<string, BenchmarkCaseResult>();
    for (const scenario of scenarios) {
        for (const benchmarkCase of scenario.cases) {
            cases.set(formatCaseKey(benchmarkCase), benchmarkCase);
        }
    }
    return cases;
}

function getCasesByScenario(scenarios: BenchmarkScenarioResult[]) {
    const scenarioCases = new Map<string, BenchmarkCaseResult[]>();
    for (const scenario of scenarios) {
        scenarioCases.set(scenario.scenarioId, scenario.cases);
    }
    return scenarioCases;
}

interface MatchedCasePair {
    leftCase: BenchmarkCaseResult;
    rightCase: BenchmarkCaseResult;
}

function isMatchedCasePair(value: {
    leftCase: BenchmarkCaseResult;
    rightCase: BenchmarkCaseResult | undefined;
}): value is MatchedCasePair {
    return value.rightCase !== undefined;
}

function summarizeMatchedCaseSignal(pairs: MatchedCasePair[]) {
    let averageWins = 0;
    let averageLosses = 0;
    let weightedAverageLeftTotal = 0;
    let weightedAverageRightTotal = 0;
    const averageDeltas: number[] = [];
    const medianDeltas: number[] = [];
    const p95Deltas: number[] = [];
    const setupP95Deltas: number[] = [];

    for (const pair of pairs) {
        const averageDelta = calculateDeltaPercent(
            pair.leftCase.summary.averageMeanMs,
            pair.rightCase.summary.averageMeanMs
        );
        averageDeltas.push(averageDelta);
        medianDeltas.push(
            calculateDeltaPercent(
                pair.leftCase.summary.medianMs,
                pair.rightCase.summary.medianMs
            )
        );
        p95Deltas.push(
            calculateDeltaPercent(
                pair.leftCase.summary.p95Ms,
                pair.rightCase.summary.p95Ms
            )
        );
        setupP95Deltas.push(
            calculateDeltaPercent(
                pair.leftCase.setupSummary.p95Ms,
                pair.rightCase.setupSummary.p95Ms
            )
        );
        if (averageDelta < 0) {
            averageWins++;
        }
        if (averageDelta > 0) {
            averageLosses++;
        }
        weightedAverageLeftTotal =
            weightedAverageLeftTotal +
            pair.leftCase.summary.averageMeanMs * pair.leftCase.summary.samples;
        weightedAverageRightTotal =
            weightedAverageRightTotal +
            pair.rightCase.summary.averageMeanMs *
                pair.rightCase.summary.samples;
    }

    return {
        averageLosses,
        averageWins,
        matchedCases: pairs.length,
        medianAverageDeltaPercent: median(averageDeltas),
        medianMedianDeltaPercent: median(medianDeltas),
        medianP95DeltaPercent: median(p95Deltas),
        medianSetupP95DeltaPercent: median(setupP95Deltas),
        scenarioTitle: pairs[0].leftCase.scenarioTitle,
        weightedAverageDeltaPercent: calculateDeltaPercent(
            weightedAverageLeftTotal,
            weightedAverageRightTotal
        ),
    };
}

function formatSignalLabel(summary: {
    averageLosses: number;
    averageWins: number;
    medianAverageDeltaPercent: number;
    medianP95DeltaPercent: number;
    weightedAverageDeltaPercent: number;
}) {
    const weightedImproved = summary.weightedAverageDeltaPercent < -2;
    const medianAverageImproved = summary.medianAverageDeltaPercent < -2;
    const p95Improved = summary.medianP95DeltaPercent < -2;
    const weightedRegressed = summary.weightedAverageDeltaPercent > 2;
    const medianAverageRegressed = summary.medianAverageDeltaPercent > 2;
    const p95Regressed = summary.medianP95DeltaPercent > 2;

    if (weightedImproved && medianAverageImproved && p95Improved) {
        return "improved";
    }
    if (weightedRegressed && medianAverageRegressed && p95Regressed) {
        return "regressed";
    }
    if (summary.averageWins > summary.averageLosses && weightedImproved) {
        return "mostly improved";
    }
    if (summary.averageLosses > summary.averageWins && weightedRegressed) {
        return "mostly regressed";
    }
    return "mixed";
}

function formatCaseKey(benchmarkCase: BenchmarkCaseResult) {
    return [
        benchmarkCase.scenarioId,
        benchmarkCase.depthTitle,
        benchmarkCase.depth,
        benchmarkCase.widthTitle,
        benchmarkCase.width,
        benchmarkCase.frequencyTitle,
        benchmarkCase.commits,
        benchmarkCase.callbackReadMode,
        benchmarkCase.autotrappingMode ?? "",
        benchmarkCase.dependencyDepth ?? "",
        benchmarkCase.dependencyFanout ?? "",
        benchmarkCase.effectWrites ?? "",
        benchmarkCase.listenerCount ?? "",
        benchmarkCase.selectionMode ?? "",
        benchmarkCase.transactionMutations ?? "",
    ].join("|");
}

function formatCaseLabel(benchmarkCase: BenchmarkCaseResult) {
    const details = [
        `depth ${benchmarkCase.depthTitle}=${benchmarkCase.depth}`,
        `width ${benchmarkCase.widthTitle}=${benchmarkCase.width}`,
        `freq ${benchmarkCase.frequencyTitle}=${benchmarkCase.commits}`,
        `read ${benchmarkCase.callbackReadMode}`,
    ];
    if (benchmarkCase.dependencyDepth !== undefined) {
        details.push(`dep depth ${benchmarkCase.dependencyDepth}`);
    }
    if (benchmarkCase.autotrappingMode !== undefined) {
        details.push(`trap ${benchmarkCase.autotrappingMode}`);
    }
    if (benchmarkCase.dependencyFanout !== undefined) {
        details.push(`dep fanout ${benchmarkCase.dependencyFanout}`);
    }
    if (benchmarkCase.listenerCount !== undefined) {
        details.push(`listeners ${benchmarkCase.listenerCount}`);
    }
    if (benchmarkCase.effectWrites !== undefined) {
        details.push(`effect writes ${benchmarkCase.effectWrites}`);
    }
    if (benchmarkCase.transactionMutations !== undefined) {
        details.push(`tx mutations ${benchmarkCase.transactionMutations}`);
    }
    if (benchmarkCase.selectionMode !== undefined) {
        details.push(`selection ${benchmarkCase.selectionMode}`);
    }
    return details.join(", ");
}

function summarizeScenario(scenario: BenchmarkScenarioResult) {
    const summaries = scenario.cases.map(
        (benchmarkCase) => benchmarkCase.summary
    );
    const setupSummaries = scenario.cases.map(
        (benchmarkCase) => benchmarkCase.setupSummary
    );
    return {
        averageMeanMs: weightedAverage(summaries),
        medianMs: median(summaries.map((summary) => summary.medianMs)),
        p95Ms: median(summaries.map((summary) => summary.p95Ms)),
        samples: summaries.reduce(
            (total, summary) => total + summary.samples,
            0
        ),
        setupAverageMeanMs: weightedAverage(setupSummaries),
        setupP95Ms: median(setupSummaries.map((summary) => summary.p95Ms)),
        setupSamples: setupSummaries.reduce(
            (total, summary) => total + summary.samples,
            0
        ),
        warnings: scenario.cases.reduce(
            (total, benchmarkCase) => total + benchmarkCase.warnings.length,
            0
        ),
    };
}

function weightedAverage(summaries: BenchmarkSummary[]) {
    const samples = summaries.reduce(
        (total, summary) => total + summary.samples,
        0
    );
    if (samples === 0) {
        return 0;
    }
    const total = summaries.reduce(
        (sum, summary) => sum + summary.averageMeanMs * summary.samples,
        0
    );
    return total / samples;
}

function summarizeDurations(durationsMs: number[]): BenchmarkSummary {
    if (durationsMs.length === 0) {
        return {
            averageMeanMs: 0,
            maxMs: 0,
            medianMs: 0,
            minMs: 0,
            p95Ms: 0,
            samples: 0,
        };
    }
    const sorted = [...durationsMs].sort((left, right) => left - right);
    const total = durationsMs.reduce((sum, duration) => sum + duration, 0);
    return {
        averageMeanMs: total / durationsMs.length,
        maxMs: sorted[sorted.length - 1],
        medianMs: median(sorted),
        minMs: sorted[0],
        p95Ms: percentile(sorted, 95),
        samples: durationsMs.length,
    };
}

function median(values: number[]) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }
    return (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(sortedValues: number[], percentileValue: number) {
    if (sortedValues.length === 0) {
        return 0;
    }
    const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
    return sortedValues[Math.min(Math.max(index, 0), sortedValues.length - 1)];
}

function formatWidthTiers(results: BenchmarkJsonResults) {
    return results.metadata.widthTiers
        .map((tier) => `${tier.title}=${tier.value}`)
        .join(", ");
}

function renderSectionTable(title: string, rows: string[][]) {
    const [headers, ...bodyRows] = rows;
    return [
        colorize(title, "bold", "cyan"),
        "",
        renderAlignedTable(headers, bodyRows),
    ].join("\n");
}

function renderAlignedTable(headers: string[], rows: string[][]) {
    const widths = headers.map((header, columnIndex) => {
        let width = visibleLength(header);
        for (const row of rows) {
            width = Math.max(width, visibleLength(row[columnIndex] ?? ""));
        }
        return width;
    });
    const separator = widths.map((width) => "-".repeat(Math.max(width, 3)));
    return [
        renderRow(headers, widths, "header"),
        renderRow(separator, widths, "separator"),
        ...rows.map((row) => renderRow(row, widths, "body")),
    ].join("\n");
}

function renderRow(
    values: string[],
    widths: number[],
    role: "body" | "header" | "separator"
) {
    return `| ${values
        .map((value, index) =>
            styleCell(padEnd(value, widths[index]), index, role)
        )
        .join(" | ")} |`;
}

function styleCell(
    value: string,
    columnIndex: number,
    role: "body" | "header" | "separator"
) {
    if (role === "header") {
        return colorize(value, "bold", "cyan");
    }
    if (role === "separator") {
        return colorize(value, "dim");
    }
    if (columnIndex === 0) {
        return colorize(value, "bold", "magenta");
    }
    if (value.includes("+")) {
        return colorize(value, "yellow");
    }
    if (value.includes("-")) {
        return colorize(value, "green");
    }
    return value;
}

function padEnd(value: string, width: number) {
    const padding = width - visibleLength(value);
    if (padding <= 0) {
        return value;
    }
    return `${value}${" ".repeat(padding)}`;
}

function visibleLength(value: string) {
    return stripAnsi(value).length;
}

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_STYLE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

function stripAnsi(value: string) {
    return value.replace(ANSI_STYLE_PATTERN, "");
}

function formatMs(value: number) {
    return value.toFixed(6);
}

function formatNullableMs(value: number | undefined) {
    if (value === undefined) {
        return "null";
    }
    return formatMs(value);
}

function formatNullableInteger(value: number | undefined) {
    if (value === undefined) {
        return "null";
    }
    return String(value);
}

function formatDelta(left: number, right: number) {
    if (left === 0) {
        return "n/a";
    }
    return formatPercent(calculateDeltaPercent(left, right));
}

function formatNullableDelta(
    left: number | undefined,
    right: number | undefined
) {
    if (left === undefined || right === undefined) {
        return "+NaN%";
    }
    return formatDelta(left, right);
}

function calculateDeltaPercent(left: number, right: number) {
    if (left === 0) {
        return 0;
    }
    return ((right - left) / left) * 100;
}

function formatPercent(delta: number) {
    const prefix = delta >= 0 ? "+" : "";
    return `${prefix}${delta.toFixed(1)}%`;
}

type ConsoleStyle = "bold" | "cyan" | "green" | "magenta" | "yellow" | "dim";

const CONSOLE_STYLE_CODES: Record<ConsoleStyle, number> = {
    bold: 1,
    cyan: 36,
    dim: 2,
    green: 32,
    magenta: 35,
    yellow: 33,
};

function colorize(value: string, ...styles: ConsoleStyle[]) {
    if (styles.length === 0) {
        return value;
    }
    const codes = styles
        .map((styleName) => CONSOLE_STYLE_CODES[styleName])
        .join(";");
    return `\x1b[${codes}m${value}\x1b[0m`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error;
}
