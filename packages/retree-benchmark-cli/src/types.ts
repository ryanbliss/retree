export const TIER_NAMES = ["low", "medium", "high", "veryHigh"] as const;

export type TierName = (typeof TIER_NAMES)[number];

export type TierPreset = TierName | "all" | "custom";

export type ProfileName = "smoke" | "stable" | "exhaustive";

export type CallbackReadMode = "none" | "shallow" | "deep";

export type BenchmarkPhase = "measured" | "setup" | "warmup";

export type MutationType =
    | "array-push"
    | "map-set"
    | "object-replace"
    | "scalar-set"
    | "set-add"
    | "subscription-cycle";

export type ScenarioId =
    | "ancestor-tree-changed-fan-out"
    | "direct-node-changed"
    | "distinct-node-listeners"
    | "listener-fan-out-node-changed"
    | "on-changed-effect"
    | "reactive-dependency-fan-out"
    | "reactive-dependency-update-fan-out"
    | "root-tree-changed"
    | "reactive-dependency-node-changed"
    | "run-transaction"
    | "subscription-churn";

export interface TierDefinition {
    key: TierName;
    title: string;
    value: number;
}

export type TierMap = Record<TierName, TierDefinition>;

export interface ProfileDefinition {
    name: ProfileName;
    title: string;
    depthTiers: TierMap;
    effectWrites: number[];
    callbackReadModes: CallbackReadMode[];
    dependencyFanouts: number[];
    frequencyTiers: TierMap;
    listenerFanouts: number[];
    mutationTypes: MutationType[];
    transactionMutations: number[];
    warmupCommits: number;
    widthTiers: TierMap;
}

export interface BenchmarkConfig {
    callbackReadModes: CallbackReadMode[];
    dependencyDepths: number[];
    dependencyFanouts: number[];
    effectWrites: number[];
    listenerFanouts: number[];
    mutationTypes: MutationType[];
    outputDir: string;
    parallelWorkers?: number;
    profile: ProfileDefinition;
    profileName: ProfileName;
    seed: number;
    selectedDepthTiers: TierName[];
    selectedFrequencyTiers: TierName[];
    transactionMutations: number[];
    widthTiers: TierDefinition[];
}

export interface ParsedCliArgs {
    depthTiers?: TierName[];
    frequencyTiers?: TierName[];
    help: boolean;
    interactive?: boolean;
    outputDir?: string;
    profileName?: ProfileName;
    tierPreset?: Exclude<TierPreset, "custom">;
    workers?: number;
}

export interface BenchmarkSummary {
    averageMeanMs: number;
    maxMs: number;
    medianMs: number;
    minMs: number;
    p95Ms: number;
    samples: number;
}

export interface BenchmarkMeasurement {
    durationMs: number;
    mutationType: MutationType;
}

export type BenchmarkSetupOperation =
    | "broad-array-assignment"
    | "broad-array-construction"
    | "broad-map-assignment"
    | "broad-map-construction"
    | "broad-object-assignment"
    | "broad-object-construction"
    | "broad-primitive-map-assignment"
    | "broad-primitive-map-construction"
    | "broad-primitive-set-assignment"
    | "broad-primitive-set-construction"
    | "broad-set-assignment"
    | "broad-set-construction"
    | "case-setup-total"
    | "changed-effect-configuration"
    | "dependent-node-root-proxy"
    | "dependency-linking"
    | "listener-registration"
    | "listener-setup-total"
    | "mutation-target-resolution"
    | "primary-path-collection"
    | "raw-dependent-node-construction"
    | "raw-tree-construction"
    | "root-proxy";

export interface BenchmarkSetupMeasurement {
    durationMs: number;
    operation: BenchmarkSetupOperation;
}

export interface BenchmarkSetupSummary extends BenchmarkSummary {
    operation: BenchmarkSetupOperation;
}

export interface BenchmarkMutationSummary extends BenchmarkSummary {
    mutationType: MutationType;
}

export interface BenchmarkWarning {
    detail: string;
    kind: "mutation-above-average";
    mutationType: MutationType;
}

export interface BenchmarkCaseResult {
    callbackReadMode: CallbackReadMode;
    commits: number;
    dependencyDepth?: number;
    dependencyFanout?: number;
    depth: number;
    depthTitle: string;
    durationsMs: number[];
    effectWrites?: number;
    frequencyTitle: string;
    listenerCount?: number;
    measurements: BenchmarkMeasurement[];
    mutationSummaries: BenchmarkMutationSummary[];
    scenarioId: ScenarioId;
    scenarioTitle: string;
    setupMeasurements: BenchmarkSetupMeasurement[];
    setupSummaries: BenchmarkSetupSummary[];
    setupSummary: BenchmarkSummary;
    summary: BenchmarkSummary;
    transactionMutations?: number;
    warnings: BenchmarkWarning[];
    width: number;
    widthTitle: string;
}

export interface SkippedBenchmarkCase {
    callbackReadMode: CallbackReadMode;
    commits: number;
    dependencyDepth?: number;
    dependencyFanout?: number;
    depth: number;
    depthTitle: string;
    effectWrites?: number;
    frequencyTitle: string;
    listenerCount?: number;
    reason: string;
    scenarioId: ScenarioId;
    scenarioTitle: string;
    transactionMutations?: number;
    width: number;
    widthTitle: string;
}

export interface BenchmarkScenarioResult {
    cases: BenchmarkCaseResult[];
    scenarioId: ScenarioId;
    skipped: SkippedBenchmarkCase[];
    title: string;
}

export interface BenchmarkMetadata {
    arch: string;
    callbackReadModes: CallbackReadMode[];
    dependencyDepths: number[];
    dependencyFanouts: number[];
    effectWrites: number[];
    generatedAtIso: string;
    listenerFanouts: number[];
    mutationTypes: MutationType[];
    nodeVersion: string;
    parallelWorkers: number;
    platform: string;
    profileName: ProfileName;
    seed: number;
    selectedDepthTiers: TierName[];
    selectedFrequencyTiers: TierName[];
    transactionMutations: number[];
    warmupCommits: number;
    widthTiers: TierDefinition[];
}

export interface BenchmarkResults {
    metadata: BenchmarkMetadata;
    scenarios: BenchmarkScenarioResult[];
}

export interface BenchmarkArtifactPaths {
    jsonPath: string;
    latestJsonPath?: string;
    latestMarkdownPath?: string;
    latestVerboseMarkdownPath?: string;
    markdownPath: string;
    verboseMarkdownPath?: string;
}

export interface BenchmarkWorkEstimate {
    totalCases: number;
    totalOperations: number;
    totalPhases: number;
    totalSkippedCases: number;
}

export type BenchmarkProgressTaskStatus =
    | "complete"
    | "pending"
    | "running"
    | "starting";

export interface BenchmarkProgressTask {
    activeWorkers?: number;
    callbackReadMode?: CallbackReadMode;
    caseIndex: number;
    commitIndex?: number;
    commitsInPhase?: number;
    completedWorkers?: number;
    depth?: number;
    depthTitle?: string;
    frequencyTitle?: string;
    lastOperationDurationMs?: number;
    operationIndex: number;
    phase?: BenchmarkPhase;
    phaseIndex: number;
    p95OperationDurationMs?: number;
    scenarioId: ScenarioId;
    scenarioTitle: string;
    status: BenchmarkProgressTaskStatus;
    totalCases: number;
    totalOperations: number;
    totalPhases: number;
    totalWorkers?: number;
    width?: number;
    widthTitle?: string;
}

export interface BenchmarkProgressEvent {
    callbackReadMode: CallbackReadMode;
    caseIndex: number;
    commitIndex: number;
    commitsInPhase: number;
    depth: number;
    depthTitle: string;
    frequencyTitle: string;
    lastOperationDurationMs?: number;
    operationIndex: number;
    phase: BenchmarkPhase;
    phaseIndex: number;
    parallelTasks?: BenchmarkProgressTask[];
    scenarioId: ScenarioId;
    scenarioTitle: string;
    totalCases: number;
    totalOperations: number;
    totalPhases: number;
    width: number;
    widthTitle: string;
}
