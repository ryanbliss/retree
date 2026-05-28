import os from "node:os";
import { performance } from "node:perf_hooks";
import { Retree } from "@retreejs/core";
import {
    BenchmarkNode,
    configureBenchmarkChangedEffect,
    configureBenchmarkDependencyMirror,
    createBenchmarkDependentNodes,
    createBenchmarkLeaf,
    createBenchmarkTree,
    setBenchmarkDependencies,
} from "./tree";
import { summarizeDurations } from "./stats";
import {
    BenchmarkCaseResult,
    BenchmarkConfig,
    BenchmarkMeasurement,
    BenchmarkMutationSummary,
    BenchmarkPhase,
    BenchmarkProgressEvent,
    BenchmarkResults,
    BenchmarkScenarioResult,
    BenchmarkSetupMeasurement,
    BenchmarkSetupOperation,
    BenchmarkSetupSummary,
    BenchmarkWarning,
    BenchmarkWorkEstimate,
    CallbackReadMode,
    MutationType,
    ScenarioId,
    SelectionMode,
    SkippedBenchmarkCase,
    TierDefinition,
} from "./types";

type ListenerEvent = "nodeChanged" | "treeChanged";

export interface BenchmarkScenarioDefinition {
    id: ScenarioId;
    title: string;
}

interface BenchmarkVariant {
    dependencyDepth?: number;
    dependencyFanout?: number;
    effectWrites?: number;
    listenerCount?: number;
    selectionMode?: SelectionMode;
    transactionMutations?: number;
}

interface BenchmarkRunContext extends BenchmarkVariant {
    callbackReadMode: CallbackReadMode;
    config: BenchmarkConfig;
    depthTier: TierDefinition;
    frequencyTier: TierDefinition;
    scenario: BenchmarkScenarioDefinition;
    widthTier: TierDefinition;
}

export interface RunBenchmarksProgressOptions {
    onProgress?: (event: BenchmarkProgressEvent) => void;
    shouldStop?: () => boolean;
    waitForTurn?: (event: BenchmarkProgressEvent) => Promise<void>;
}

interface BenchmarkProgressState extends BenchmarkWorkEstimate {
    caseIndex: number;
    lastOperationDurationMs?: number;
    operationIndex: number;
    phaseIndex: number;
}

export class BenchmarkStoppedError extends Error {
    constructor() {
        super("Benchmark stopped before completion.");
        this.name = "BenchmarkStoppedError";
    }
}

const SCENARIOS: BenchmarkScenarioDefinition[] = [
    {
        id: "direct-node-changed",
        title: "Direct nodeChanged",
    },
    {
        id: "root-tree-changed",
        title: "Root treeChanged",
    },
    {
        id: "listener-fan-out-node-changed",
        title: "Listener fan-out nodeChanged",
    },
    {
        id: "distinct-node-listeners",
        title: "Distinct node listeners",
    },
    {
        id: "ancestor-tree-changed-fan-out",
        title: "Ancestor treeChanged fan-out",
    },
    {
        id: "reactive-dependency-node-changed",
        title: "Reactive dependency nodeChanged",
    },
    {
        id: "reactive-dependency-fan-out",
        title: "Reactive dependency fan-out",
    },
    {
        id: "reactive-dependency-update-fan-out",
        title: "Reactive dependency update fan-out",
    },
    {
        id: "on-changed-effect",
        title: "onChanged effect",
    },
    {
        id: "subscription-churn",
        title: "Subscription churn",
    },
    {
        id: "run-transaction",
        title: "runTransaction",
    },
    {
        id: "select-vs-tree-traversal",
        title: "Reactive select vs tree traversal",
    },
];

const MAX_MUTATION_COLLECTION_SIZE = 32;

let callbackReadSink = 0;

export function runBenchmarks(config: BenchmarkConfig): BenchmarkResults {
    const scenarioResults: BenchmarkScenarioResult[] = [];

    for (const scenario of SCENARIOS) {
        const cases: BenchmarkCaseResult[] = [];
        const skipped: SkippedBenchmarkCase[] = [];

        for (const depthTierName of config.selectedDepthTiers) {
            const depthTier = config.profile.depthTiers[depthTierName];
            for (const frequencyTierName of config.selectedFrequencyTiers) {
                const frequencyTier =
                    config.profile.frequencyTiers[frequencyTierName];
                for (const widthTier of config.widthTiers) {
                    for (const callbackReadMode of getCallbackReadModes(
                        config,
                        scenario.id
                    )) {
                        const variants = createScenarioVariants({
                            config,
                            depthTier,
                            frequencyTier,
                            scenario,
                        });

                        for (const variant of variants.cases) {
                            cases.push(
                                runBenchmarkCase({
                                    ...variant,
                                    callbackReadMode,
                                    config,
                                    depthTier,
                                    frequencyTier,
                                    scenario,
                                    widthTier,
                                })
                            );
                        }

                        for (const skippedVariant of variants.skipped) {
                            skipped.push(
                                createSkippedCase({
                                    ...skippedVariant.variant,
                                    callbackReadMode,
                                    depthTier,
                                    frequencyTier,
                                    reason: skippedVariant.reason,
                                    scenario,
                                    widthTier,
                                })
                            );
                        }
                    }
                }
            }
        }

        scenarioResults.push({
            cases,
            scenarioId: scenario.id,
            skipped,
            title: scenario.title,
        });
    }

    return {
        metadata: createBenchmarkMetadata(config),
        scenarios: scenarioResults,
    };
}

export function getBenchmarkScenarioDefinitions() {
    return SCENARIOS.map((scenario) => ({ ...scenario }));
}

export async function runBenchmarksWithProgress(
    config: BenchmarkConfig,
    progressOptions: RunBenchmarksProgressOptions = {}
): Promise<BenchmarkResults> {
    const scenarioResults: BenchmarkScenarioResult[] = [];
    const progressState: BenchmarkProgressState = {
        ...estimateBenchmarkWork(config),
        caseIndex: 0,
        lastOperationDurationMs: undefined,
        operationIndex: 0,
        phaseIndex: 0,
    };

    for (const scenario of SCENARIOS) {
        const cases: BenchmarkCaseResult[] = [];
        const skipped: SkippedBenchmarkCase[] = [];

        for (const depthTierName of config.selectedDepthTiers) {
            const depthTier = config.profile.depthTiers[depthTierName];
            for (const frequencyTierName of config.selectedFrequencyTiers) {
                const frequencyTier =
                    config.profile.frequencyTiers[frequencyTierName];
                for (const widthTier of config.widthTiers) {
                    for (const callbackReadMode of getCallbackReadModes(
                        config,
                        scenario.id
                    )) {
                        const variants = createScenarioVariants({
                            config,
                            depthTier,
                            frequencyTier,
                            scenario,
                        });

                        for (const variant of variants.cases) {
                            cases.push(
                                await runBenchmarkCaseWithProgress(
                                    {
                                        ...variant,
                                        callbackReadMode,
                                        config,
                                        depthTier,
                                        frequencyTier,
                                        scenario,
                                        widthTier,
                                    },
                                    progressState,
                                    progressOptions
                                )
                            );
                        }

                        for (const skippedVariant of variants.skipped) {
                            skipped.push(
                                createSkippedCase({
                                    ...skippedVariant.variant,
                                    callbackReadMode,
                                    depthTier,
                                    frequencyTier,
                                    reason: skippedVariant.reason,
                                    scenario,
                                    widthTier,
                                })
                            );
                        }
                    }
                }
            }
        }

        scenarioResults.push({
            cases,
            scenarioId: scenario.id,
            skipped,
            title: scenario.title,
        });
    }

    return {
        metadata: createBenchmarkMetadata(config),
        scenarios: scenarioResults,
    };
}

export async function runBenchmarkScenarioWithProgress(
    config: BenchmarkConfig,
    scenarioId: ScenarioId,
    progressOptions: RunBenchmarksProgressOptions = {}
): Promise<BenchmarkScenarioResult> {
    const scenario = resolveScenarioDefinition(scenarioId);
    const progressState: BenchmarkProgressState = {
        ...estimateBenchmarkScenarioWork(config, scenarioId),
        caseIndex: 0,
        lastOperationDurationMs: undefined,
        operationIndex: 0,
        phaseIndex: 0,
    };

    return runScenarioWithProgress(
        config,
        scenario,
        progressState,
        progressOptions
    );
}

export function estimateBenchmarkWork(
    config: BenchmarkConfig
): BenchmarkWorkEstimate {
    return estimateBenchmarkWorkForScenarios(
        config,
        SCENARIOS.map((scenario) => scenario.id)
    );
}

async function runScenarioWithProgress(
    config: BenchmarkConfig,
    scenario: BenchmarkScenarioDefinition,
    progressState: BenchmarkProgressState,
    progressOptions: RunBenchmarksProgressOptions
): Promise<BenchmarkScenarioResult> {
    const cases: BenchmarkCaseResult[] = [];
    const skipped: SkippedBenchmarkCase[] = [];

    for (const depthTierName of config.selectedDepthTiers) {
        const depthTier = config.profile.depthTiers[depthTierName];
        for (const frequencyTierName of config.selectedFrequencyTiers) {
            const frequencyTier =
                config.profile.frequencyTiers[frequencyTierName];
            for (const widthTier of config.widthTiers) {
                for (const callbackReadMode of getCallbackReadModes(
                    config,
                    scenario.id
                )) {
                    const variants = createScenarioVariants({
                        config,
                        depthTier,
                        frequencyTier,
                        scenario,
                    });

                    for (const variant of variants.cases) {
                        cases.push(
                            await runBenchmarkCaseWithProgress(
                                {
                                    ...variant,
                                    callbackReadMode,
                                    config,
                                    depthTier,
                                    frequencyTier,
                                    scenario,
                                    widthTier,
                                },
                                progressState,
                                progressOptions
                            )
                        );
                    }

                    for (const skippedVariant of variants.skipped) {
                        skipped.push(
                            createSkippedCase({
                                ...skippedVariant.variant,
                                callbackReadMode,
                                depthTier,
                                frequencyTier,
                                reason: skippedVariant.reason,
                                scenario,
                                widthTier,
                            })
                        );
                    }
                }
            }
        }
    }

    return {
        cases,
        scenarioId: scenario.id,
        skipped,
        title: scenario.title,
    };
}

function resolveScenarioDefinition(scenarioId: ScenarioId) {
    const scenario = SCENARIOS.find((candidate) => candidate.id === scenarioId);
    if (scenario === undefined) {
        throw new Error(`Unknown benchmark scenario id: ${scenarioId}.`);
    }
    return scenario;
}

export function estimateBenchmarkScenarioWork(
    config: BenchmarkConfig,
    scenarioId: ScenarioId
): BenchmarkWorkEstimate {
    return estimateBenchmarkWorkForScenarios(config, [scenarioId]);
}

function estimateBenchmarkWorkForScenarios(
    config: BenchmarkConfig,
    scenarioIds: ScenarioId[]
): BenchmarkWorkEstimate {
    let totalCases = 0;
    let totalOperations = 0;
    let totalSkippedCases = 0;

    for (const scenario of SCENARIOS) {
        if (!scenarioIds.includes(scenario.id)) {
            continue;
        }
        for (const depthTierName of config.selectedDepthTiers) {
            const depthTier = config.profile.depthTiers[depthTierName];
            for (const frequencyTierName of config.selectedFrequencyTiers) {
                const frequencyTier =
                    config.profile.frequencyTiers[frequencyTierName];
                for (const widthTier of config.widthTiers) {
                    void widthTier;
                    for (const callbackReadMode of getCallbackReadModes(
                        config,
                        scenario.id
                    )) {
                        void callbackReadMode;
                        const variants = createScenarioVariants({
                            config,
                            depthTier,
                            frequencyTier,
                            scenario,
                        });
                        totalCases = totalCases + variants.cases.length;
                        totalSkippedCases =
                            totalSkippedCases + variants.skipped.length;
                        totalOperations =
                            totalOperations +
                            variants.cases.length *
                                (1 +
                                    config.profile.warmupCommits +
                                    frequencyTier.value);
                    }
                }
            }
        }
    }

    return {
        totalCases,
        totalOperations,
        totalPhases: totalCases * 3,
        totalSkippedCases,
    };
}

function createScenarioVariants(options: {
    config: BenchmarkConfig;
    depthTier: TierDefinition;
    frequencyTier: TierDefinition;
    scenario: BenchmarkScenarioDefinition;
}) {
    const cases: BenchmarkVariant[] = [];
    const skipped: Array<{
        reason: string;
        variant: BenchmarkVariant;
    }> = [];

    if (options.scenario.id === "reactive-dependency-node-changed") {
        for (const dependencyDepth of options.config.dependencyDepths) {
            if (dependencyDepth > options.depthTier.value) {
                skipped.push({
                    reason: `Dependency depth ${dependencyDepth} is deeper than tree depth ${options.depthTier.value}.`,
                    variant: {
                        dependencyDepth,
                    },
                });
                continue;
            }
            cases.push({
                dependencyDepth,
            });
        }
        return {
            cases,
            skipped,
        };
    }

    if (
        options.scenario.id === "reactive-dependency-fan-out" ||
        options.scenario.id === "reactive-dependency-update-fan-out"
    ) {
        for (const dependencyDepth of options.config.dependencyDepths) {
            for (const dependencyFanout of options.config.dependencyFanouts) {
                if (dependencyDepth > options.depthTier.value) {
                    skipped.push({
                        reason: `Dependency depth ${dependencyDepth} is deeper than tree depth ${options.depthTier.value}.`,
                        variant: {
                            dependencyDepth,
                            dependencyFanout,
                        },
                    });
                    continue;
                }
                cases.push({
                    dependencyDepth,
                    dependencyFanout,
                });
            }
        }
        return {
            cases,
            skipped,
        };
    }

    if (
        options.scenario.id === "listener-fan-out-node-changed" ||
        options.scenario.id === "distinct-node-listeners"
    ) {
        for (const listenerCount of options.config.listenerFanouts) {
            cases.push({
                listenerCount,
            });
        }
        return {
            cases,
            skipped,
        };
    }

    if (options.scenario.id === "on-changed-effect") {
        for (const effectWrites of options.config.effectWrites) {
            cases.push({
                effectWrites,
            });
        }
        return {
            cases,
            skipped,
        };
    }

    if (options.scenario.id === "run-transaction") {
        for (const transactionMutations of options.config
            .transactionMutations) {
            cases.push({
                transactionMutations,
            });
        }
        return {
            cases,
            skipped,
        };
    }

    if (options.scenario.id === "select-vs-tree-traversal") {
        cases.push({
            selectionMode: "reactive-dependency-select",
        });
        cases.push({
            selectionMode: "root-tree-traversal",
        });
        return {
            cases,
            skipped,
        };
    }

    cases.push({});
    return {
        cases,
        skipped,
    };
}

function runBenchmarkCase(options: BenchmarkRunContext): BenchmarkCaseResult {
    const setupStartedAt = performance.now();
    const prepared = prepareBenchmarkCase(options);
    const measurements: BenchmarkMeasurement[] = [];
    let listenerCalls = 0;
    let timerStartedAt: number | null = null;
    let measuredDurationMs = 0;

    try {
        prepared.subscriptions.activate((reproxiedNode) => {
            if (timerStartedAt === null) {
                throw new Error(
                    `${options.scenario.title}: listener fired before the benchmark timer was started.`
                );
            }
            consumeCallbackRead(reproxiedNode, options.callbackReadMode);
            listenerCalls++;
            measuredDurationMs = performance.now() - timerStartedAt;
        });
        recordSetupOperationDuration(
            prepared.setupMeasurements,
            "case-setup-total",
            performance.now() - setupStartedAt
        );

        for (
            let warmupIndex = 0;
            warmupIndex < options.config.profile.warmupCommits;
            warmupIndex++
        ) {
            const mutationType = resolveMutationType(options, warmupIndex);
            runCommit({
                commitIndex: warmupIndex,
                expectedCalls: prepared.subscriptions.expectedCalls,
                listenerCalls: () => listenerCalls,
                mutationTarget: resolvePreparedMutationTarget(prepared),
                mutationType,
                onBeforeCommit: () => {
                    listenerCalls = 0;
                    measuredDurationMs = 0;
                    timerStartedAt = performance.now();
                },
                onCommitFinished: () => {
                    timerStartedAt = null;
                },
                options,
                phase: "warmup",
                recordManualDuration: (durationMs) => {
                    measuredDurationMs = durationMs;
                },
            });
        }

        for (
            let commitIndex = 0;
            commitIndex < options.frequencyTier.value;
            commitIndex++
        ) {
            const mutationType = resolveMutationType(options, commitIndex);
            runCommit({
                commitIndex,
                expectedCalls: prepared.subscriptions.expectedCalls,
                listenerCalls: () => listenerCalls,
                mutationTarget: resolvePreparedMutationTarget(prepared),
                mutationType,
                onBeforeCommit: () => {
                    listenerCalls = 0;
                    measuredDurationMs = 0;
                    timerStartedAt = performance.now();
                },
                onCommitFinished: () => {
                    timerStartedAt = null;
                },
                options,
                phase: "measured",
                recordManualDuration: (durationMs) => {
                    measuredDurationMs = durationMs;
                },
            });
            measurements.push({
                durationMs: measuredDurationMs,
                mutationType,
            });
        }
    } finally {
        for (const unsubscribe of prepared.subscriptions.unsubscribe) {
            unsubscribe();
        }
        Retree.clearListeners(prepared.tree.root, false);
    }

    return createBenchmarkCaseResult(
        options,
        measurements,
        prepared.setupMeasurements
    );
}

async function runBenchmarkCaseWithProgress(
    options: BenchmarkRunContext,
    progressState: BenchmarkProgressState,
    progressOptions: RunBenchmarksProgressOptions
): Promise<BenchmarkCaseResult> {
    const measurements: BenchmarkMeasurement[] = [];
    let listenerCalls = 0;
    let timerStartedAt: number | null = null;
    let measuredDurationMs = 0;

    progressState.caseIndex++;
    progressState.phaseIndex++;

    await waitForBenchmarkTurn({
        commitIndex: 0,
        commitsInPhase: 1,
        options,
        phase: "setup",
        progressOptions,
        progressState,
    });

    const setupStartedAt = performance.now();
    const prepared = prepareBenchmarkCase(options);

    try {
        prepared.subscriptions.activate((reproxiedNode) => {
            if (timerStartedAt === null) {
                throw new Error(
                    `${options.scenario.title}: listener fired before the benchmark timer was started.`
                );
            }
            consumeCallbackRead(reproxiedNode, options.callbackReadMode);
            listenerCalls++;
            measuredDurationMs = performance.now() - timerStartedAt;
        });
        const setupDurationMs = performance.now() - setupStartedAt;
        recordSetupOperationDuration(
            prepared.setupMeasurements,
            "case-setup-total",
            setupDurationMs
        );
        progressState.lastOperationDurationMs = summarizeDurations([
            setupDurationMs,
        ]).maxMs;
        progressState.operationIndex++;

        progressState.phaseIndex++;
        for (
            let warmupIndex = 0;
            warmupIndex < options.config.profile.warmupCommits;
            warmupIndex++
        ) {
            await waitForBenchmarkTurn({
                commitIndex: warmupIndex,
                commitsInPhase: options.config.profile.warmupCommits,
                options,
                phase: "warmup",
                progressOptions,
                progressState,
            });
            const mutationType = resolveMutationType(options, warmupIndex);
            runCommit({
                commitIndex: warmupIndex,
                expectedCalls: prepared.subscriptions.expectedCalls,
                listenerCalls: () => listenerCalls,
                mutationTarget: resolvePreparedMutationTarget(prepared),
                mutationType,
                onBeforeCommit: () => {
                    listenerCalls = 0;
                    measuredDurationMs = 0;
                    timerStartedAt = performance.now();
                },
                onCommitFinished: () => {
                    timerStartedAt = null;
                },
                options,
                phase: "warmup",
                recordManualDuration: (durationMs) => {
                    measuredDurationMs = durationMs;
                },
            });
            progressState.lastOperationDurationMs = measuredDurationMs;
            progressState.operationIndex++;
        }

        progressState.phaseIndex++;
        for (
            let commitIndex = 0;
            commitIndex < options.frequencyTier.value;
            commitIndex++
        ) {
            await waitForBenchmarkTurn({
                commitIndex,
                commitsInPhase: options.frequencyTier.value,
                options,
                phase: "measured",
                progressOptions,
                progressState,
            });
            const mutationType = resolveMutationType(options, commitIndex);
            runCommit({
                commitIndex,
                expectedCalls: prepared.subscriptions.expectedCalls,
                listenerCalls: () => listenerCalls,
                mutationTarget: resolvePreparedMutationTarget(prepared),
                mutationType,
                onBeforeCommit: () => {
                    listenerCalls = 0;
                    measuredDurationMs = 0;
                    timerStartedAt = performance.now();
                },
                onCommitFinished: () => {
                    timerStartedAt = null;
                },
                options,
                phase: "measured",
                recordManualDuration: (durationMs) => {
                    measuredDurationMs = durationMs;
                },
            });
            measurements.push({
                durationMs: measuredDurationMs,
                mutationType,
            });
            progressState.lastOperationDurationMs = measuredDurationMs;
            progressState.operationIndex++;
        }
    } finally {
        for (const unsubscribe of prepared.subscriptions.unsubscribe) {
            unsubscribe();
        }
        Retree.clearListeners(prepared.tree.root, false);
    }

    return createBenchmarkCaseResult(
        options,
        measurements,
        prepared.setupMeasurements
    );
}

function prepareBenchmarkCase(options: BenchmarkRunContext) {
    const setupMeasurements: BenchmarkSetupMeasurement[] = [];
    const tree = createBenchmarkTree({
        depth: options.depthTier.value,
        seed:
            options.config.seed +
            options.depthTier.value +
            options.widthTier.value,
        setupMeasurements,
        width: options.widthTier.value,
    });
    measureFreshBroadValueSetup({
        seed:
            options.config.seed +
            options.depthTier.value * 31 +
            options.widthTier.value * 997,
        setupMeasurements,
        target: tree.target,
        width: options.widthTier.value,
    });
    const subscriptions = subscribeBenchmarkCase({
        ...options,
        setupMeasurements,
        tree,
    });
    const mutationTarget = measureSetupOperation(
        setupMeasurements,
        "mutation-target-resolution",
        () =>
            subscriptions.mutationTarget ??
            resolveMutationTarget({
                dependencyDepth: options.dependencyDepth,
                scenarioId: options.scenario.id,
                tree,
            })
    );

    return {
        mutationTarget,
        setupMeasurements,
        subscriptions,
        tree,
    };
}

function resolvePreparedMutationTarget(prepared: {
    mutationTarget: BenchmarkNode;
    subscriptions: {
        mutationTarget?: BenchmarkNode;
    };
}) {
    return prepared.subscriptions.mutationTarget ?? prepared.mutationTarget;
}

function measureFreshBroadValueSetup(options: {
    seed: number;
    setupMeasurements: BenchmarkSetupMeasurement[];
    target: BenchmarkNode;
    width: number;
}) {
    const broadValueSize = Math.max(1, options.width);
    const broadArray = measureSetupOperation(
        options.setupMeasurements,
        "broad-array-construction",
        () =>
            createMutationLeaves({
                count: broadValueSize,
                mutationType: "array-push",
                options: {
                    commitIndex: 0,
                    target: options.target,
                },
            })
    );
    measureSetupOperation(
        options.setupMeasurements,
        "broad-array-assignment",
        () => {
            options.target.arrayChildren = broadArray;
        }
    );

    const broadObject = measureSetupOperation(
        options.setupMeasurements,
        "broad-object-construction",
        () => {
            const entries: Array<
                [string, ReturnType<typeof createBenchmarkLeaf>]
            > = [];
            for (let index = 0; index < broadValueSize; index++) {
                entries.push([
                    `broad-object-${index}`,
                    createBenchmarkLeaf(
                        `broad-object-${index}`,
                        options.seed + index
                    ),
                ]);
            }
            return Object.fromEntries(entries);
        }
    );
    measureSetupOperation(
        options.setupMeasurements,
        "broad-object-assignment",
        () => {
            options.target.recordChildren = broadObject;
        }
    );

    const broadMap = measureSetupOperation(
        options.setupMeasurements,
        "broad-map-construction",
        () => {
            const entries: Array<
                [string, ReturnType<typeof createBenchmarkLeaf>]
            > = [];
            for (let index = 0; index < broadValueSize; index++) {
                entries.push([
                    `broad-map-${index}`,
                    createBenchmarkLeaf(
                        `broad-map-${index}`,
                        options.seed + broadValueSize + index
                    ),
                ]);
            }
            return new Map(entries);
        }
    );
    measureSetupOperation(
        options.setupMeasurements,
        "broad-map-assignment",
        () => {
            options.target.mapChildren = broadMap;
        }
    );

    const broadPrimitiveMap = measureSetupOperation(
        options.setupMeasurements,
        "broad-primitive-map-construction",
        () => {
            const entries: Array<[string, number]> = [];
            for (let index = 0; index < broadValueSize; index++) {
                entries.push([
                    `broad-primitive-map-${index}`,
                    options.seed + index,
                ]);
            }
            return new Map(entries);
        }
    );
    measureSetupOperation(
        options.setupMeasurements,
        "broad-primitive-map-assignment",
        () => {
            options.target.primitiveMapChildren = broadPrimitiveMap;
        }
    );

    const broadPrimitiveSet = measureSetupOperation(
        options.setupMeasurements,
        "broad-primitive-set-construction",
        () => {
            const values: number[] = [];
            for (let index = 0; index < broadValueSize; index++) {
                values.push(options.seed + broadValueSize + index);
            }
            return new Set(values);
        }
    );
    measureSetupOperation(
        options.setupMeasurements,
        "broad-primitive-set-assignment",
        () => {
            options.target.primitiveSetChildren = broadPrimitiveSet;
        }
    );

    const broadSet = measureSetupOperation(
        options.setupMeasurements,
        "broad-set-construction",
        () => {
            const values: Array<ReturnType<typeof createBenchmarkLeaf>> = [];
            for (let index = 0; index < broadValueSize; index++) {
                values.push(
                    createBenchmarkLeaf(
                        `broad-set-${index}`,
                        options.seed + broadValueSize * 2 + index
                    )
                );
            }
            return new Set(values);
        }
    );
    measureSetupOperation(
        options.setupMeasurements,
        "broad-set-assignment",
        () => {
            options.target.setChildren = broadSet;
        }
    );
}

function createBenchmarkCaseResult(
    options: BenchmarkRunContext,
    measurements: BenchmarkMeasurement[],
    setupMeasurements: BenchmarkSetupMeasurement[]
): BenchmarkCaseResult {
    const durationsMs = measurements.map(
        (measurement) => measurement.durationMs
    );
    const summary = summarizeDurations(durationsMs);
    const mutationSummaries = summarizeMutations(measurements);
    const setupDurationsMs = setupMeasurements.map(
        (measurement) => measurement.durationMs
    );

    return {
        callbackReadMode: options.callbackReadMode,
        commits: options.frequencyTier.value,
        dependencyDepth: options.dependencyDepth,
        dependencyFanout: options.dependencyFanout,
        depth: options.depthTier.value,
        depthTitle: options.depthTier.title,
        durationsMs,
        effectWrites: options.effectWrites,
        frequencyTitle: options.frequencyTier.title,
        listenerCount: options.listenerCount,
        measurements,
        mutationSummaries,
        selectionMode: options.selectionMode,
        scenarioId: options.scenario.id,
        scenarioTitle: options.scenario.title,
        setupMeasurements,
        setupSummaries: summarizeSetupOperations(setupMeasurements),
        setupSummary: summarizeDurations(setupDurationsMs),
        summary,
        transactionMutations: options.transactionMutations,
        warnings: createMutationWarnings(
            summary.averageMeanMs,
            mutationSummaries
        ),
        width: options.widthTier.value,
        widthTitle: options.widthTier.title,
    };
}

async function waitForBenchmarkTurn(options: {
    commitIndex: number;
    commitsInPhase: number;
    options: BenchmarkRunContext;
    phase: BenchmarkPhase;
    progressOptions: RunBenchmarksProgressOptions;
    progressState: BenchmarkProgressState;
}) {
    if (options.progressOptions.shouldStop?.() === true) {
        throw new BenchmarkStoppedError();
    }

    const event: BenchmarkProgressEvent = {
        callbackReadMode: options.options.callbackReadMode,
        caseIndex: options.progressState.caseIndex,
        commitIndex: options.commitIndex + 1,
        commitsInPhase: options.commitsInPhase,
        depth: options.options.depthTier.value,
        depthTitle: options.options.depthTier.title,
        frequencyTitle: options.options.frequencyTier.title,
        lastOperationDurationMs: options.progressState.lastOperationDurationMs,
        operationIndex: options.progressState.operationIndex + 1,
        phase: options.phase,
        phaseIndex: options.progressState.phaseIndex,
        selectionMode: options.options.selectionMode,
        scenarioId: options.options.scenario.id,
        scenarioTitle: options.options.scenario.title,
        totalCases: options.progressState.totalCases,
        totalOperations: options.progressState.totalOperations,
        totalPhases: options.progressState.totalPhases,
        width: options.options.widthTier.value,
        widthTitle: options.options.widthTier.title,
    };

    options.progressOptions.onProgress?.(event);
    await options.progressOptions.waitForTurn?.(event);

    if (options.progressOptions.shouldStop?.() === true) {
        throw new BenchmarkStoppedError();
    }
}

function subscribeBenchmarkCase(
    options: BenchmarkRunContext & {
        setupMeasurements: BenchmarkSetupMeasurement[];
        tree: ReturnType<typeof createBenchmarkTree>;
    }
) {
    const unsubscribe: Array<() => void> = [];
    let mutationTarget: BenchmarkNode | undefined;
    const activate = (
        listener: (reproxiedNode: BenchmarkNode) => void
    ): void => {
        measureSetupOperation(
            options.setupMeasurements,
            "listener-setup-total",
            () => {
                if (options.scenario.id === "subscription-churn") {
                    return;
                }

                if (options.scenario.id === "listener-fan-out-node-changed") {
                    const listenerCount = requireNumber(
                        options.listenerCount,
                        "Listener fan-out benchmark requires listenerCount."
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            for (
                                let index = 0;
                                index < listenerCount;
                                index++
                            ) {
                                unsubscribe.push(
                                    Retree.on(
                                        options.tree.target,
                                        "nodeChanged",
                                        listener
                                    )
                                );
                            }
                        }
                    );
                    return;
                }

                if (options.scenario.id === "distinct-node-listeners") {
                    const listenerCount = requireNumber(
                        options.listenerCount,
                        "Distinct node listeners benchmark requires listenerCount."
                    );
                    const listenerNodes = createBenchmarkDependentNodes({
                        count: listenerCount,
                        seed:
                            options.config.seed +
                            options.depthTier.value +
                            listenerCount,
                        setupMeasurements: options.setupMeasurements,
                    });
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            for (const listenerNode of listenerNodes) {
                                unsubscribe.push(
                                    Retree.on(
                                        listenerNode,
                                        "nodeChanged",
                                        listener
                                    )
                                );
                            }
                        }
                    );
                    mutationTarget = resolveFirstBenchmarkNode(
                        listenerNodes,
                        "Distinct node listeners benchmark requires at least one listener node."
                    );
                    return;
                }

                if (options.scenario.id === "ancestor-tree-changed-fan-out") {
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            for (const node of options.tree.nodesByDepth) {
                                unsubscribe.push(
                                    Retree.on(node, "treeChanged", listener)
                                );
                            }
                        }
                    );
                    return;
                }

                if (
                    options.scenario.id === "reactive-dependency-node-changed"
                ) {
                    const dependencyNode = resolveDependencyNode({
                        dependencyDepth: options.dependencyDepth,
                        tree: options.tree,
                    });
                    measureSetupOperation(
                        options.setupMeasurements,
                        "dependency-linking",
                        () =>
                            setBenchmarkDependencies(options.tree.root, [
                                dependencyNode,
                            ])
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            unsubscribe.push(
                                Retree.on(
                                    options.tree.root,
                                    "nodeChanged",
                                    listener
                                )
                            );
                        }
                    );
                    return;
                }

                if (options.scenario.id === "reactive-dependency-fan-out") {
                    const dependencyNode = resolveDependencyNode({
                        dependencyDepth: options.dependencyDepth,
                        tree: options.tree,
                    });
                    const dependencyFanout = requireNumber(
                        options.dependencyFanout,
                        "Reactive dependency fan-out benchmark requires dependencyFanout."
                    );
                    const dependents = createBenchmarkDependentNodes({
                        count: dependencyFanout,
                        seed:
                            options.config.seed +
                            options.depthTier.value +
                            dependencyFanout,
                        setupMeasurements: options.setupMeasurements,
                    });
                    measureSetupOperation(
                        options.setupMeasurements,
                        "dependency-linking",
                        () => {
                            for (const dependent of dependents) {
                                setBenchmarkDependencies(dependent, [
                                    dependencyNode,
                                ]);
                            }
                        }
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            for (const dependent of dependents) {
                                unsubscribe.push(
                                    Retree.on(
                                        dependent,
                                        "nodeChanged",
                                        listener
                                    )
                                );
                            }
                        }
                    );
                    return;
                }

                if (
                    options.scenario.id === "reactive-dependency-update-fan-out"
                ) {
                    const dependencyNode = resolveDependencyNode({
                        dependencyDepth: options.dependencyDepth,
                        tree: options.tree,
                    });
                    const dependencyFanout = requireNumber(
                        options.dependencyFanout,
                        "Reactive dependency update fan-out benchmark requires dependencyFanout."
                    );
                    const dependents = createBenchmarkDependentNodes({
                        count: dependencyFanout,
                        seed:
                            options.config.seed +
                            options.depthTier.value +
                            dependencyFanout,
                        setupMeasurements: options.setupMeasurements,
                    });
                    measureSetupOperation(
                        options.setupMeasurements,
                        "dependency-linking",
                        () => {
                            for (const dependent of dependents) {
                                setBenchmarkDependencies(dependent, [
                                    dependencyNode,
                                ]);
                            }
                        }
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            for (const dependent of dependents) {
                                unsubscribe.push(
                                    Retree.on(
                                        dependent,
                                        "nodeChanged",
                                        listener
                                    )
                                );
                            }
                        }
                    );
                    mutationTarget = resolveFirstBenchmarkNode(
                        dependents,
                        "Reactive dependency update fan-out benchmark requires at least one dependent node."
                    );
                    return;
                }

                if (options.scenario.id === "on-changed-effect") {
                    const effectWrites = requireNumber(
                        options.effectWrites,
                        "onChanged effect benchmark requires effectWrites."
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "changed-effect-configuration",
                        () =>
                            configureBenchmarkChangedEffect(
                                options.tree.target,
                                effectWrites
                            )
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            unsubscribe.push(
                                Retree.on(
                                    options.tree.target,
                                    "nodeChanged",
                                    listener
                                )
                            );
                        }
                    );
                    return;
                }

                if (options.scenario.id === "select-vs-tree-traversal") {
                    if (options.selectionMode === undefined) {
                        throw new Error(
                            "Reactive select vs tree traversal benchmark requires selectionMode."
                        );
                    }
                    if (
                        options.selectionMode === "reactive-dependency-select"
                    ) {
                        const dependents = createBenchmarkDependentNodes({
                            count: 1,
                            seed:
                                options.config.seed +
                                options.depthTier.value +
                                options.widthTier.value,
                            setupMeasurements: options.setupMeasurements,
                        });
                        const dependent = resolveFirstBenchmarkNode(
                            dependents,
                            "Reactive select vs tree traversal benchmark requires one dependent node."
                        );
                        measureSetupOperation(
                            options.setupMeasurements,
                            "dependency-linking",
                            () => {
                                setBenchmarkDependencies(dependent, [
                                    options.tree.target,
                                ]);
                                configureBenchmarkDependencyMirror(
                                    dependent,
                                    options.tree.target
                                );
                            }
                        );
                        measureSetupOperation(
                            options.setupMeasurements,
                            "listener-registration",
                            () => {
                                unsubscribe.push(
                                    Retree.select(
                                        dependent,
                                        (node) =>
                                            node.value +
                                            node.metadata.stats.version,
                                        (selectedTotal) => {
                                            callbackReadSink =
                                                callbackReadSink +
                                                selectedTotal;
                                            listener(dependent);
                                        }
                                    )
                                );
                            }
                        );
                        return;
                    }
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            unsubscribe.push(
                                Retree.on(
                                    options.tree.root,
                                    "treeChanged",
                                    (reproxiedRoot) => {
                                        callbackReadSink =
                                            callbackReadSink +
                                            readDeepNode(reproxiedRoot);
                                        listener(reproxiedRoot);
                                    }
                                )
                            );
                        }
                    );
                    return;
                }

                const event = resolveListenerEvent(options.scenario.id);
                const listenerNode =
                    options.scenario.id === "root-tree-changed"
                        ? options.tree.root
                        : options.tree.target;
                measureSetupOperation(
                    options.setupMeasurements,
                    "listener-registration",
                    () => {
                        unsubscribe.push(
                            Retree.on(listenerNode, event, listener)
                        );
                    }
                );
            }
        );
    };

    return {
        activate,
        expectedCalls: resolveExpectedCalls(options),
        get mutationTarget() {
            return mutationTarget;
        },
        unsubscribe,
    };
}

function runCommit(options: {
    commitIndex: number;
    expectedCalls: number;
    listenerCalls: () => number;
    mutationTarget: BenchmarkNode;
    mutationType: MutationType;
    onBeforeCommit: () => void;
    onCommitFinished: () => void;
    options: BenchmarkRunContext;
    phase: BenchmarkPhase;
    recordManualDuration: (durationMs: number) => void;
}) {
    options.onBeforeCommit();
    if (options.options.scenario.id === "subscription-churn") {
        const subscriptionStartedAt = performance.now();
        const unsubscribe = Retree.on(
            options.mutationTarget,
            "nodeChanged",
            () => undefined
        );
        unsubscribe();
        options.recordManualDuration(performance.now() - subscriptionStartedAt);
    } else if (options.options.scenario.id === "run-transaction") {
        const transactionMutations = requireNumber(
            options.options.transactionMutations,
            "runTransaction benchmark requires transactionMutations."
        );
        Retree.runTransaction(() => {
            for (
                let mutationIndex = 0;
                mutationIndex < transactionMutations;
                mutationIndex++
            ) {
                applyMutation({
                    commitIndex:
                        options.commitIndex * transactionMutations +
                        mutationIndex,
                    mutationType: options.mutationType,
                    target: options.mutationTarget,
                });
            }
        });
    } else {
        applyMutation({
            commitIndex: options.commitIndex,
            mutationType: options.mutationType,
            target: options.mutationTarget,
        });
    }
    options.onCommitFinished();

    const calls = options.listenerCalls();
    if (calls !== options.expectedCalls) {
        throw new Error(
            `${options.options.scenario.title}: expected ${options.expectedCalls} listener emissions for ${options.phase} commit ${options.commitIndex} at depth tier ${options.options.depthTier.title} (${options.options.depthTier.value}), width tier ${options.options.widthTier.title} (${options.options.widthTier.value}), frequency tier ${options.options.frequencyTier.title} (${options.options.frequencyTier.value}), mutation type ${options.mutationType}, and callback read mode ${options.options.callbackReadMode}, but received ${calls}.`
        );
    }
}

function applyMutation(options: {
    commitIndex: number;
    mutationType: MutationType;
    target: BenchmarkNode;
}) {
    if (options.mutationType === "scalar-set") {
        options.target.value = options.target.value + 1;
        return;
    }
    if (options.mutationType === "array-push") {
        options.target.arrayChildren = createMutationLeaves({
            count: getNextMutationCollectionSize(
                options.target.arrayChildren.length
            ),
            mutationType: options.mutationType,
            options,
        });
        return;
    }
    if (options.mutationType === "map-set") {
        const nextMap = new Map<
            string,
            ReturnType<typeof createBenchmarkLeaf>
        >();
        const leaves = createMutationLeaves({
            count: getNextMutationCollectionSize(
                options.target.mapChildren.size
            ),
            mutationType: options.mutationType,
            options,
        });
        for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
            nextMap.set(
                `map-${options.commitIndex}-${leafIndex}`,
                leaves[leafIndex]
            );
        }
        options.target.mapChildren = nextMap;
        return;
    }
    if (options.mutationType === "object-replace") {
        options.target.metadata = {
            flags: [...options.target.metadata.flags].reverse(),
            label: `${options.target.metadata.label}-${options.commitIndex}`,
            stats: {
                score:
                    options.target.metadata.stats.score +
                    options.commitIndex +
                    0.1,
                version: options.target.metadata.stats.version + 1,
            },
            tags: [
                ...options.target.metadata.tags.slice(1),
                `mutation-${options.commitIndex}`,
            ],
        };
        return;
    }
    if (options.mutationType === "set-add") {
        options.target.setChildren = new Set(
            createMutationLeaves({
                count: getNextMutationCollectionSize(
                    options.target.setChildren.size
                ),
                mutationType: options.mutationType,
                options,
            })
        );
        return;
    }
    if (options.mutationType === "subscription-cycle") {
        return;
    }
}

function getNextMutationCollectionSize(currentSize: number) {
    return Math.min(currentSize + 1, MAX_MUTATION_COLLECTION_SIZE);
}

function createMutationLeaves(options: {
    count: number;
    mutationType: MutationType;
    options: {
        commitIndex: number;
        target: BenchmarkNode;
    };
}) {
    const leaves: Array<ReturnType<typeof createBenchmarkLeaf>> = [];
    for (let leafIndex = 0; leafIndex < options.count; leafIndex++) {
        leaves.push(
            createBenchmarkLeaf(
                `${options.mutationType}-${options.options.commitIndex}-${leafIndex}`,
                options.options.target.value +
                    options.options.commitIndex * 997 +
                    leafIndex
            )
        );
    }
    return leaves;
}

function resolveMutationType(
    options: BenchmarkRunContext,
    commitIndex: number
): MutationType {
    if (options.scenario.id === "subscription-churn") {
        return "subscription-cycle";
    }
    if (options.scenario.id === "select-vs-tree-traversal") {
        return "scalar-set";
    }

    const mutationType =
        options.config.mutationTypes[
            commitIndex % options.config.mutationTypes.length
        ];
    if (mutationType === undefined) {
        throw new Error(
            "Benchmark mutationTypes must contain at least one mutation."
        );
    }
    return mutationType;
}

function resolveMutationTarget(options: {
    dependencyDepth?: number;
    scenarioId: ScenarioId;
    tree: ReturnType<typeof createBenchmarkTree>;
}) {
    if (
        options.scenarioId === "reactive-dependency-node-changed" ||
        options.scenarioId === "reactive-dependency-fan-out"
    ) {
        return resolveDependencyNode({
            dependencyDepth: options.dependencyDepth,
            tree: options.tree,
        });
    }
    return options.tree.target;
}

function resolveDependencyNode(options: {
    dependencyDepth?: number;
    tree: ReturnType<typeof createBenchmarkTree>;
}) {
    if (options.dependencyDepth === undefined) {
        throw new Error(
            "Reactive dependency benchmark requires a dependencyDepth before selecting a node."
        );
    }
    const dependencyNode = options.tree.nodesByDepth[options.dependencyDepth];
    if (dependencyNode === undefined) {
        throw new Error(
            `Reactive dependency benchmark missing node at depth ${options.dependencyDepth}.`
        );
    }
    return dependencyNode;
}

function resolveFirstBenchmarkNode(
    nodes: BenchmarkNode[],
    errorMessage: string
) {
    const first = nodes[0];
    if (first === undefined) {
        throw new Error(errorMessage);
    }
    return first;
}

function resolveListenerEvent(scenarioId: ScenarioId): ListenerEvent {
    if (scenarioId === "root-tree-changed") {
        return "treeChanged";
    }
    return "nodeChanged";
}

function resolveExpectedCalls(options: BenchmarkRunContext) {
    if (options.scenario.id === "subscription-churn") {
        return 0;
    }
    if (options.scenario.id === "listener-fan-out-node-changed") {
        return requireNumber(
            options.listenerCount,
            "Listener fan-out benchmark requires listenerCount."
        );
    }
    if (options.scenario.id === "distinct-node-listeners") {
        return 1;
    }
    if (options.scenario.id === "ancestor-tree-changed-fan-out") {
        return options.depthTier.value + 1;
    }
    if (options.scenario.id === "reactive-dependency-fan-out") {
        return requireNumber(
            options.dependencyFanout,
            "Reactive dependency fan-out benchmark requires dependencyFanout."
        );
    }
    if (options.scenario.id === "reactive-dependency-update-fan-out") {
        return 1;
    }
    return 1;
}

export function getBenchmarkScenarioCallbackReadModes(
    config: BenchmarkConfig,
    scenarioId: ScenarioId
): CallbackReadMode[] {
    if (scenarioId === "subscription-churn") {
        return ["none"];
    }
    if (scenarioId === "select-vs-tree-traversal") {
        return ["none"];
    }
    return [...config.callbackReadModes];
}

function getCallbackReadModes(
    config: BenchmarkConfig,
    scenarioId: ScenarioId
): CallbackReadMode[] {
    return getBenchmarkScenarioCallbackReadModes(config, scenarioId);
}

function consumeCallbackRead(
    node: BenchmarkNode,
    callbackReadMode: CallbackReadMode
) {
    if (callbackReadMode === "none") {
        return;
    }
    if (callbackReadMode === "shallow") {
        callbackReadSink =
            callbackReadSink +
            node.value +
            node.arrayChildren.length +
            Object.keys(node.recordChildren).length +
            node.mapChildren.size +
            node.primitiveMapChildren.size +
            node.primitiveSetChildren.size +
            node.setChildren.size +
            node.wideChildren.length;
        return;
    }

    callbackReadSink = callbackReadSink + readDeepNode(node);
}

function readDeepNode(node: BenchmarkNode): number {
    let total =
        node.value +
        node.metadata.stats.version +
        node.arrayChildren.length +
        node.mapChildren.size +
        node.primitiveMapChildren.size +
        node.primitiveSetChildren.size +
        node.setChildren.size +
        node.wideChildren.length;

    for (const leaf of node.arrayChildren) {
        total = total + leaf.value + leaf.metadata.counts.length;
    }
    for (const leaf of Object.values(node.recordChildren)) {
        total = total + leaf.value + leaf.metadata.counts.length;
    }
    for (const leaf of node.mapChildren.values()) {
        total = total + leaf.value + leaf.metadata.counts.length;
    }
    for (const value of node.primitiveMapChildren.values()) {
        total = total + value;
    }
    for (const value of node.primitiveSetChildren.values()) {
        total = total + value;
    }
    for (const leaf of node.setChildren.values()) {
        total = total + leaf.value + leaf.metadata.counts.length;
    }
    for (const child of node.wideChildren) {
        total = total + readDeepNode(child);
    }
    if (node.primary !== null) {
        total = total + readDeepNode(node.primary);
    }
    return total;
}

function summarizeMutations(
    measurements: BenchmarkMeasurement[]
): BenchmarkMutationSummary[] {
    const measurementsByType = new Map<MutationType, number[]>();
    for (const measurement of measurements) {
        const durations = measurementsByType.get(measurement.mutationType);
        if (durations === undefined) {
            measurementsByType.set(measurement.mutationType, [
                measurement.durationMs,
            ]);
            continue;
        }
        durations.push(measurement.durationMs);
    }

    return [...measurementsByType.entries()].map(
        ([mutationType, durations]) => ({
            ...summarizeDurations(durations),
            mutationType,
        })
    );
}

function summarizeSetupOperations(
    measurements: BenchmarkSetupMeasurement[]
): BenchmarkSetupSummary[] {
    const measurementsByOperation = new Map<
        BenchmarkSetupOperation,
        number[]
    >();
    for (const measurement of measurements) {
        const durations = measurementsByOperation.get(measurement.operation);
        if (durations === undefined) {
            measurementsByOperation.set(measurement.operation, [
                measurement.durationMs,
            ]);
            continue;
        }
        durations.push(measurement.durationMs);
    }

    return [...measurementsByOperation.entries()]
        .map(([operation, durations]) => ({
            ...summarizeDurations(durations),
            operation,
        }))
        .sort((left, right) => right.p95Ms - left.p95Ms);
}

function measureSetupOperation<T>(
    measurements: BenchmarkSetupMeasurement[],
    operation: BenchmarkSetupOperation,
    run: () => T
): T {
    const startedAt = performance.now();
    const value = run();
    recordSetupOperationDuration(
        measurements,
        operation,
        performance.now() - startedAt
    );
    return value;
}

function recordSetupOperationDuration(
    measurements: BenchmarkSetupMeasurement[],
    operation: BenchmarkSetupOperation,
    durationMs: number
) {
    measurements.push({
        durationMs,
        operation,
    });
}

function createMutationWarnings(
    caseAverageMs: number,
    mutationSummaries: BenchmarkMutationSummary[]
): BenchmarkWarning[] {
    const warnings: BenchmarkWarning[] = [];
    for (const mutationSummary of mutationSummaries) {
        if (mutationSummary.samples < 2) {
            continue;
        }
        if (mutationSummary.averageMeanMs <= caseAverageMs * 1.25) {
            continue;
        }
        const percentage =
            ((mutationSummary.averageMeanMs - caseAverageMs) / caseAverageMs) *
            100;
        warnings.push({
            detail: `${
                mutationSummary.mutationType
            } averaged ${percentage.toFixed(1)}% above the case average.`,
            kind: "mutation-above-average",
            mutationType: mutationSummary.mutationType,
        });
    }
    return warnings;
}

function createSkippedCase(
    options: BenchmarkVariant & {
        callbackReadMode: CallbackReadMode;
        depthTier: TierDefinition;
        frequencyTier: TierDefinition;
        reason: string;
        scenario: BenchmarkScenarioDefinition;
        widthTier: TierDefinition;
    }
): SkippedBenchmarkCase {
    return {
        callbackReadMode: options.callbackReadMode,
        commits: options.frequencyTier.value,
        dependencyDepth: options.dependencyDepth,
        dependencyFanout: options.dependencyFanout,
        depth: options.depthTier.value,
        depthTitle: options.depthTier.title,
        effectWrites: options.effectWrites,
        frequencyTitle: options.frequencyTier.title,
        listenerCount: options.listenerCount,
        reason: options.reason,
        selectionMode: options.selectionMode,
        scenarioId: options.scenario.id,
        scenarioTitle: options.scenario.title,
        transactionMutations: options.transactionMutations,
        width: options.widthTier.value,
        widthTitle: options.widthTier.title,
    };
}

function requireNumber(value: number | undefined, message: string) {
    if (value === undefined) {
        throw new Error(message);
    }
    return value;
}

function createBenchmarkMetadata(config: BenchmarkConfig) {
    return {
        arch: process.arch,
        callbackReadModes: [...config.callbackReadModes],
        dependencyDepths: [...config.dependencyDepths],
        dependencyFanouts: [...config.dependencyFanouts],
        effectWrites: [...config.effectWrites],
        generatedAtIso: new Date().toISOString(),
        listenerFanouts: [...config.listenerFanouts],
        mutationTypes: [...config.mutationTypes],
        nodeVersion: process.version,
        parallelWorkers: config.parallelWorkers ?? 1,
        platform: `${process.platform} ${os.release()}`,
        profileName: config.profileName,
        seed: config.seed,
        selectedDepthTiers: [...config.selectedDepthTiers],
        selectedFrequencyTiers: [...config.selectedFrequencyTiers],
        transactionMutations: [...config.transactionMutations],
        warmupCommits: config.profile.warmupCommits,
        widthTiers: [...config.widthTiers],
    };
}
