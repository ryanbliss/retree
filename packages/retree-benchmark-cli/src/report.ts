import fs from "node:fs/promises";
import path from "node:path";
import {
    BenchmarkArtifactPaths,
    BenchmarkCaseResult,
    BenchmarkResults,
    BenchmarkScenarioResult,
    SkippedBenchmarkCase,
} from "./types";

export interface WrittenBenchmarkArtifacts extends BenchmarkArtifactPaths {
    latestJsonPath: string;
    latestMarkdownPath: string;
    latestVerboseMarkdownPath: string;
    markdown: string;
    verboseMarkdown: string;
    verboseMarkdownPath: string;
}

export async function writeBenchmarkArtifacts(
    results: BenchmarkResults,
    outputDir: string
): Promise<WrittenBenchmarkArtifacts> {
    const resolvedOutputDir = path.resolve(outputDir);
    await fs.mkdir(resolvedOutputDir, {
        recursive: true,
    });

    const timestamp = results.metadata.generatedAtIso.replace(/[:.]/g, "-");
    const basename = `retree-benchmark-${timestamp}`;
    const jsonPath = path.join(resolvedOutputDir, `${basename}.json`);
    const markdownPath = path.join(resolvedOutputDir, `${basename}.md`);
    const verboseMarkdownPath = path.join(
        resolvedOutputDir,
        `${basename}.verbose.md`
    );
    const latestJsonPath = path.join(
        resolvedOutputDir,
        "retree-benchmark-latest.json"
    );
    const latestMarkdownPath = path.join(
        resolvedOutputDir,
        "retree-benchmark-latest.md"
    );
    const latestVerboseMarkdownPath = path.join(
        resolvedOutputDir,
        "retree-benchmark-latest.verbose.md"
    );
    const jsonResults = createJsonResults(results);
    const markdown = renderMarkdownReport(results);
    const verboseMarkdown = renderMarkdownVerboseReport(results);
    const json = `${JSON.stringify(jsonResults, null, 4)}\n`;

    await fs.writeFile(jsonPath, json);
    await fs.writeFile(markdownPath, `${markdown}\n`);
    await fs.writeFile(verboseMarkdownPath, `${verboseMarkdown}\n`);
    await fs.writeFile(latestJsonPath, json);
    await fs.writeFile(latestMarkdownPath, `${markdown}\n`);
    await fs.writeFile(latestVerboseMarkdownPath, `${verboseMarkdown}\n`);

    return {
        jsonPath,
        latestJsonPath,
        latestMarkdownPath,
        latestVerboseMarkdownPath,
        markdown,
        markdownPath,
        verboseMarkdown,
        verboseMarkdownPath,
    };
}

export function renderConsoleReport(
    artifacts: BenchmarkArtifactPaths,
    results: BenchmarkResults
) {
    return [
        colorize("Retree Benchmark Results", "bold", "cyan"),
        "",
        `${colorize("JSON results:", "bold")} ${colorize(
            artifacts.jsonPath,
            "green"
        )}`,
        `${colorize("Markdown report:", "bold")} ${colorize(
            artifacts.markdownPath,
            "green"
        )}`,
        renderVerboseArtifactLine(artifacts),
        renderLatestArtifactLine(artifacts),
        "",
        renderConsoleBenchmarkReport(results),
    ].join("\n");
}

export function renderConsoleSummaryReport(
    artifacts: BenchmarkArtifactPaths,
    results: BenchmarkResults
) {
    return [
        colorize("Retree Benchmark Results", "bold", "cyan"),
        "",
        `${colorize("JSON results:", "bold")} ${colorize(
            artifacts.jsonPath,
            "green"
        )}`,
        `${colorize("Markdown report:", "bold")} ${colorize(
            artifacts.markdownPath,
            "green"
        )}`,
        renderVerboseArtifactLine(artifacts),
        renderLatestArtifactLine(artifacts),
        colorize(
            "Concise Markdown is the default report; full scenario tables were written to the verbose Markdown report.",
            "dim"
        ),
        "",
        renderConsoleBenchmarkSummary(results),
    ].join("\n");
}

export function renderMarkdownReport(results: BenchmarkResults) {
    return renderMarkdownReportWithOptions(results, {
        includeAllCases: false,
        includeSkippedDetails: false,
        title: "Retree Benchmark Results",
    });
}

export function renderMarkdownVerboseReport(results: BenchmarkResults) {
    return renderMarkdownReportWithOptions(results, {
        includeAllCases: true,
        includeSkippedDetails: true,
        title: "Retree Benchmark Results (Verbose)",
    });
}

function renderMarkdownReportWithOptions(
    results: BenchmarkResults,
    options: MarkdownReportOptions
) {
    const lines = [
        `# ${options.title}`,
        "",
        `Generated: ${results.metadata.generatedAtIso}`,
        `Profile: ${results.metadata.profileName}`,
        `Parallel workers: ${results.metadata.parallelWorkers}`,
        `Node: ${results.metadata.nodeVersion}`,
        `Platform: ${results.metadata.platform} (${results.metadata.arch})`,
        `Depth tiers: ${results.metadata.selectedDepthTiers.join(", ")}`,
        `Frequency tiers: ${results.metadata.selectedFrequencyTiers.join(
            ", "
        )}`,
        `Width tiers: ${results.metadata.widthTiers
            .map((tier) => `${tier.title}=${tier.value}`)
            .join(", ")}`,
        `Callback reads: ${results.metadata.callbackReadModes.join(", ")}`,
        `Mutation types: ${results.metadata.mutationTypes.join(", ")}`,
        `Listener fan-outs: ${results.metadata.listenerFanouts.join(", ")}`,
        `Dependency depths: ${results.metadata.dependencyDepths.join(", ")}`,
        `Dependency fan-outs: ${results.metadata.dependencyFanouts.join(", ")}`,
        `Effect writes: ${results.metadata.effectWrites.join(", ")}`,
        `Transaction mutations: ${results.metadata.transactionMutations.join(
            ", "
        )}`,
        `Warmup commits per case: ${results.metadata.warmupCommits}`,
        "",
        renderMarkdownLegend(),
        "",
        "## Scenario Summary",
        "",
        renderMarkdownScenarioSummaryTable(results.scenarios),
        "",
    ];

    for (const scenario of results.scenarios) {
        lines.push(renderMarkdownScenarioSection(scenario, options));
        lines.push("");
    }

    return lines.join("\n").trimEnd();
}

interface MarkdownReportOptions {
    includeAllCases: boolean;
    includeSkippedDetails: boolean;
    title: string;
}

function renderLatestArtifactLine(artifacts: BenchmarkArtifactPaths) {
    if (
        artifacts.latestJsonPath === undefined ||
        artifacts.latestMarkdownPath === undefined ||
        artifacts.latestVerboseMarkdownPath === undefined
    ) {
        return colorize(
            "Latest aliases were not provided for this benchmark run.",
            "dim"
        );
    }
    return `${colorize("Latest aliases:", "bold")} ${colorize(
        artifacts.latestJsonPath,
        "green"
    )} ${colorize("and", "dim")} ${colorize(
        artifacts.latestMarkdownPath,
        "green"
    )} ${colorize("and", "dim")} ${colorize(
        artifacts.latestVerboseMarkdownPath,
        "green"
    )}`;
}

function renderVerboseArtifactLine(artifacts: BenchmarkArtifactPaths) {
    if (artifacts.verboseMarkdownPath === undefined) {
        return colorize("Verbose Markdown report was not provided.", "dim");
    }
    return `${colorize("Verbose Markdown:", "bold")} ${colorize(
        artifacts.verboseMarkdownPath,
        "green"
    )}`;
}

function renderMarkdownLegend() {
    return [
        "## Legend",
        "",
        "### Scenario legend",
        "",
        renderAlignedTable(
            ["Scenario", "What it measures"],
            [
                [
                    "Direct nodeChanged",
                    "A nodeChanged listener is attached directly to the mutated target node.",
                ],
                [
                    "Root treeChanged",
                    "A treeChanged listener is attached to the root while a deep target node is mutated.",
                ],
                [
                    "Listener fan-out nodeChanged",
                    "Many nodeChanged listeners are attached to the same mutated target node.",
                ],
                [
                    "Distinct node listeners",
                    "Many distinct nodes each have one nodeChanged listener; one listened node is mutated per commit.",
                ],
                [
                    "Ancestor treeChanged fan-out",
                    "treeChanged listeners are attached to each node on the primary ancestor path, then the deepest target is mutated.",
                ],
                [
                    "Reactive dependency nodeChanged",
                    "The root depends on a child at the configured dependency depth, and the dependency target is mutated.",
                ],
                [
                    "Reactive dependency fan-out",
                    "Many dependent roots listen through dependencies that point at the same dependency target.",
                ],
                [
                    "Reactive dependency update fan-out",
                    "Many dependent roots share one dependency target, but commits mutate a dependent root to measure dependency update overhead.",
                ],
                [
                    "onChanged effect",
                    "The mutated target has an onChanged effect that performs the configured number of extra writes.",
                ],
                [
                    "Subscription churn",
                    "A Retree listener is created and immediately removed, measuring subscription lifecycle cost.",
                ],
                [
                    "runTransaction",
                    "A Retree.runTransaction call wraps the configured number of mutations and measures the resulting emission.",
                ],
            ],
            {
                format: "markdown",
            }
        ),
        "",
        "### Column legend",
        "",
        renderAlignedTable(
            ["Column", "Meaning"],
            [
                ["Cases", "Benchmark case combinations run for the scenario."],
                [
                    "Skipped",
                    "Invalid case combinations that were recorded but not run.",
                ],
                [
                    "Samples",
                    "Measured commit samples, excluding warmup commits.",
                ],
                ["Depth", "Primary-path tree depth used for the case."],
                [
                    "Width",
                    "Number of first-level side children attached at each primary-path node.",
                ],
                [
                    "Frequency",
                    "Repeated individual commits measured for the case.",
                ],
                [
                    "Callback read",
                    "How much data the listener reads when it fires: none, shallow, or deep.",
                ],
                [
                    "Dependency depth",
                    "Primary-path depth selected as the dependency target.",
                ],
                [
                    "Dependency fanout",
                    "Number of dependent roots listening through the same dependency target.",
                ],
                [
                    "Listener count",
                    "Number of listeners attached for listener fan-out cases.",
                ],
                [
                    "Effect writes",
                    "Number of extra writes performed by the onChanged effect.",
                ],
                [
                    "Tx mutations",
                    "Number of mutations wrapped inside a single runTransaction call.",
                ],
                [
                    "Average/mean ms",
                    "Arithmetic mean duration in milliseconds.",
                ],
                ["Median ms", "Median duration in milliseconds."],
                ["P95 ms", "95th percentile duration in milliseconds."],
                [
                    "Min ms / Max ms",
                    "Smallest and largest observed duration in milliseconds.",
                ],
                [
                    "Setup P95 ms / Setup max ms",
                    "Setup-phase timing before commit measurement begins.",
                ],
                [
                    "Scenario detail",
                    "Scenario-specific knobs such as listener count, dependency fan-out, or transaction mutations.",
                ],
                [
                    "Vs scenario avg",
                    "Percent difference from the scenario-level average.",
                ],
                [
                    "Mutation warnings",
                    "Mutation types that averaged at least 25% slower than their case average.",
                ],
            ],
            {
                format: "markdown",
            }
        ),
        "",
        "### Setup operation legend",
        "",
        renderAlignedTable(
            ["Setup operation", "What it measures"],
            [
                [
                    "broad-array-construction",
                    "Construction of a fresh broad array value before assignment to an already-proxied node.",
                ],
                [
                    "broad-array-assignment",
                    "Assignment of that fresh broad array to an already-proxied node, including any proxying Retree performs.",
                ],
                [
                    "broad-object-construction",
                    "Construction of a fresh broad object-record value before assignment to an already-proxied node.",
                ],
                [
                    "broad-object-assignment",
                    "Assignment of that fresh broad object record to an already-proxied node, including any proxying Retree performs.",
                ],
                [
                    "broad-map-construction",
                    "Construction of a fresh broad Map before assignment to an already-proxied node.",
                ],
                [
                    "broad-map-assignment",
                    "Assignment of that fresh broad Map to an already-proxied node, including any proxying Retree performs.",
                ],
                [
                    "broad-primitive-map-construction",
                    "Construction of a fresh broad Map with primitive values before assignment to an already-proxied node.",
                ],
                [
                    "broad-primitive-map-assignment",
                    "Assignment of that fresh primitive Map to an already-proxied node, including any proxying Retree performs.",
                ],
                [
                    "broad-primitive-set-construction",
                    "Construction of a fresh broad Set with primitive values before assignment to an already-proxied node.",
                ],
                [
                    "broad-primitive-set-assignment",
                    "Assignment of that fresh primitive Set to an already-proxied node, including any proxying Retree performs.",
                ],
                [
                    "broad-set-construction",
                    "Construction of a fresh broad Set before assignment to an already-proxied node.",
                ],
                [
                    "broad-set-assignment",
                    "Assignment of that fresh broad Set to an already-proxied node, including any proxying Retree performs.",
                ],
                [
                    "case-setup-total",
                    "Total setup time for the case before warmup and measured commits.",
                ],
                [
                    "raw-tree-construction",
                    "Construction of the deterministic benchmark object graph before Retree.root.",
                ],
                [
                    "root-proxy",
                    "Initial Retree.root proxying of the benchmark tree.",
                ],
                [
                    "primary-path-collection",
                    "Traversal that collects the bounded primary path and deep target.",
                ],
                [
                    "mutation-target-resolution",
                    "Selection of the node that will be mutated for the case.",
                ],
                [
                    "listener-setup-total",
                    "Total scenario-specific listener and dependency setup.",
                ],
                [
                    "listener-registration",
                    "Retree.on registration work for the scenario listeners.",
                ],
                [
                    "raw-dependent-node-construction",
                    "Construction of raw dependent nodes used by dependency fan-out cases.",
                ],
                [
                    "dependent-node-root-proxy",
                    "Retree.root proxying for each dependent node in dependency fan-out cases.",
                ],
                [
                    "dependency-linking",
                    "Assignment of dependency relationships used by dependency scenarios.",
                ],
                [
                    "changed-effect-configuration",
                    "Configuration of the onChanged effect used by effect cases.",
                ],
            ],
            {
                format: "markdown",
            }
        ),
        "",
        "### Mutation type legend",
        "",
        renderAlignedTable(
            ["Mutation type", "What changes"],
            [
                ["scalar-set", "Increments the target node scalar value."],
                [
                    "array-push",
                    "Replaces the target array children with a larger deterministic array.",
                ],
                [
                    "map-set",
                    "Replaces the target map children with deterministic entries.",
                ],
                [
                    "object-replace",
                    "Replaces nested metadata on the target node.",
                ],
                [
                    "set-add",
                    "Replaces the target set children with deterministic entries.",
                ],
                [
                    "subscription-cycle",
                    "Creates and removes a listener without a data mutation.",
                ],
            ],
            {
                format: "markdown",
            }
        ),
    ].join("\n");
}

function renderConsoleBenchmarkReport(results: BenchmarkResults) {
    const lines = [
        `${colorize("Generated:", "dim")} ${results.metadata.generatedAtIso}`,
        `${colorize("Profile:", "dim")} ${results.metadata.profileName}`,
        `${colorize("Parallel workers:", "dim")} ${
            results.metadata.parallelWorkers
        }`,
        `${colorize("Node:", "dim")} ${results.metadata.nodeVersion}`,
        `${colorize("Platform:", "dim")} ${results.metadata.platform} (${
            results.metadata.arch
        })`,
        `${colorize(
            "Depth tiers:",
            "dim"
        )} ${results.metadata.selectedDepthTiers.join(", ")}`,
        `${colorize(
            "Frequency tiers:",
            "dim"
        )} ${results.metadata.selectedFrequencyTiers.join(", ")}`,
        `${colorize("Width tiers:", "dim")} ${results.metadata.widthTiers
            .map((tier) => `${tier.title}=${tier.value}`)
            .join(", ")}`,
        `${colorize(
            "Callback reads:",
            "dim"
        )} ${results.metadata.callbackReadModes.join(", ")}`,
        `${colorize(
            "Mutation types:",
            "dim"
        )} ${results.metadata.mutationTypes.join(", ")}`,
        `${colorize(
            "Listener fan-outs:",
            "dim"
        )} ${results.metadata.listenerFanouts.join(", ")}`,
        `${colorize(
            "Dependency depths:",
            "dim"
        )} ${results.metadata.dependencyDepths.join(", ")}`,
        `${colorize(
            "Dependency fan-outs:",
            "dim"
        )} ${results.metadata.dependencyFanouts.join(", ")}`,
        `${colorize(
            "Effect writes:",
            "dim"
        )} ${results.metadata.effectWrites.join(", ")}`,
        `${colorize(
            "Transaction mutations:",
            "dim"
        )} ${results.metadata.transactionMutations.join(", ")}`,
        `${colorize("Warmup commits per case:", "dim")} ${
            results.metadata.warmupCommits
        }`,
        "",
    ];

    for (const scenario of results.scenarios) {
        lines.push(renderConsoleScenarioSection(scenario));
        lines.push("");
    }

    return lines.join("\n").trimEnd();
}

function renderConsoleBenchmarkSummary(results: BenchmarkResults) {
    const lines = [
        `${colorize("Generated:", "dim")} ${results.metadata.generatedAtIso}`,
        `${colorize("Profile:", "dim")} ${results.metadata.profileName}`,
        `${colorize("Parallel workers:", "dim")} ${
            results.metadata.parallelWorkers
        }`,
        `${colorize(
            "Depth tiers:",
            "dim"
        )} ${results.metadata.selectedDepthTiers.join(", ")}`,
        `${colorize(
            "Frequency tiers:",
            "dim"
        )} ${results.metadata.selectedFrequencyTiers.join(", ")}`,
        `${colorize("Width tiers:", "dim")} ${results.metadata.widthTiers
            .map((tier) => `${tier.title}=${tier.value}`)
            .join(", ")}`,
        "",
        renderConsoleScenarioSummaryTable(results.scenarios),
    ];

    return lines.join("\n").trimEnd();
}

function renderConsoleScenarioSummaryTable(
    scenarios: BenchmarkScenarioResult[]
) {
    const table = createScenarioSummaryTable(scenarios);
    return renderAlignedTable(table.headers, table.rows, {
        format: "console",
    });
}

function renderMarkdownScenarioSection(
    scenario: BenchmarkScenarioResult,
    options: MarkdownReportOptions
) {
    const lines = [`## ${scenario.title}`, ""];

    if (scenario.cases.length === 0) {
        lines.push("No benchmark cases were run for this scenario.");
    } else {
        lines.push("### Matrix summary");
        lines.push("");
        lines.push(renderMarkdownScenarioMatrixTable(scenario));
        lines.push("");
        lines.push("### Slowest cases");
        lines.push("");
        lines.push(renderMarkdownSlowestCaseTable(scenario.cases));
        lines.push("");
        lines.push("### Setup operations");
        lines.push("");
        lines.push(renderMarkdownSetupOperationTable(scenario));
        lines.push("");
        lines.push("### Slowest setup cases");
        lines.push("");
        lines.push(renderMarkdownSlowestSetupCaseTable(scenario.cases));
        lines.push("");
        lines.push("### Mutation types");
        lines.push("");
        lines.push(renderMarkdownMutationTable(scenario));
        lines.push("");
        if (options.includeAllCases) {
            lines.push("### All cases");
            lines.push("");
            lines.push(renderMarkdownCaseTable(scenario.cases));
        }
    }

    if (scenario.skipped.length > 0) {
        lines.push("");
        if (!options.includeSkippedDetails) {
            lines.push(`Skipped cases: ${scenario.skipped.length}`);
            return lines.join("\n");
        }
        lines.push("Skipped cases:");
        lines.push("");
        lines.push(renderMarkdownSkippedTable(scenario.skipped));
    }

    return lines.join("\n");
}

function renderConsoleScenarioSection(scenario: BenchmarkScenarioResult) {
    const lines = [colorize(scenario.title, "bold", "magenta"), ""];

    if (scenario.cases.length === 0) {
        lines.push(
            colorize("No benchmark cases were run for this scenario.", "dim")
        );
    } else {
        lines.push(renderConsoleCaseTable(scenario.cases));
    }

    if (scenario.skipped.length > 0) {
        lines.push("");
        lines.push(colorize("Skipped cases:", "bold", "yellow"));
        lines.push("");
        lines.push(renderConsoleSkippedTable(scenario.skipped));
    }

    return lines.join("\n");
}

function renderMarkdownCaseTable(cases: BenchmarkCaseResult[]) {
    const table = createCaseTable(cases);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderMarkdownScenarioSummaryTable(
    scenarios: BenchmarkScenarioResult[]
) {
    const table = createScenarioSummaryTable(scenarios);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderConsoleCaseTable(cases: BenchmarkCaseResult[]) {
    const table = createCaseTable(cases);
    return renderAlignedTable(table.headers, table.rows, {
        format: "console",
    });
}

function renderMarkdownSkippedTable(skippedCases: SkippedBenchmarkCase[]) {
    const table = createSkippedTable(skippedCases);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderConsoleSkippedTable(skippedCases: SkippedBenchmarkCase[]) {
    const table = createSkippedTable(skippedCases);
    return renderAlignedTable(table.headers, table.rows, {
        format: "console",
        skippedTable: true,
    });
}

function renderMarkdownScenarioMatrixTable(scenario: BenchmarkScenarioResult) {
    const table = createScenarioMatrixTable(scenario);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderMarkdownSlowestCaseTable(cases: BenchmarkCaseResult[]) {
    const table = createSlowestCaseTable(cases);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderMarkdownMutationTable(scenario: BenchmarkScenarioResult) {
    const table = createMutationTable(scenario);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderMarkdownSetupOperationTable(scenario: BenchmarkScenarioResult) {
    const table = createSetupOperationTable(scenario);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function renderMarkdownSlowestSetupCaseTable(cases: BenchmarkCaseResult[]) {
    const table = createSlowestSetupCaseTable(cases);
    return renderAlignedTable(table.headers, table.rows, {
        format: "markdown",
    });
}

function createCaseTable(cases: BenchmarkCaseResult[]) {
    return {
        headers: [
            "Scenario",
            "Depth title",
            "Depth",
            "Width title",
            "Width",
            "Frequency title",
            "Commits",
            "Callback read",
            "Dependency depth",
            "Dependency fanout",
            "Listener count",
            "Effect writes",
            "Tx mutations",
            "Setup P95 ms",
            "Setup max ms",
            "Samples",
            "Average/mean ms",
            "Median ms",
            "P95 ms",
            "Min ms",
            "Max ms",
            "Mutation warnings",
        ],
        rows: cases.map((result) => [
            result.scenarioTitle,
            result.depthTitle,
            String(result.depth),
            result.widthTitle,
            String(result.width),
            result.frequencyTitle,
            String(result.commits),
            result.callbackReadMode,
            result.dependencyDepth === undefined
                ? ""
                : String(result.dependencyDepth),
            result.dependencyFanout === undefined
                ? ""
                : String(result.dependencyFanout),
            result.listenerCount === undefined
                ? ""
                : String(result.listenerCount),
            result.effectWrites === undefined
                ? ""
                : String(result.effectWrites),
            result.transactionMutations === undefined
                ? ""
                : String(result.transactionMutations),
            formatMs(result.setupSummary.p95Ms),
            formatMs(result.setupSummary.maxMs),
            String(result.summary.samples),
            formatMs(result.summary.averageMeanMs),
            formatMs(result.summary.medianMs),
            formatMs(result.summary.p95Ms),
            formatMs(result.summary.minMs),
            formatMs(result.summary.maxMs),
            formatWarnings(result),
        ]),
    };
}

function createScenarioMatrixTable(scenario: BenchmarkScenarioResult) {
    const dimensions = summarizeScenarioDimensions(scenario);
    const summary = summarizeScenario(scenario);
    return {
        headers: ["Metric", "Value"],
        rows: [
            ["Cases", String(scenario.cases.length)],
            ["Skipped", String(scenario.skipped.length)],
            ["Samples", String(summary.samples)],
            ["Average/mean ms", formatMs(summary.averageMeanMs)],
            ["Median case median ms", formatMs(summary.medianMs)],
            ["Median case P95 ms", formatMs(summary.p95Ms)],
            ["Setup average/mean ms", formatMs(summary.setupAverageMeanMs)],
            ["Median setup P95 ms", formatMs(summary.setupP95Ms)],
            ["Depths", dimensions.depths.join(", ")],
            ["Widths", dimensions.widths.join(", ")],
            ["Frequencies", dimensions.frequencies.join(", ")],
            ["Callback reads", dimensions.callbackReadModes.join(", ")],
            [
                "Dependency depths",
                formatDimensionList(dimensions.dependencyDepths),
            ],
            [
                "Dependency fan-outs",
                formatDimensionList(dimensions.dependencyFanouts),
            ],
            ["Listener counts", formatDimensionList(dimensions.listenerCounts)],
            ["Effect writes", formatDimensionList(dimensions.effectWrites)],
            [
                "Transaction mutations",
                formatDimensionList(dimensions.transactionMutations),
            ],
            ["Mutation types", dimensions.mutationTypes.join(", ")],
            ["Setup operations", dimensions.setupOperations.join(", ")],
            ["Mutation warnings", String(summary.warnings)],
        ],
    };
}

function createSlowestCaseTable(cases: BenchmarkCaseResult[]) {
    const slowestCases = [...cases]
        .sort((left, right) => right.summary.p95Ms - left.summary.p95Ms)
        .slice(0, 10);
    return {
        headers: [
            "Rank",
            "Depth",
            "Width",
            "Frequency",
            "Read",
            "Scenario detail",
            "Samples",
            "Average/mean ms",
            "Median ms",
            "P95 ms",
            "Max ms",
            "Warnings",
        ],
        rows: slowestCases.map((result, index) => [
            String(index + 1),
            `${result.depthTitle}=${result.depth}`,
            `${result.widthTitle}=${result.width}`,
            `${result.frequencyTitle} (${result.commits})`,
            result.callbackReadMode,
            formatScenarioDetail(result),
            String(result.summary.samples),
            formatMs(result.summary.averageMeanMs),
            formatMs(result.summary.medianMs),
            formatMs(result.summary.p95Ms),
            formatMs(result.summary.maxMs),
            formatWarnings(result),
        ]),
    };
}

function createSetupOperationTable(scenario: BenchmarkScenarioResult) {
    const scenarioSummary = summarizeScenario(scenario);
    const setupSummaries = summarizeScenarioSetupOperations(scenario);
    return {
        headers: [
            "Setup operation",
            "Samples",
            "Average/mean ms",
            "Median ms",
            "P95 ms",
            "Max ms",
            "Vs scenario setup avg",
        ],
        rows: setupSummaries.map((summary) => [
            summary.operation,
            String(summary.samples),
            formatMs(summary.averageMeanMs),
            formatMs(summary.medianMs),
            formatMs(summary.p95Ms),
            formatMs(summary.maxMs),
            formatRelativePercent(
                summary.averageMeanMs,
                scenarioSummary.setupAverageMeanMs
            ),
        ]),
    };
}

function createSlowestSetupCaseTable(cases: BenchmarkCaseResult[]) {
    const slowestCases = [...cases]
        .sort(
            (left, right) => right.setupSummary.p95Ms - left.setupSummary.p95Ms
        )
        .slice(0, 10);
    return {
        headers: [
            "Rank",
            "Depth",
            "Width",
            "Frequency",
            "Read",
            "Scenario detail",
            "Setup samples",
            "Setup average/mean ms",
            "Setup median ms",
            "Setup P95 ms",
            "Setup max ms",
            "Slowest setup operation",
        ],
        rows: slowestCases.map((result, index) => [
            String(index + 1),
            `${result.depthTitle}=${result.depth}`,
            `${result.widthTitle}=${result.width}`,
            `${result.frequencyTitle} (${result.commits})`,
            result.callbackReadMode,
            formatScenarioDetail(result),
            String(result.setupSummary.samples),
            formatMs(result.setupSummary.averageMeanMs),
            formatMs(result.setupSummary.medianMs),
            formatMs(result.setupSummary.p95Ms),
            formatMs(result.setupSummary.maxMs),
            formatSlowestSetupOperation(result),
        ]),
    };
}

function createMutationTable(scenario: BenchmarkScenarioResult) {
    const scenarioSummary = summarizeScenario(scenario);
    const mutationSummaries = summarizeScenarioMutations(scenario);
    return {
        headers: [
            "Mutation type",
            "Samples",
            "Average/mean ms",
            "Median ms",
            "P95 ms",
            "Max ms",
            "Vs scenario avg",
            "Warnings",
        ],
        rows: mutationSummaries.map((summary) => [
            summary.mutationType,
            String(summary.samples),
            formatMs(summary.averageMeanMs),
            formatMs(summary.medianMs),
            formatMs(summary.p95Ms),
            formatMs(summary.maxMs),
            formatRelativePercent(
                summary.averageMeanMs,
                scenarioSummary.averageMeanMs
            ),
            String(summary.warnings),
        ]),
    };
}

function createSkippedTable(skippedCases: SkippedBenchmarkCase[]) {
    return {
        headers: [
            "Scenario",
            "Depth title",
            "Depth",
            "Width title",
            "Width",
            "Frequency title",
            "Commits",
            "Callback read",
            "Dependency depth",
            "Dependency fanout",
            "Listener count",
            "Effect writes",
            "Tx mutations",
            "Reason",
        ],
        rows: skippedCases.map((skipped) => [
            skipped.scenarioTitle,
            skipped.depthTitle,
            String(skipped.depth),
            skipped.widthTitle,
            String(skipped.width),
            skipped.frequencyTitle,
            String(skipped.commits),
            skipped.callbackReadMode,
            skipped.dependencyDepth === undefined
                ? ""
                : String(skipped.dependencyDepth),
            skipped.dependencyFanout === undefined
                ? ""
                : String(skipped.dependencyFanout),
            skipped.listenerCount === undefined
                ? ""
                : String(skipped.listenerCount),
            skipped.effectWrites === undefined
                ? ""
                : String(skipped.effectWrites),
            skipped.transactionMutations === undefined
                ? ""
                : String(skipped.transactionMutations),
            skipped.reason,
        ]),
    };
}

function createScenarioSummaryTable(scenarios: BenchmarkScenarioResult[]) {
    return {
        headers: [
            "Scenario",
            "Cases",
            "Skipped",
            "Samples",
            "Average/mean ms",
            "Median ms",
            "P95 ms",
            "Setup P95 ms",
            "Warnings",
        ],
        rows: scenarios.map((scenario) => {
            const summary = summarizeScenario(scenario);
            return [
                scenario.title,
                String(scenario.cases.length),
                String(scenario.skipped.length),
                String(summary.samples),
                formatMs(summary.averageMeanMs),
                formatMs(summary.medianMs),
                formatMs(summary.p95Ms),
                formatMs(summary.setupP95Ms),
                String(summary.warnings),
            ];
        }),
    };
}

function summarizeScenario(scenario: BenchmarkScenarioResult) {
    let weightedAverageTotal = 0;
    let weightedSetupAverageTotal = 0;
    let samples = 0;
    let setupSamples = 0;
    let warnings = 0;
    const medians: number[] = [];
    const p95s: number[] = [];
    const setupP95s: number[] = [];

    for (const benchmarkCase of scenario.cases) {
        weightedAverageTotal =
            weightedAverageTotal +
            benchmarkCase.summary.averageMeanMs * benchmarkCase.summary.samples;
        weightedSetupAverageTotal =
            weightedSetupAverageTotal +
            benchmarkCase.setupSummary.averageMeanMs *
                benchmarkCase.setupSummary.samples;
        samples = samples + benchmarkCase.summary.samples;
        setupSamples = setupSamples + benchmarkCase.setupSummary.samples;
        warnings = warnings + benchmarkCase.warnings.length;
        medians.push(benchmarkCase.summary.medianMs);
        p95s.push(benchmarkCase.summary.p95Ms);
        setupP95s.push(benchmarkCase.setupSummary.p95Ms);
    }

    if (samples === 0) {
        return {
            averageMeanMs: 0,
            medianMs: 0,
            p95Ms: 0,
            samples,
            setupAverageMeanMs: 0,
            setupP95Ms: 0,
            setupSamples,
            warnings,
        };
    }

    return {
        averageMeanMs: weightedAverageTotal / samples,
        medianMs: median(medians),
        p95Ms: median(p95s),
        samples,
        setupAverageMeanMs:
            setupSamples === 0 ? 0 : weightedSetupAverageTotal / setupSamples,
        setupP95Ms: median(setupP95s),
        setupSamples,
        warnings,
    };
}

function summarizeScenarioDimensions(scenario: BenchmarkScenarioResult) {
    return {
        callbackReadModes: uniqueSortedStrings(
            scenario.cases.map(
                (benchmarkCase) => benchmarkCase.callbackReadMode
            )
        ),
        dependencyDepths: uniqueSortedNumbers(
            scenario.cases.map((benchmarkCase) => benchmarkCase.dependencyDepth)
        ),
        dependencyFanouts: uniqueSortedNumbers(
            scenario.cases.map(
                (benchmarkCase) => benchmarkCase.dependencyFanout
            )
        ),
        depths: uniqueSortedStrings(
            scenario.cases.map(
                (benchmarkCase) =>
                    `${benchmarkCase.depthTitle}=${benchmarkCase.depth}`
            )
        ),
        effectWrites: uniqueSortedNumbers(
            scenario.cases.map((benchmarkCase) => benchmarkCase.effectWrites)
        ),
        frequencies: uniqueSortedStrings(
            scenario.cases.map(
                (benchmarkCase) =>
                    `${benchmarkCase.frequencyTitle}=${benchmarkCase.commits}`
            )
        ),
        listenerCounts: uniqueSortedNumbers(
            scenario.cases.map((benchmarkCase) => benchmarkCase.listenerCount)
        ),
        mutationTypes: uniqueSortedStrings(
            scenario.cases.flatMap((benchmarkCase) =>
                benchmarkCase.mutationSummaries.map(
                    (summary) => summary.mutationType
                )
            )
        ),
        setupOperations: uniqueSortedStrings(
            scenario.cases.flatMap((benchmarkCase) =>
                benchmarkCase.setupSummaries.map((summary) => summary.operation)
            )
        ),
        transactionMutations: uniqueSortedNumbers(
            scenario.cases.map(
                (benchmarkCase) => benchmarkCase.transactionMutations
            )
        ),
        widths: uniqueSortedStrings(
            scenario.cases.map(
                (benchmarkCase) =>
                    `${benchmarkCase.widthTitle}=${benchmarkCase.width}`
            )
        ),
    };
}

function summarizeScenarioMutations(scenario: BenchmarkScenarioResult) {
    const durationsByMutation = new Map<string, number[]>();
    const warningCountsByMutation = new Map<string, number>();

    for (const benchmarkCase of scenario.cases) {
        for (const measurement of benchmarkCase.measurements) {
            const durations =
                durationsByMutation.get(measurement.mutationType) ?? [];
            durations.push(measurement.durationMs);
            durationsByMutation.set(measurement.mutationType, durations);
        }
        for (const warning of benchmarkCase.warnings) {
            warningCountsByMutation.set(
                warning.mutationType,
                (warningCountsByMutation.get(warning.mutationType) ?? 0) + 1
            );
        }
    }

    return [...durationsByMutation.entries()]
        .map(([mutationType, durations]) => ({
            ...summarizeDurationsForReport(durations),
            mutationType,
            warnings: warningCountsByMutation.get(mutationType) ?? 0,
        }))
        .sort((left, right) => right.p95Ms - left.p95Ms);
}

function summarizeScenarioSetupOperations(scenario: BenchmarkScenarioResult) {
    const durationsByOperation = new Map<string, number[]>();

    for (const benchmarkCase of scenario.cases) {
        for (const measurement of benchmarkCase.setupMeasurements) {
            const durations =
                durationsByOperation.get(measurement.operation) ?? [];
            durations.push(measurement.durationMs);
            durationsByOperation.set(measurement.operation, durations);
        }
    }

    return [...durationsByOperation.entries()]
        .map(([operation, durations]) => ({
            ...summarizeDurationsForReport(durations),
            operation,
        }))
        .sort((left, right) => right.p95Ms - left.p95Ms);
}

function summarizeDurationsForReport(durationsMs: number[]) {
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

    const sorted = [...durationsMs].sort((a, b) => a - b);
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

function createJsonResults(results: BenchmarkResults) {
    return {
        ...results,
        analysis: {
            scenarios: results.scenarios.map((scenario) => ({
                dimensions: summarizeScenarioDimensions(scenario),
                mutationSummaries: summarizeScenarioMutations(scenario).map(
                    (summary) => ({
                        averageMeanMs: summary.averageMeanMs,
                        maxMs: summary.maxMs,
                        medianMs: summary.medianMs,
                        minMs: summary.minMs,
                        mutationType: summary.mutationType,
                        p95Ms: summary.p95Ms,
                        samples: summary.samples,
                        warningCount: summary.warnings,
                    })
                ),
                mutationWarnings: scenario.cases.flatMap((benchmarkCase) =>
                    benchmarkCase.warnings.map((warning) => ({
                        ...formatCaseDimensionsForJson(benchmarkCase),
                        ...warning,
                    }))
                ),
                scenarioId: scenario.scenarioId,
                setupSummaries: summarizeScenarioSetupOperations(scenario),
                slowestSetupCases: [...scenario.cases]
                    .sort(
                        (left, right) =>
                            right.setupSummary.p95Ms - left.setupSummary.p95Ms
                    )
                    .slice(0, 10)
                    .map((benchmarkCase) => ({
                        ...formatCaseDimensionsForJson(benchmarkCase),
                        setupSummary: benchmarkCase.setupSummary,
                        slowestSetupOperation:
                            formatSlowestSetupOperation(benchmarkCase),
                    })),
                slowestCases: [...scenario.cases]
                    .sort(
                        (left, right) =>
                            right.summary.p95Ms - left.summary.p95Ms
                    )
                    .slice(0, 10)
                    .map((benchmarkCase) => ({
                        ...formatCaseDimensionsForJson(benchmarkCase),
                        summary: benchmarkCase.summary,
                        warnings: benchmarkCase.warnings,
                    })),
                summary: summarizeScenario(scenario),
                title: scenario.title,
            })),
        },
    };
}

function formatCaseDimensionsForJson(benchmarkCase: BenchmarkCaseResult) {
    return {
        callbackReadMode: benchmarkCase.callbackReadMode,
        commits: benchmarkCase.commits,
        dependencyDepth: benchmarkCase.dependencyDepth,
        dependencyFanout: benchmarkCase.dependencyFanout,
        depth: benchmarkCase.depth,
        depthTitle: benchmarkCase.depthTitle,
        effectWrites: benchmarkCase.effectWrites,
        frequencyTitle: benchmarkCase.frequencyTitle,
        listenerCount: benchmarkCase.listenerCount,
        scenarioDetail: formatScenarioDetail(benchmarkCase),
        transactionMutations: benchmarkCase.transactionMutations,
        width: benchmarkCase.width,
        widthTitle: benchmarkCase.widthTitle,
    };
}

function formatScenarioDetail(result: BenchmarkCaseResult) {
    const details: string[] = [];
    if (result.dependencyDepth !== undefined) {
        details.push(`dependency depth ${result.dependencyDepth}`);
    }
    if (result.dependencyFanout !== undefined) {
        details.push(`dependency fan-out ${result.dependencyFanout}`);
    }
    if (result.listenerCount !== undefined) {
        details.push(`listeners ${result.listenerCount}`);
    }
    if (result.effectWrites !== undefined) {
        details.push(`effect writes ${result.effectWrites}`);
    }
    if (result.transactionMutations !== undefined) {
        details.push(`tx mutations ${result.transactionMutations}`);
    }
    return details.length === 0 ? "base" : details.join(", ");
}

function formatSlowestSetupOperation(result: BenchmarkCaseResult) {
    const slowest = [...result.setupSummaries].sort(
        (left, right) => right.p95Ms - left.p95Ms
    )[0];
    if (slowest === undefined) {
        return "";
    }
    return `${slowest.operation} (${formatMs(slowest.p95Ms)} ms P95)`;
}

function formatDimensionList(values: number[]) {
    if (values.length === 0) {
        return "n/a";
    }
    return values.map(String).join(", ");
}

function formatRelativePercent(value: number, baseline: number) {
    if (baseline === 0) {
        return "n/a";
    }
    const percentage = ((value - baseline) / baseline) * 100;
    const prefix = percentage >= 0 ? "+" : "";
    return `${prefix}${percentage.toFixed(1)}%`;
}

function uniqueSortedStrings(values: string[]) {
    return [...new Set(values)].sort((left, right) =>
        left.localeCompare(right)
    );
}

function uniqueSortedNumbers(values: Array<number | undefined>) {
    const numbers = values.filter((value) => value !== undefined);
    return [...new Set(numbers)].sort((left, right) => left - right);
}

interface RenderAlignedTableOptions {
    format: "console" | "markdown";
    skippedTable?: boolean;
}

function renderAlignedTable(
    headers: string[],
    rows: string[][],
    options: RenderAlignedTableOptions
) {
    validateTableRows(headers, rows);

    const escapedHeaders = headers.map(escapeTableCell);
    const escapedRows = rows.map((row) => row.map(escapeTableCell));
    const widths = getColumnWidths(escapedHeaders, escapedRows);
    const separator = widths.map((width) => "-".repeat(Math.max(width, 3)));

    return [
        renderAlignedTableRow(escapedHeaders, widths, {
            ...options,
            role: "header",
        }),
        renderAlignedTableRow(separator, widths, {
            ...options,
            role: "separator",
        }),
        ...escapedRows.map((row) =>
            renderAlignedTableRow(row, widths, {
                ...options,
                role: "body",
            })
        ),
    ].join("\n");
}

function validateTableRows(headers: string[], rows: string[][]) {
    if (headers.length === 0) {
        throw new Error("Cannot render a benchmark table without headers.");
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        if (row.length !== headers.length) {
            throw new Error(
                `Cannot render benchmark table row ${rowIndex}: expected ${headers.length} columns, received ${row.length}.`
            );
        }
    }
}

function getColumnWidths(headers: string[], rows: string[][]) {
    return headers.map((header, columnIndex) => {
        let maxWidth = getVisibleWidth(header);
        for (const row of rows) {
            const cellWidth = getVisibleWidth(row[columnIndex]);
            if (cellWidth > maxWidth) {
                maxWidth = cellWidth;
            }
        }
        return maxWidth;
    });
}

interface RenderAlignedTableRowOptions extends RenderAlignedTableOptions {
    role: "body" | "header" | "separator";
}

function renderAlignedTableRow(
    values: string[],
    widths: number[],
    options: RenderAlignedTableRowOptions
) {
    const cells = values.map((value, columnIndex) => {
        const paddedValue = padVisibleEnd(value, widths[columnIndex]);
        if (options.format === "markdown") {
            return paddedValue;
        }
        return styleConsoleTableCell(paddedValue, {
            columnIndex,
            options,
        });
    });

    return `| ${cells.join(" | ")} |`;
}

function styleConsoleTableCell(
    value: string,
    context: {
        columnIndex: number;
        options: RenderAlignedTableRowOptions;
    }
) {
    if (context.options.role === "header") {
        return colorize(value, "bold", "cyan");
    }
    if (context.options.role === "separator") {
        return colorize(value, "dim");
    }
    if (context.columnIndex === 0) {
        return colorize(value, "bold", "magenta");
    }
    if (
        context.options.skippedTable &&
        context.options.role === "body" &&
        context.columnIndex === 13
    ) {
        return colorize(value, "yellow");
    }
    if (context.options.role === "body" && value.includes("above")) {
        return colorize(value, "yellow");
    }
    if (isNumericTableValue(value)) {
        return colorize(value, "green");
    }
    return value;
}

function padVisibleEnd(value: string, width: number) {
    const padding = width - getVisibleWidth(value);
    if (padding <= 0) {
        return value;
    }
    return `${value}${" ".repeat(padding)}`;
}

function getVisibleWidth(value: string) {
    return stripAnsi(value).length;
}

function escapeTableCell(value: string) {
    return value.replace(/\|/g, "\\|");
}

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_STYLE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

function stripAnsi(value: string) {
    return value.replace(ANSI_STYLE_PATTERN, "");
}

type ConsoleStyle = "bold" | "cyan" | "dim" | "green" | "magenta" | "yellow";

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

function isNumericTableValue(value: string) {
    return /^ *\d+(?:\.\d+)? *$/.test(value);
}

function formatMs(value: number) {
    return value.toFixed(6);
}

function formatWarnings(result: BenchmarkCaseResult) {
    if (result.warnings.length === 0) {
        return "";
    }
    return result.warnings.map((warning) => warning.detail).join("; ");
}

function median(values: number[]) {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[middle];
    }
    const lower = sorted[middle - 1];
    const upper = sorted[middle];
    if (lower === undefined) {
        throw new Error(
            "Cannot calculate median because lower value is missing."
        );
    }
    if (upper === undefined) {
        throw new Error(
            "Cannot calculate median because upper value is missing."
        );
    }
    return (lower + upper) / 2;
}

function percentile(sortedValues: number[], percentileValue: number) {
    if (sortedValues.length === 0) {
        return 0;
    }
    const nearestRankIndex = Math.ceil(
        (percentileValue / 100) * sortedValues.length
    );
    return sortedValues[Math.max(nearestRankIndex - 1, 0)] ?? 0;
}
