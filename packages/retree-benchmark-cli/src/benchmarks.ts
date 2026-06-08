import os from "node:os";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import {
    ReactiveNode,
    RetreeLink,
    Retree,
    fnMemo,
    memo,
    select,
    type IReactiveDependency,
} from "@retreejs/core";
import {
    __unstable_setUseNodeInternalBenchmarkRecorder,
    useNode,
    useTree,
    type UseNodeInternalBenchmarkMeasurement,
    type UseNodeInternalBenchmarkOperation,
} from "@retreejs/react/benchmark";
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
    BenchmarkMeasurementDetail,
    BenchmarkMeasurementDetailOperation,
    BenchmarkMutationSummary,
    BenchmarkPhase,
    BenchmarkProgressEvent,
    BenchmarkResults,
    BenchmarkScenarioResult,
    BenchmarkSetupMeasurement,
    BenchmarkSetupOperation,
    BenchmarkSetupSummary,
    BenchmarkTransactionComparison,
    BenchmarkWarning,
    BenchmarkWorkEstimate,
    AutotrappingMode,
    CallbackReadMode,
    MutationType,
    ScenarioId,
    SelectionMode,
    SkippedBenchmarkCase,
    TierDefinition,
} from "./types";

type ListenerEvent = "nodeChanged" | "treeChanged";

const require = createRequire(import.meta.url);

export interface BenchmarkScenarioDefinition {
    id: ScenarioId;
    title: string;
}

interface BenchmarkVariant {
    autotrappingMode?: AutotrappingMode;
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
        id: "auto-trapped-select",
        title: "Auto-trapped @select",
    },
    {
        id: "auto-trapped-memo",
        title: "Auto-trapped @memo",
    },
    {
        id: "auto-trapped-fn-memo",
        title: "Auto-trapped @fnMemo",
    },
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
        id: "react-use-node",
        title: "React useNode",
    },
    {
        id: "react-use-tree",
        title: "React useTree",
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
        title: "runTransaction overhead",
    },
    {
        id: "select-vs-tree-traversal",
        title: "Reactive select vs tree traversal",
    },
];

const MAX_MUTATION_COLLECTION_SIZE = 32;

let callbackReadSink = 0;

interface ReactBenchmarkModules {
    act(run: () => void): unknown;
    createElement(component: () => unknown): unknown;
    createRoot(container: unknown): ReactBenchmarkRoot;
    flushSync(run: () => void): void;
    useNumberState(initialValue: number): [number, (value: number) => void];
}

interface ReactBenchmarkRoot {
    render(element: unknown): void;
    unmount(): void;
}

interface ReactBenchmarkRuntime {
    createContainer(): unknown;
    dispose(): void;
    modules: ReactBenchmarkModules;
    removeContainer(container: unknown): void;
}

type ReactBenchmarkPhase = "cleanup" | "measured" | "setup" | "warmup";
type ReactRenderCause = "retree-update" | "setup" | "unrelated-state";

interface ReactCommitResult {
    details: BenchmarkMeasurementDetail[];
    durationMs: number;
}

interface JsdomConstructor {
    new (html: string): unknown;
}

let reactBenchmarkRuntime: ReactBenchmarkRuntime | undefined;

class AutoTrappingConsumer extends ReactiveNode {
    public sourceLink: RetreeLink<BenchmarkNode> | null = null;

    public multiplier = 2;

    get dependencies(): IReactiveDependency[] {
        const source = this.source;
        if (source === null) {
            return [];
        }
        return [this.dependency(source)];
    }

    public get selectedTotal(): number {
        return this.readSourceTotal();
    }

    public get memoTotal(): number {
        return this.readSourceTotal();
    }

    public formatTotal(prefix: number): number {
        return prefix + this.multiplier * this.readSourceTotal();
    }

    private get source(): BenchmarkNode | null {
        return this.sourceLink?.current ?? null;
    }

    private readSourceTotal(): number {
        const source = this.source;
        if (source === null) {
            return 0;
        }
        return (
            source.value +
            source.metadata.stats.version +
            source.metadata.stats.score
        );
    }
}

decorateAutoTrappingConsumer();

function decorateAutoTrappingConsumer() {
    decorateAutoTrappingGetter("selectedTotal", select);
    decorateAutoTrappingGetter("memoTotal", memo);
    decorateAutoTrappingMethod("formatTotal", fnMemo);
}

function decorateAutoTrappingGetter(
    name: "memoTotal" | "selectedTotal",
    decorator: (
        target: (this: AutoTrappingConsumer) => number,
        context: ClassGetterDecoratorContext<AutoTrappingConsumer, number>
    ) => (this: AutoTrappingConsumer) => number
) {
    const descriptor = Object.getOwnPropertyDescriptor(
        AutoTrappingConsumer.prototype,
        name
    );
    if (descriptor === undefined) {
        throw new Error(
            `Auto-trapping benchmark setup failed: missing getter descriptor for ${name}.`
        );
    }
    if (descriptor.get === undefined) {
        throw new Error(
            `Auto-trapping benchmark setup failed: ${name} is not a getter.`
        );
    }
    const context: ClassGetterDecoratorContext<AutoTrappingConsumer, number> = {
        access: {
            get(object) {
                return object[name];
            },
            has(object) {
                return name in object;
            },
        },
        addInitializer() {
            return;
        },
        kind: "getter",
        metadata: undefined,
        name,
        private: false,
        static: false,
    };
    Object.defineProperty(AutoTrappingConsumer.prototype, name, {
        ...descriptor,
        get: decorator(descriptor.get, context),
    });
}

function decorateAutoTrappingMethod(
    name: "formatTotal",
    decorator: (
        target: (this: AutoTrappingConsumer, prefix: number) => number,
        context: ClassMethodDecoratorContext<
            AutoTrappingConsumer,
            (prefix: number) => number
        >
    ) => (this: AutoTrappingConsumer, prefix: number) => number
) {
    const descriptor = Object.getOwnPropertyDescriptor(
        AutoTrappingConsumer.prototype,
        name
    );
    if (descriptor === undefined) {
        throw new Error(
            `Auto-trapping benchmark setup failed: missing method descriptor for ${name}.`
        );
    }
    if (typeof descriptor.value !== "function") {
        throw new Error(
            `Auto-trapping benchmark setup failed: ${name} is not a method.`
        );
    }
    const context: ClassMethodDecoratorContext<
        AutoTrappingConsumer,
        (prefix: number) => number
    > = {
        access: {
            get(object) {
                return object[name];
            },
            has(object) {
                return name in object;
            },
        },
        addInitializer() {
            return;
        },
        kind: "method",
        metadata: undefined,
        name,
        private: false,
        static: false,
    };
    Object.defineProperty(AutoTrappingConsumer.prototype, name, {
        ...descriptor,
        value: decorator(descriptor.value, context),
    });
}

export function runBenchmarks(config: BenchmarkConfig): BenchmarkResults {
    const scenarioResults: BenchmarkScenarioResult[] = [];
    const shouldDisposeReactRuntime = prepareReactBenchmarkRuntimeForScenarios(
        SCENARIOS.map((scenario) => scenario.id)
    );

    try {
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
    } finally {
        disposeReactBenchmarkRuntimeIfNeeded(shouldDisposeReactRuntime);
    }
}

export function getBenchmarkScenarioDefinitions() {
    return SCENARIOS.map((scenario) => ({ ...scenario }));
}

export async function runBenchmarksWithProgress(
    config: BenchmarkConfig,
    progressOptions: RunBenchmarksProgressOptions = {}
): Promise<BenchmarkResults> {
    const scenarioResults: BenchmarkScenarioResult[] = [];
    const shouldDisposeReactRuntime = prepareReactBenchmarkRuntimeForScenarios(
        SCENARIOS.map((scenario) => scenario.id)
    );
    const progressState: BenchmarkProgressState = {
        ...estimateBenchmarkWork(config),
        caseIndex: 0,
        lastOperationDurationMs: undefined,
        operationIndex: 0,
        phaseIndex: 0,
    };

    try {
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
    } finally {
        disposeReactBenchmarkRuntimeIfNeeded(shouldDisposeReactRuntime);
    }
}

export async function runBenchmarkScenarioWithProgress(
    config: BenchmarkConfig,
    scenarioId: ScenarioId,
    progressOptions: RunBenchmarksProgressOptions = {}
): Promise<BenchmarkScenarioResult> {
    const scenario = resolveScenarioDefinition(scenarioId);
    const shouldDisposeReactRuntime = prepareReactBenchmarkRuntimeForScenarios([
        scenarioId,
    ]);
    const progressState: BenchmarkProgressState = {
        ...estimateBenchmarkScenarioWork(config, scenarioId),
        caseIndex: 0,
        lastOperationDurationMs: undefined,
        operationIndex: 0,
        phaseIndex: 0,
    };

    try {
        return await runScenarioWithProgress(
            config,
            scenario,
            progressState,
            progressOptions
        );
    } finally {
        disposeReactBenchmarkRuntimeIfNeeded(shouldDisposeReactRuntime);
    }
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

    if (options.scenario.id === "auto-trapped-select") {
        cases.push({
            autotrappingMode: "select",
        });
        return {
            cases,
            skipped,
        };
    }

    if (options.scenario.id === "auto-trapped-memo") {
        cases.push({
            autotrappingMode: "memo",
        });
        return {
            cases,
            skipped,
        };
    }

    if (options.scenario.id === "auto-trapped-fn-memo") {
        cases.push({
            autotrappingMode: "fnMemo",
        });
        return {
            cases,
            skipped,
        };
    }

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
    if (isReactHookScenario(options.scenario.id)) {
        return runReactHookBenchmarkCase(options);
    }

    const setupStartedAt = performance.now();
    const prepared = prepareBenchmarkCase(options);
    const measurements: BenchmarkMeasurement[] = [];
    let listenerCalls = 0;
    let timerStartedAt: number | null = null;
    let measuredDurationMs = 0;
    let transactionComparison: BenchmarkTransactionComparison | undefined;

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
                    transactionComparison = undefined;
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
                recordTransactionComparison: (comparison) => {
                    transactionComparison = comparison;
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
                    transactionComparison = undefined;
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
                recordTransactionComparison: (comparison) => {
                    transactionComparison = comparison;
                },
            });
            measurements.push({
                durationMs: measuredDurationMs,
                mutationType,
                transactionComparison,
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
    if (isReactHookScenario(options.scenario.id)) {
        return runReactHookBenchmarkCaseWithProgress(
            options,
            progressState,
            progressOptions
        );
    }

    const measurements: BenchmarkMeasurement[] = [];
    let listenerCalls = 0;
    let timerStartedAt: number | null = null;
    let measuredDurationMs = 0;
    let transactionComparison: BenchmarkTransactionComparison | undefined;

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
                    transactionComparison = undefined;
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
                recordTransactionComparison: (comparison) => {
                    transactionComparison = comparison;
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
                    transactionComparison = undefined;
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
                recordTransactionComparison: (comparison) => {
                    transactionComparison = comparison;
                },
            });
            measurements.push({
                durationMs: measuredDurationMs,
                mutationType,
                transactionComparison,
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

function runReactHookBenchmarkCase(
    options: BenchmarkRunContext
): BenchmarkCaseResult {
    const prepared = prepareBenchmarkCase(options);
    const measurements: BenchmarkMeasurement[] = [];
    collectAdditionalReactInitialRenderSamples(options, prepared);
    const reactCase = setupReactHookBenchmarkCase(options, prepared);

    try {
        for (
            let warmupIndex = 0;
            warmupIndex < options.config.profile.warmupCommits;
            warmupIndex++
        ) {
            reactCase.commit(warmupIndex);
        }

        for (
            let commitIndex = 0;
            commitIndex < options.frequencyTier.value;
            commitIndex++
        ) {
            const result = reactCase.commit(commitIndex, true);
            const unrelatedRenderResult = reactCase.unrelatedRender(true);
            measurements.push({
                details: [...result.details, ...unrelatedRenderResult.details],
                durationMs: result.durationMs,
                mutationType: "scalar-set",
            });
        }
    } finally {
        reactCase.cleanup();
        Retree.clearListeners(prepared.tree.root, false);
    }

    return createBenchmarkCaseResult(
        options,
        measurements,
        prepared.setupMeasurements
    );
}

async function runReactHookBenchmarkCaseWithProgress(
    options: BenchmarkRunContext,
    progressState: BenchmarkProgressState,
    progressOptions: RunBenchmarksProgressOptions
): Promise<BenchmarkCaseResult> {
    const measurements: BenchmarkMeasurement[] = [];

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

    const prepared = prepareBenchmarkCase(options);
    collectAdditionalReactInitialRenderSamples(options, prepared);
    const reactCase = setupReactHookBenchmarkCase(options, prepared);

    try {
        const setupSummary = summarizeDurations(
            prepared.setupMeasurements.map(
                (measurement) => measurement.durationMs
            )
        );
        progressState.lastOperationDurationMs = setupSummary.maxMs;
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
            const result = reactCase.commit(warmupIndex);
            progressState.lastOperationDurationMs = result.durationMs;
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
            const result = reactCase.commit(commitIndex, true);
            const unrelatedRenderResult = reactCase.unrelatedRender(true);
            measurements.push({
                details: [...result.details, ...unrelatedRenderResult.details],
                durationMs: result.durationMs,
                mutationType: "scalar-set",
            });
            progressState.lastOperationDurationMs = result.durationMs;
            progressState.operationIndex++;
        }
    } finally {
        reactCase.cleanup();
        Retree.clearListeners(prepared.tree.root, false);
    }

    return createBenchmarkCaseResult(
        options,
        measurements,
        prepared.setupMeasurements
    );
}

function setupReactHookBenchmarkCase(
    options: BenchmarkRunContext,
    prepared: ReturnType<typeof prepareBenchmarkCase>
) {
    const setupStartedAt = performance.now();
    const runtime = getReactBenchmarkRuntime();
    const modules = runtime.modules;
    const container = runtime.createContainer();
    const root = modules.createRoot(container);
    const subscribedNode =
        options.scenario.id === "react-use-tree"
            ? prepared.tree.root
            : prepared.tree.target;
    let reactPhase: ReactBenchmarkPhase = "setup";
    let renderCause: ReactRenderCause = "setup";
    let currentMeasurementDetails: BenchmarkMeasurementDetail[] | undefined;
    let renderCount = 0;
    let triggerUnrelatedRender: ((value: number) => void) | undefined;
    let unrelatedRenderVersion = 0;
    const restoreRecorder = __unstable_setUseNodeInternalBenchmarkRecorder(
        (measurement) => {
            recordReactHookBenchmarkMeasurement({
                measurement,
                phase: reactPhase,
                renderCause,
                setupMeasurements: prepared.setupMeasurements,
                currentMeasurementDetails,
            });
        }
    );

    function recordReactMeasurementDetail(
        operation: BenchmarkMeasurementDetailOperation,
        durationMs: number
    ) {
        if (reactPhase === "measured") {
            currentMeasurementDetails?.push({
                durationMs,
                operation,
            });
            return;
        }
        if (reactPhase === "warmup") {
            return;
        }
        if (!isReactSetupMeasurementOperation(operation)) {
            throw new Error(
                `React benchmark attempted to record ${operation} during setup or cleanup.`
            );
        }
        recordSetupOperationDuration(
            prepared.setupMeasurements,
            operation,
            durationMs
        );
    }

    function BenchmarkComponent() {
        const componentStartedAt = performance.now();
        const [unrelatedVersion, setUnrelatedVersion] =
            modules.useNumberState(0);
        triggerUnrelatedRender = setUnrelatedVersion;
        callbackReadSink += unrelatedVersion;
        const hookStartedAt = performance.now();
        const state =
            options.scenario.id === "react-use-tree"
                ? useTree(subscribedNode)
                : useNode(subscribedNode);
        recordReactMeasurementDetail(
            getReactHookCallOperation(renderCause),
            performance.now() - hookStartedAt
        );
        renderCount++;
        measureReactRenderRead({
            cause: renderCause,
            node: state,
            options,
            record: recordReactMeasurementDetail,
        });
        recordReactMeasurementDetail(
            getReactComponentRenderOperation(renderCause),
            performance.now() - componentStartedAt
        );
        return null;
    }

    try {
        reactPhase = "setup";
        renderCause = "setup";
        measureSetupOperation(
            prepared.setupMeasurements,
            "react-root-render",
            () =>
                runReactSync(modules, () => {
                    root.render(modules.createElement(BenchmarkComponent));
                })
        );
    } catch (error: unknown) {
        restoreRecorder();
        runtime.removeContainer(container);
        throw error;
    }
    if (renderCount !== 1) {
        restoreRecorder();
        runtime.removeContainer(container);
        throw new Error(
            `${options.scenario.title}: expected initial React render count to be 1, but received ${renderCount}.`
        );
    }
    recordSetupOperationDuration(
        prepared.setupMeasurements,
        "case-setup-total",
        performance.now() - setupStartedAt
    );

    return {
        cleanup() {
            try {
                reactPhase = "cleanup";
                measureSetupOperation(
                    prepared.setupMeasurements,
                    "react-root-unmount",
                    () => {
                        runReactSync(modules, () => {
                            root.unmount();
                        });
                        runtime.removeContainer(container);
                    }
                );
            } finally {
                restoreRecorder();
            }
        },
        commit(
            commitIndex: number,
            shouldCollectDetails = false
        ): ReactCommitResult {
            const previousRenderCount = renderCount;
            const details: BenchmarkMeasurementDetail[] = [];
            reactPhase = shouldCollectDetails ? "measured" : "warmup";
            renderCause = "retree-update";
            currentMeasurementDetails = shouldCollectDetails
                ? details
                : undefined;
            const startedAt = performance.now();
            runReactSync(modules, () => {
                applyMutation({
                    commitIndex,
                    mutationType: "scalar-set",
                    target: prepared.mutationTarget,
                });
            });
            const durationMs = performance.now() - startedAt;
            currentMeasurementDetails = undefined;
            const expectedRenderCount = previousRenderCount + 1;
            if (renderCount !== expectedRenderCount) {
                throw new Error(
                    `${options.scenario.title}: expected React render count to advance from ${previousRenderCount} to ${expectedRenderCount} for commit ${commitIndex}, but received ${renderCount}.`
                );
            }
            if (shouldCollectDetails) {
                details.push({
                    durationMs: Math.max(
                        durationMs -
                            sumReactMeasurementDetails(
                                details,
                                "react-component-render"
                            ),
                        0
                    ),
                    operation: "react-update-outside-component",
                });
            }
            return {
                details,
                durationMs,
            };
        },
        unrelatedRender(shouldCollectDetails = false): ReactCommitResult {
            if (triggerUnrelatedRender === undefined) {
                throw new Error(
                    `${options.scenario.title}: cannot trigger unrelated React render before the benchmark component has mounted.`
                );
            }
            const previousRenderCount = renderCount;
            const details: BenchmarkMeasurementDetail[] = [];
            reactPhase = shouldCollectDetails ? "measured" : "warmup";
            renderCause = "unrelated-state";
            currentMeasurementDetails = shouldCollectDetails
                ? details
                : undefined;
            const startedAt = performance.now();
            unrelatedRenderVersion++;
            const nextVersion = unrelatedRenderVersion;
            runReactSync(modules, () => {
                triggerUnrelatedRender?.(nextVersion);
            });
            const durationMs = performance.now() - startedAt;
            currentMeasurementDetails = undefined;
            const expectedRenderCount = previousRenderCount + 1;
            if (renderCount !== expectedRenderCount) {
                throw new Error(
                    `${options.scenario.title}: expected unrelated React render count to advance from ${previousRenderCount} to ${expectedRenderCount}, but received ${renderCount}.`
                );
            }
            if (shouldCollectDetails) {
                details.push({
                    durationMs: Math.max(
                        durationMs -
                            sumReactMeasurementDetails(
                                details,
                                "react-unrelated-component-render"
                            ),
                        0
                    ),
                    operation: "react-unrelated-update-outside-component",
                });
            }
            return {
                details,
                durationMs,
            };
        },
    };
}

function collectAdditionalReactInitialRenderSamples(
    options: BenchmarkRunContext,
    prepared: ReturnType<typeof prepareBenchmarkCase>
) {
    const additionalSampleCount =
        options.config.profile.reactInitialRenderSamples - 1;
    if (additionalSampleCount <= 0) {
        return;
    }

    for (
        let sampleIndex = 0;
        sampleIndex < additionalSampleCount;
        sampleIndex++
    ) {
        const samplePrepared = prepareBenchmarkCase(options, sampleIndex + 1);
        const sampleReactCase = setupReactHookBenchmarkCase(
            options,
            samplePrepared
        );
        try {
            sampleReactCase.cleanup();
        } finally {
            for (const unsubscribe of samplePrepared.subscriptions
                .unsubscribe) {
                unsubscribe();
            }
            Retree.clearListeners(samplePrepared.tree.root, false);
        }
        mergeReactInitialRenderSetupMeasurements(
            prepared.setupMeasurements,
            samplePrepared.setupMeasurements
        );
    }
}

function mergeReactInitialRenderSetupMeasurements(
    target: BenchmarkSetupMeasurement[],
    samples: BenchmarkSetupMeasurement[]
) {
    for (const sample of samples) {
        if (!isReactInitialRenderSetupMeasurement(sample)) {
            continue;
        }
        target.push(sample);
    }
}

function isReactInitialRenderSetupMeasurement(
    measurement: BenchmarkSetupMeasurement
) {
    if (measurement.operation === "react-root-render") {
        return true;
    }
    if (measurement.operation === "react-root-unmount") {
        return true;
    }
    return isReactSetupMeasurementOperation(measurement.operation);
}

function recordReactHookBenchmarkMeasurement(options: {
    currentMeasurementDetails: BenchmarkMeasurementDetail[] | undefined;
    measurement: UseNodeInternalBenchmarkMeasurement;
    phase: ReactBenchmarkPhase;
    renderCause: ReactRenderCause;
    setupMeasurements: BenchmarkSetupMeasurement[];
}) {
    const operation = formatReactHookBenchmarkOperation(
        options.measurement.operation,
        options.renderCause
    );
    if (options.phase === "measured") {
        options.currentMeasurementDetails?.push({
            durationMs: options.measurement.durationMs,
            operation,
        });
        return;
    }
    if (options.phase === "warmup") {
        return;
    }
    if (!isReactSetupMeasurementOperation(operation)) {
        throw new Error(
            `React benchmark attempted to record ${operation} hook instrumentation during setup or cleanup.`
        );
    }
    recordSetupOperationDuration(
        options.setupMeasurements,
        operation,
        options.measurement.durationMs
    );
}

function measureReactRenderRead(options: {
    cause: ReactRenderCause;
    node: BenchmarkNode;
    options: BenchmarkRunContext;
    record: (
        operation: BenchmarkMeasurementDetailOperation,
        durationMs: number
    ) => void;
}) {
    const firstReadStartedAt = performance.now();
    consumeCallbackRead(options.node, options.options.callbackReadMode);
    const firstReadDurationMs = performance.now() - firstReadStartedAt;
    options.record(
        getReactRenderReadOperation(options.cause, "first"),
        firstReadDurationMs
    );

    const secondReadStartedAt = performance.now();
    consumeCallbackRead(options.node, options.options.callbackReadMode);
    const secondReadDurationMs = performance.now() - secondReadStartedAt;
    options.record(
        getReactRenderReadOperation(options.cause, "second"),
        secondReadDurationMs
    );

    options.record(
        getReactRenderReadOperation(options.cause, "total"),
        firstReadDurationMs + secondReadDurationMs
    );
}

function getReactHookCallOperation(
    cause: ReactRenderCause
): BenchmarkMeasurementDetailOperation {
    if (cause === "unrelated-state") {
        return "react-unrelated-hook-call";
    }
    return "react-hook-call";
}

function getReactComponentRenderOperation(
    cause: ReactRenderCause
): BenchmarkMeasurementDetailOperation {
    if (cause === "unrelated-state") {
        return "react-unrelated-component-render";
    }
    return "react-component-render";
}

function getReactRenderReadOperation(
    cause: ReactRenderCause,
    readPass: "first" | "second" | "total"
): BenchmarkMeasurementDetailOperation {
    if (cause === "unrelated-state") {
        if (readPass === "first") {
            return "react-unrelated-render-read-first";
        }
        if (readPass === "second") {
            return "react-unrelated-render-read-second";
        }
        return "react-unrelated-render-read";
    }
    if (readPass === "first") {
        return "react-hook-render-read-first";
    }
    if (readPass === "second") {
        return "react-hook-render-read-second";
    }
    return "react-hook-render-read";
}

function isReactSetupMeasurementOperation(
    operation: BenchmarkMeasurementDetailOperation | BenchmarkSetupOperation
): operation is BenchmarkMeasurementDetailOperation & BenchmarkSetupOperation {
    if (operation === "react-component-render") {
        return true;
    }
    if (operation === "react-hook-call") {
        return true;
    }
    if (operation === "react-hook-effect-cleanup") {
        return true;
    }
    if (operation === "react-hook-effect-subscribe") {
        return true;
    }
    if (operation === "react-hook-initial-reproxy-state") {
        return true;
    }
    if (operation === "react-hook-render-base-proxy") {
        return true;
    }
    if (operation === "react-hook-render-read") {
        return true;
    }
    if (operation === "react-hook-render-read-first") {
        return true;
    }
    if (operation === "react-hook-render-read-second") {
        return true;
    }
    if (operation === "react-hook-render-reproxy-reset") {
        return true;
    }
    if (operation === "react-hook-render-state-base-proxy") {
        return true;
    }
    return false;
}

function formatReactHookBenchmarkOperation(
    operation: UseNodeInternalBenchmarkOperation,
    renderCause: ReactRenderCause
): BenchmarkMeasurementDetailOperation {
    if (operation === "effect-cleanup") {
        return "react-hook-effect-cleanup";
    }
    if (operation === "effect-subscribe") {
        return "react-hook-effect-subscribe";
    }
    if (operation === "initial-reproxy-state") {
        return "react-hook-initial-reproxy-state";
    }
    if (operation === "render-base-proxy") {
        if (renderCause === "unrelated-state") {
            return "react-unrelated-hook-render-base-proxy";
        }
        return "react-hook-render-base-proxy";
    }
    if (operation === "render-reproxy-reset") {
        if (renderCause === "unrelated-state") {
            return "react-unrelated-hook-render-reproxy-reset";
        }
        return "react-hook-render-reproxy-reset";
    }
    if (operation === "render-state-base-proxy") {
        if (renderCause === "unrelated-state") {
            return "react-unrelated-hook-render-state-base-proxy";
        }
        return "react-hook-render-state-base-proxy";
    }
    throw new Error(
        `Unknown useNodeInternal benchmark operation: ${operation}.`
    );
}

function sumReactMeasurementDetails(
    details: BenchmarkMeasurementDetail[],
    operation: BenchmarkMeasurementDetailOperation
) {
    return details.reduce((sum, detail) => {
        if (detail.operation !== operation) {
            return sum;
        }
        return sum + detail.durationMs;
    }, 0);
}

function prepareReactBenchmarkRuntimeForScenarios(
    scenarioIds: ScenarioId[]
): boolean {
    if (!scenarioIds.some(isReactHookScenario)) {
        return false;
    }
    getReactBenchmarkRuntime();
    return true;
}

function disposeReactBenchmarkRuntimeIfNeeded(shouldDispose: boolean): void {
    if (!shouldDispose) {
        return;
    }
    const runtime = reactBenchmarkRuntime;
    reactBenchmarkRuntime = undefined;
    runtime?.dispose();
}

function getReactBenchmarkRuntime(): ReactBenchmarkRuntime {
    if (reactBenchmarkRuntime !== undefined) {
        return reactBenchmarkRuntime;
    }
    const dom = createReactBenchmarkDom();
    const modules = loadReactBenchmarkModules();
    reactBenchmarkRuntime = {
        createContainer: dom.createContainer,
        dispose: dom.dispose,
        modules,
        removeContainer: dom.removeContainer,
    };
    return reactBenchmarkRuntime;
}

function loadReactBenchmarkModules(): ReactBenchmarkModules {
    const reactModule: unknown = require("react");
    const reactDomModule: unknown = require("react-dom");
    const reactDomClientModule: unknown = require("react-dom/client");

    if (!isRecord(reactModule)) {
        throw new Error("React benchmark failed to load the react module.");
    }
    if (!isRecord(reactDomModule)) {
        throw new Error("React benchmark failed to load the react-dom module.");
    }
    if (!isRecord(reactDomClientModule)) {
        throw new Error(
            "React benchmark failed to load the react-dom/client module."
        );
    }

    const createElement = reactModule.createElement;
    if (typeof createElement !== "function") {
        throw new Error(
            "React benchmark cannot run because react.createElement is missing."
        );
    }

    const useState = reactModule.useState;
    if (typeof useState !== "function") {
        throw new Error(
            "React benchmark cannot run because react.useState is missing."
        );
    }

    const act = reactModule.act;
    if (typeof act !== "function") {
        throw new Error(
            "React benchmark cannot run because react.act is missing."
        );
    }

    const flushSync = reactDomModule.flushSync;
    if (typeof flushSync !== "function") {
        throw new Error(
            "React benchmark cannot run because react-dom.flushSync is missing."
        );
    }

    const createRoot = reactDomClientModule.createRoot;
    if (typeof createRoot !== "function") {
        throw new Error(
            "React benchmark cannot run because react-dom/client.createRoot is missing."
        );
    }

    return {
        act: (run) => act(run),
        createElement: (component) => createElement(component),
        createRoot: (container) => {
            const root: unknown = createRoot(container);
            if (!isReactBenchmarkRoot(root)) {
                throw new Error(
                    "React benchmark cannot run because createRoot returned an invalid root."
                );
            }
            return root;
        },
        flushSync: (run) => {
            flushSync(run);
        },
        useNumberState: (initialValue) => {
            const stateTuple: unknown = useState(initialValue);
            if (!isNumberReactStateTuple(stateTuple)) {
                throw new Error(
                    "React benchmark cannot run because react.useState returned an invalid state tuple."
                );
            }
            return stateTuple;
        },
    };
}

function createReactBenchmarkDom(): Omit<ReactBenchmarkRuntime, "modules"> {
    const jsdomModule: unknown = require("jsdom");
    if (!isRecord(jsdomModule)) {
        throw new Error("React benchmark failed to load the jsdom module.");
    }
    const JSDOM = jsdomModule.JSDOM;
    if (!isJsdomConstructor(JSDOM)) {
        throw new Error(
            "React benchmark cannot run because jsdom.JSDOM is missing."
        );
    }
    const dom: unknown = new JSDOM("<!doctype html><html><body></body></html>");
    if (!isRecord(dom)) {
        throw new Error("React benchmark failed to create a jsdom instance.");
    }
    const window = dom.window;
    if (!isRecord(window)) {
        throw new Error("React benchmark failed to create a jsdom window.");
    }
    const document = window.document;
    if (!isRecord(document)) {
        throw new Error("React benchmark failed to create a jsdom document.");
    }
    const body = document.body;
    if (!isRecord(body)) {
        throw new Error("React benchmark failed to create a jsdom body.");
    }

    const globalValues = globalThis as Record<string, unknown>;
    const previousValues = new Map<
        string,
        { descriptor?: PropertyDescriptor; existed: boolean }
    >();
    const setGlobal = (key: string, value: unknown) => {
        previousValues.set(key, {
            descriptor: Object.getOwnPropertyDescriptor(globalValues, key),
            existed: Object.prototype.hasOwnProperty.call(globalValues, key),
        });
        Object.defineProperty(globalValues, key, {
            configurable: true,
            value,
            writable: true,
        });
    };

    setGlobal("window", window);
    setGlobal("document", document);
    setGlobal("navigator", window.navigator);
    setGlobal("HTMLElement", window.HTMLElement);
    setGlobal("Node", window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

    return {
        createContainer() {
            const createElement = document.createElement;
            if (typeof createElement !== "function") {
                throw new Error(
                    "React benchmark cannot create a container because document.createElement is missing."
                );
            }
            const appendChild = body.appendChild;
            if (typeof appendChild !== "function") {
                throw new Error(
                    "React benchmark cannot attach a container because document.body.appendChild is missing."
                );
            }
            const container = createElement.call(document, "div");
            appendChild.call(body, container);
            return container;
        },
        dispose() {
            const close = window.close;
            if (typeof close === "function") {
                close.call(window);
            }
            for (const [key, previous] of previousValues) {
                if (!previous.existed) {
                    delete globalValues[key];
                    continue;
                }
                if (previous.descriptor === undefined) {
                    delete globalValues[key];
                    continue;
                }
                Object.defineProperty(globalValues, key, previous.descriptor);
            }
        },
        removeContainer(container: unknown) {
            const removeChild = body.removeChild;
            if (typeof removeChild !== "function") {
                throw new Error(
                    "React benchmark cannot remove a container because document.body.removeChild is missing."
                );
            }
            removeChild.call(body, container);
        },
    };
}

function runReactSync(modules: ReactBenchmarkModules, run: () => void) {
    modules.act(() => {
        modules.flushSync(run);
    });
}

function prepareBenchmarkCase(options: BenchmarkRunContext, seedOffset = 0) {
    const setupMeasurements: BenchmarkSetupMeasurement[] = [];
    const sampleSeedOffset = seedOffset * 100_003;
    const tree = createBenchmarkTree({
        depth: options.depthTier.value,
        seed:
            options.config.seed +
            options.depthTier.value +
            options.widthTier.value +
            sampleSeedOffset,
        setupMeasurements,
        width: options.widthTier.value,
    });
    measureFreshBroadValueSetup({
        seed:
            options.config.seed +
            options.depthTier.value * 31 +
            options.widthTier.value * 997 +
            sampleSeedOffset,
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
        autotrappingMode: options.autotrappingMode,
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
        warnings:
            options.scenario.id === "run-transaction"
                ? []
                : createMutationWarnings(
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
        autotrappingMode: options.options.autotrappingMode,
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

                if (isAutoTrappingScenario(options.scenario.id)) {
                    const consumer = measureSetupOperation(
                        options.setupMeasurements,
                        "auto-trap-root-proxy",
                        () => Retree.root(new AutoTrappingConsumer())
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "auto-trap-structure-construction",
                        () => {
                            consumer.sourceLink = Retree.link(
                                options.tree.target
                            );
                            consumer.multiplier =
                                options.widthTier.value +
                                options.depthTier.value;
                        }
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "auto-trap-priming",
                        () => {
                            consumeAutoTrappedValue(consumer, options);
                        }
                    );
                    measureSetupOperation(
                        options.setupMeasurements,
                        "listener-registration",
                        () => {
                            unsubscribe.push(
                                Retree.on(
                                    consumer,
                                    "nodeChanged",
                                    (reproxiedConsumer) => {
                                        consumeAutoTrappedValue(
                                            reproxiedConsumer,
                                            options
                                        );
                                        listener(options.tree.target);
                                    }
                                )
                            );
                        }
                    );
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
    recordTransactionComparison: (
        comparison: BenchmarkTransactionComparison
    ) => void;
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
        const firstMutationIndex =
            options.commitIndex * transactionMutations * 2;
        const unwrappedStartedAt = performance.now();
        for (
            let mutationIndex = 0;
            mutationIndex < transactionMutations;
            mutationIndex++
        ) {
            applyMutation({
                commitIndex: firstMutationIndex + mutationIndex,
                mutationType: options.mutationType,
                target: options.mutationTarget,
            });
        }
        const unwrappedDurationMs = performance.now() - unwrappedStartedAt;
        options.onCommitFinished();
        const unwrappedListenerCalls = options.listenerCalls();
        const expectedUnwrappedCalls =
            options.expectedCalls * transactionMutations;
        if (unwrappedListenerCalls !== expectedUnwrappedCalls) {
            throw new Error(
                `${options.options.scenario.title}: expected ${expectedUnwrappedCalls} unwrapped listener emissions for ${options.phase} commit ${options.commitIndex} at depth tier ${options.options.depthTier.title} (${options.options.depthTier.value}), width tier ${options.options.widthTier.title} (${options.options.widthTier.value}), frequency tier ${options.options.frequencyTier.title} (${options.options.frequencyTier.value}), transaction mutations ${transactionMutations}, mutation type ${options.mutationType}, and callback read mode ${options.options.callbackReadMode}, but received ${unwrappedListenerCalls}.`
            );
        }

        options.onBeforeCommit();
        const transactionStartedAt = performance.now();
        Retree.runTransaction(() => {
            for (
                let mutationIndex = 0;
                mutationIndex < transactionMutations;
                mutationIndex++
            ) {
                applyMutation({
                    commitIndex:
                        firstMutationIndex +
                        transactionMutations +
                        mutationIndex,
                    mutationType: options.mutationType,
                    target: options.mutationTarget,
                });
            }
        });
        const transactionDurationMs = performance.now() - transactionStartedAt;
        options.onCommitFinished();
        const transactionListenerCalls = options.listenerCalls();
        if (transactionListenerCalls !== options.expectedCalls) {
            throw new Error(
                `${options.options.scenario.title}: expected ${options.expectedCalls} transaction listener emissions for ${options.phase} commit ${options.commitIndex} at depth tier ${options.options.depthTier.title} (${options.options.depthTier.value}), width tier ${options.options.widthTier.title} (${options.options.widthTier.value}), frequency tier ${options.options.frequencyTier.title} (${options.options.frequencyTier.value}), transaction mutations ${transactionMutations}, mutation type ${options.mutationType}, and callback read mode ${options.options.callbackReadMode}, but received ${transactionListenerCalls}.`
            );
        }

        const signedDeltaMs = transactionDurationMs - unwrappedDurationMs;
        const overheadMs = Math.max(signedDeltaMs, 0);
        options.recordTransactionComparison({
            overheadMs,
            savedDurationMs: Math.max(-signedDeltaMs, 0),
            savedListenerCalls:
                unwrappedListenerCalls - transactionListenerCalls,
            signedDeltaMs,
            transactionDurationMs,
            transactionListenerCalls,
            unwrappedDurationMs,
            unwrappedListenerCalls,
        });
        options.recordManualDuration(overheadMs);
        return;
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
    if (
        options.scenario.id === "select-vs-tree-traversal" ||
        isReactHookScenario(options.scenario.id) ||
        isAutoTrappingScenario(options.scenario.id)
    ) {
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
    if (
        scenarioId === "subscription-churn" ||
        isAutoTrappingScenario(scenarioId)
    ) {
        return ["none"];
    }
    if (scenarioId === "select-vs-tree-traversal") {
        return ["none"];
    }
    if (scenarioId === "react-use-node") {
        return uniqueCallbackReadModes(
            config.callbackReadModes.map((callbackReadMode) => {
                if (callbackReadMode === "deep") {
                    return "shallow";
                }
                return callbackReadMode;
            })
        );
    }
    return [...config.callbackReadModes];
}

function uniqueCallbackReadModes(
    callbackReadModes: CallbackReadMode[]
): CallbackReadMode[] {
    return [...new Set(callbackReadModes)];
}

function getCallbackReadModes(
    config: BenchmarkConfig,
    scenarioId: ScenarioId
): CallbackReadMode[] {
    return getBenchmarkScenarioCallbackReadModes(config, scenarioId);
}

function isAutoTrappingScenario(scenarioId: ScenarioId): boolean {
    return (
        scenarioId === "auto-trapped-select" ||
        scenarioId === "auto-trapped-memo" ||
        scenarioId === "auto-trapped-fn-memo"
    );
}

function isReactHookScenario(scenarioId: ScenarioId): boolean {
    return scenarioId === "react-use-node" || scenarioId === "react-use-tree";
}

function consumeAutoTrappedValue(
    consumer: AutoTrappingConsumer,
    options: BenchmarkRunContext
) {
    if (options.autotrappingMode === "select") {
        callbackReadSink = callbackReadSink + consumer.selectedTotal;
        return;
    }
    if (options.autotrappingMode === "memo") {
        callbackReadSink = callbackReadSink + consumer.memoTotal;
        return;
    }
    if (options.autotrappingMode === "fnMemo") {
        callbackReadSink =
            callbackReadSink +
            consumer.formatTotal(
                options.depthTier.value + options.widthTier.value
            );
        return;
    }
    throw new Error(
        `${options.scenario.title}: auto-trapping benchmark missing autotrappingMode.`
    );
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
        autotrappingMode: options.autotrappingMode,
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function isReactBenchmarkRoot(value: unknown): value is ReactBenchmarkRoot {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.render === "function" &&
        typeof value.unmount === "function"
    );
}

function isNumberReactStateTuple(
    value: unknown
): value is [number, (value: number) => void] {
    if (!Array.isArray(value)) {
        return false;
    }
    if (value.length !== 2) {
        return false;
    }
    if (typeof value[0] !== "number") {
        return false;
    }
    return typeof value[1] === "function";
}

function isJsdomConstructor(value: unknown): value is JsdomConstructor {
    return typeof value === "function";
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
        reactInitialRenderSamples: config.profile.reactInitialRenderSamples,
        seed: config.seed,
        selectedDepthTiers: [...config.selectedDepthTiers],
        selectedFrequencyTiers: [...config.selectedFrequencyTiers],
        transactionMutations: [...config.transactionMutations],
        warmupCommits: config.profile.warmupCommits,
        widthTiers: [...config.widthTiers],
    };
}
