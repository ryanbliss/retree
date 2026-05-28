import os from "node:os";
import { Worker } from "node:worker_threads";
import {
    estimateBenchmarkScenarioWork,
    estimateBenchmarkWork,
    getBenchmarkScenarioCallbackReadModes,
    getBenchmarkScenarioDefinitions,
    BenchmarkStoppedError,
} from "./benchmarks";
import {
    BenchmarkConfig,
    BenchmarkProgressEvent,
    BenchmarkProgressTask,
    BenchmarkProgressTaskStatus,
    BenchmarkResults,
    BenchmarkScenarioResult,
    BenchmarkWorkEstimate,
    CallbackReadMode,
    ScenarioId,
    TierDefinition,
} from "./types";
import { summarizeDurations } from "./stats";

export const CONTROL_PAUSED_INDEX = 0;
export const CONTROL_STOPPED_INDEX = 1;
export const CONTROL_STEP_INDEX = 2;
export const CONTROL_BUFFER_LENGTH = 3;

export interface RunBenchmarksParallelOptions {
    controlBuffer?: SharedArrayBuffer;
    onProgress?: (event: BenchmarkProgressEvent) => void;
    workerUrl: URL;
}

interface ScenarioWorkShard {
    callbackReadMode?: CallbackReadMode;
    config: BenchmarkConfig;
    depthTier: TierDefinition;
    frequencyTier: TierDefinition;
    id: string;
    scenarioId: ScenarioId;
    scenarioTitle: string;
    widthTier?: TierDefinition;
    workEstimate: BenchmarkWorkEstimate;
}

interface ShardProgressSnapshot {
    event?: BenchmarkProgressEvent;
    result?: BenchmarkScenarioResult;
    shard: ScenarioWorkShard;
    status: BenchmarkProgressTaskStatus;
}

type WorkerMessage =
    | {
          event: BenchmarkProgressEvent;
          scenarioId: ScenarioId;
          type: "progress";
      }
    | {
          result: BenchmarkScenarioResult;
          scenarioId: ScenarioId;
          type: "result";
      }
    | {
          scenarioId: ScenarioId;
          type: "stopped";
      }
    | {
          message: string;
          scenarioId: ScenarioId;
          stack?: string;
          type: "error";
      };

export async function runBenchmarksInParallelWithProgress(
    config: BenchmarkConfig,
    options: RunBenchmarksParallelOptions
): Promise<BenchmarkResults> {
    const scenarios = getBenchmarkScenarioDefinitions();
    const totalEstimate = estimateBenchmarkWork(config);
    const controlBuffer =
        options.controlBuffer ??
        new SharedArrayBuffer(
            Int32Array.BYTES_PER_ELEMENT * CONTROL_BUFFER_LENGTH
        );
    const shards = createScenarioWorkShards(config);
    const progressByShard = new Map<string, ShardProgressSnapshot>();
    for (const shard of shards) {
        progressByShard.set(shard.id, {
            shard,
            status: "pending",
        });
    }
    const workerCount = resolveWorkerCount({
        requestedWorkerCount: config.parallelWorkers,
        scenarioCount: scenarios.length,
        shardCount: shards.length,
    });
    const shardQueue = orderScenarioWorkShards(shards);
    let nextShardIndex = 0;

    const runNextShard = async (): Promise<void> => {
        const shard = shardQueue[nextShardIndex];
        if (shard === undefined) {
            return;
        }
        nextShardIndex++;
        progressByShard.set(shard.id, {
            shard,
            status: "starting",
        });
        options.onProgress?.(
            createAggregatedProgressEvent({
                event: createFallbackProgressEvent({
                    scenarioId: shard.scenarioId,
                    shard,
                }),
                progressByShard,
                scenarioIds: scenarios.map((scenario) => scenario.id),
                totalEstimate,
            })
        );

        await new Promise<void>((resolve, reject) => {
            const worker = new Worker(options.workerUrl, {
                workerData: {
                    config: shard.config,
                    controlBuffer,
                    scenarioId: shard.scenarioId,
                },
            });

            worker.on("message", (message: unknown) => {
                const parsed = parseWorkerMessage(message);
                if (parsed.type === "progress") {
                    progressByShard.set(shard.id, {
                        event: parsed.event,
                        shard,
                        status: "running",
                    });
                    options.onProgress?.(
                        createAggregatedProgressEvent({
                            event: parsed.event,
                            progressByShard,
                            scenarioIds: scenarios.map(
                                (scenario) => scenario.id
                            ),
                            totalEstimate,
                        })
                    );
                    return;
                }
                if (parsed.type === "result") {
                    progressByShard.set(shard.id, {
                        result: parsed.result,
                        shard,
                        status: "complete",
                    });
                    options.onProgress?.(
                        createAggregatedProgressEvent({
                            event: createFallbackProgressEvent({
                                scenarioId: shard.scenarioId,
                                shard,
                            }),
                            progressByShard,
                            scenarioIds: scenarios.map(
                                (scenario) => scenario.id
                            ),
                            totalEstimate,
                        })
                    );
                    resolve();
                    return;
                }
                if (parsed.type === "stopped") {
                    reject(new BenchmarkStoppedError());
                    return;
                }

                const error = new Error(parsed.message);
                error.stack = parsed.stack;
                reject(error);
            });

            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code === 0) {
                    return;
                }
                reject(
                    new Error(
                        `Benchmark scenario worker ${shard.scenarioId} shard ${shard.id} exited with code ${code}.`
                    )
                );
            });
        });
        await runNextShard();
    };

    await Promise.all(Array.from({ length: workerCount }, runNextShard));

    return {
        metadata: createBenchmarkMetadata(config, workerCount),
        scenarios: scenarios.map((scenario) => {
            return mergeScenarioShardResults(scenario.id, progressByShard);
        }),
    };
}

function createAggregatedProgressEvent(options: {
    event: BenchmarkProgressEvent;
    progressByShard: Map<string, ShardProgressSnapshot>;
    scenarioIds: ScenarioId[];
    totalEstimate: BenchmarkWorkEstimate;
}): BenchmarkProgressEvent {
    let operationIndex = 0;
    let phaseIndex = 0;
    let caseIndex = 0;

    const parallelTasks: BenchmarkProgressTask[] = [];

    for (const snapshot of options.progressByShard.values()) {
        operationIndex =
            operationIndex + getShardCompletedOperationCount(snapshot);
        phaseIndex = phaseIndex + getShardCompletedPhaseCount(snapshot);
        caseIndex = caseIndex + getShardCompletedCaseCount(snapshot);
    }

    for (const scenarioId of options.scenarioIds) {
        const snapshots = getScenarioShardSnapshots(
            options.progressByShard,
            scenarioId
        );
        if (snapshots.length === 0) {
            throw new Error(
                `Cannot aggregate benchmark progress: scenario ${scenarioId} has no work shards.`
            );
        }
        if (snapshots.every((snapshot) => snapshot.status === "complete")) {
            parallelTasks.push(createCompletedScenarioTask(snapshots));
            continue;
        }
        for (const snapshot of snapshots) {
            if (snapshot.status === "complete") {
                continue;
            }
            parallelTasks.push(createShardProgressTask(snapshot));
        }
    }

    return {
        ...options.event,
        caseIndex,
        operationIndex,
        parallelTasks,
        phaseIndex,
        totalCases: options.totalEstimate.totalCases,
        totalOperations: options.totalEstimate.totalOperations,
        totalPhases: options.totalEstimate.totalPhases,
    };
}

function createCompletedScenarioTask(
    snapshots: ShardProgressSnapshot[]
): BenchmarkProgressTask {
    const first = snapshots[0];
    if (first === undefined) {
        throw new Error(
            "Cannot create completed scenario progress task without shards."
        );
    }
    const scenarioEstimate = summarizeShardWork(snapshots);
    return {
        caseIndex: scenarioEstimate.totalCases,
        completedWorkers: snapshots.length,
        operationIndex: scenarioEstimate.totalOperations,
        phaseIndex: scenarioEstimate.totalPhases,
        p95OperationDurationMs: summarizeScenarioShardP95(snapshots),
        scenarioId: first.shard.scenarioId,
        scenarioTitle: first.shard.scenarioTitle,
        status: "complete",
        totalCases: scenarioEstimate.totalCases,
        totalOperations: scenarioEstimate.totalOperations,
        totalPhases: scenarioEstimate.totalPhases,
        totalWorkers: snapshots.length,
    };
}

function createShardProgressTask(
    snapshot: ShardProgressSnapshot
): BenchmarkProgressTask {
    const event = snapshot.event;
    if (event === undefined) {
        return {
            callbackReadMode: snapshot.shard.callbackReadMode,
            caseIndex: 0,
            depth: snapshot.shard.depthTier.value,
            depthTitle: snapshot.shard.depthTier.title,
            frequencyTitle: snapshot.shard.frequencyTier.title,
            operationIndex: 0,
            phaseIndex: 0,
            scenarioId: snapshot.shard.scenarioId,
            scenarioTitle: snapshot.shard.scenarioTitle,
            status: snapshot.status,
            totalCases: snapshot.shard.workEstimate.totalCases,
            totalOperations: snapshot.shard.workEstimate.totalOperations,
            totalPhases: snapshot.shard.workEstimate.totalPhases,
            width: snapshot.shard.widthTier?.value,
            widthTitle: snapshot.shard.widthTier?.title ?? "All",
        };
    }

    return {
        callbackReadMode: event.callbackReadMode,
        caseIndex: event.caseIndex,
        commitIndex: event.commitIndex,
        commitsInPhase: event.commitsInPhase,
        depth: event.depth,
        depthTitle: event.depthTitle,
        frequencyTitle: event.frequencyTitle,
        lastOperationDurationMs: event.lastOperationDurationMs,
        operationIndex: event.operationIndex,
        phase: event.phase,
        phaseIndex: event.phaseIndex,
        scenarioId: event.scenarioId,
        scenarioTitle: event.scenarioTitle,
        status: snapshot.status,
        totalCases: event.totalCases,
        totalOperations: event.totalOperations,
        totalPhases: event.totalPhases,
        width: event.width,
        widthTitle: event.widthTitle,
    };
}

function getScenarioShardSnapshots(
    progressByShard: Map<string, ShardProgressSnapshot>,
    scenarioId: ScenarioId
) {
    return [...progressByShard.values()].filter(
        (snapshot) => snapshot.shard.scenarioId === scenarioId
    );
}

function getShardCompletedOperationCount(snapshot: ShardProgressSnapshot) {
    if (snapshot.status === "complete") {
        return snapshot.shard.workEstimate.totalOperations;
    }
    return snapshot.event?.operationIndex ?? 0;
}

function getShardCompletedPhaseCount(snapshot: ShardProgressSnapshot) {
    if (snapshot.status === "complete") {
        return snapshot.shard.workEstimate.totalPhases;
    }
    return snapshot.event?.phaseIndex ?? 0;
}

function getShardCompletedCaseCount(snapshot: ShardProgressSnapshot) {
    if (snapshot.status === "complete") {
        return snapshot.shard.workEstimate.totalCases;
    }
    return snapshot.event?.caseIndex ?? 0;
}

function summarizeShardWork(snapshots: ShardProgressSnapshot[]) {
    return snapshots.reduce<BenchmarkWorkEstimate>(
        (total, snapshot) => ({
            totalCases:
                total.totalCases + snapshot.shard.workEstimate.totalCases,
            totalOperations:
                total.totalOperations +
                snapshot.shard.workEstimate.totalOperations,
            totalPhases:
                total.totalPhases + snapshot.shard.workEstimate.totalPhases,
            totalSkippedCases:
                total.totalSkippedCases +
                snapshot.shard.workEstimate.totalSkippedCases,
        }),
        {
            totalCases: 0,
            totalOperations: 0,
            totalPhases: 0,
            totalSkippedCases: 0,
        }
    );
}

function summarizeScenarioShardP95(snapshots: ShardProgressSnapshot[]) {
    const durationsMs = snapshots.flatMap((snapshot) => {
        const result = snapshot.result;
        if (result === undefined) {
            return [];
        }
        return result.cases.flatMap((benchmarkCase) =>
            benchmarkCase.measurements.map(
                (measurement) => measurement.durationMs
            )
        );
    });
    if (durationsMs.length === 0) {
        return undefined;
    }
    return summarizeDurations(durationsMs).p95Ms;
}

function createScenarioWorkShards(config: BenchmarkConfig) {
    const shards: ScenarioWorkShard[] = [];
    for (const scenario of getBenchmarkScenarioDefinitions()) {
        for (const depthTierName of config.selectedDepthTiers) {
            const depthTier = config.profile.depthTiers[depthTierName];
            for (const frequencyTierName of config.selectedFrequencyTiers) {
                const frequencyTier =
                    config.profile.frequencyTiers[frequencyTierName];
                const callbackReadModes = getBenchmarkScenarioCallbackReadModes(
                    config,
                    scenario.id
                );
                for (const widthTier of getShardWidthTiers(
                    config,
                    scenario.id
                )) {
                    const shardConfig: BenchmarkConfig = {
                        ...config,
                        selectedDepthTiers: [depthTierName],
                        selectedFrequencyTiers: [frequencyTierName],
                        widthTiers:
                            widthTier === undefined
                                ? config.widthTiers
                                : [widthTier],
                    };
                    const widthKey = widthTier?.key ?? "all-widths";
                    shards.push({
                        callbackReadMode:
                            callbackReadModes.length === 1
                                ? callbackReadModes[0]
                                : undefined,
                        config: shardConfig,
                        depthTier,
                        frequencyTier,
                        id: [
                            scenario.id,
                            depthTierName,
                            frequencyTierName,
                            widthKey,
                        ].join(":"),
                        scenarioId: scenario.id,
                        scenarioTitle: scenario.title,
                        widthTier,
                        workEstimate: estimateBenchmarkScenarioWork(
                            shardConfig,
                            scenario.id
                        ),
                    });
                }
            }
        }
    }
    return shards;
}

function getShardWidthTiers(config: BenchmarkConfig, scenarioId: ScenarioId) {
    if (!shouldShardScenarioByWidth(scenarioId)) {
        return [undefined];
    }
    return config.widthTiers;
}

function shouldShardScenarioByWidth(scenarioId: ScenarioId) {
    return (
        scenarioId === "ancestor-tree-changed-fan-out" ||
        scenarioId === "distinct-node-listeners" ||
        scenarioId === "listener-fan-out-node-changed" ||
        scenarioId === "reactive-dependency-fan-out" ||
        scenarioId === "reactive-dependency-update-fan-out" ||
        scenarioId === "run-transaction"
    );
}

function orderScenarioWorkShards(shards: ScenarioWorkShard[]) {
    const scenarioIds = getBenchmarkScenarioDefinitions().map(
        (scenario) => scenario.id
    );
    const starterShards: ScenarioWorkShard[] = [];
    const remainingShards: ScenarioWorkShard[] = [];

    for (const scenarioId of scenarioIds) {
        const scenarioShards = shards
            .filter((shard) => shard.scenarioId === scenarioId)
            .sort(compareShardCostDescending);
        const starterShard = scenarioShards[0];
        if (starterShard === undefined) {
            continue;
        }
        starterShards.push(starterShard);
        remainingShards.push(...scenarioShards.slice(1));
    }

    return [
        ...starterShards,
        ...remainingShards.sort(compareShardCostDescending),
    ];
}

function compareShardCostDescending(
    left: ScenarioWorkShard,
    right: ScenarioWorkShard
) {
    const operationDifference =
        right.workEstimate.totalOperations - left.workEstimate.totalOperations;
    if (operationDifference !== 0) {
        return operationDifference;
    }
    return left.id.localeCompare(right.id);
}

function mergeScenarioShardResults(
    scenarioId: ScenarioId,
    progressByShard: Map<string, ShardProgressSnapshot>
): BenchmarkScenarioResult {
    const scenario = getBenchmarkScenarioDefinitions().find(
        (definition) => definition.id === scenarioId
    );
    if (scenario === undefined) {
        throw new Error(
            `Cannot merge unknown benchmark scenario ${scenarioId}.`
        );
    }

    const results: BenchmarkScenarioResult[] = [];
    for (const snapshot of progressByShard.values()) {
        if (snapshot.shard.scenarioId !== scenarioId) {
            continue;
        }
        if (snapshot.result === undefined) {
            throw new Error(
                `Benchmark scenario ${scenarioId} shard ${snapshot.shard.id} did not return a result.`
            );
        }
        results.push(snapshot.result);
    }

    return {
        cases: results.flatMap((result) => result.cases).sort(compareCases),
        scenarioId: scenario.id,
        skipped: results
            .flatMap((result) => result.skipped)
            .sort(compareSkippedCases),
        title: scenario.title,
    };
}

function compareCases(
    left: BenchmarkScenarioResult["cases"][number],
    right: BenchmarkScenarioResult["cases"][number]
) {
    return (
        compareNumber(left.depth, right.depth) ||
        compareNumber(left.width, right.width) ||
        compareNumber(left.commits, right.commits) ||
        left.callbackReadMode.localeCompare(right.callbackReadMode) ||
        compareOptionalNumber(left.dependencyDepth, right.dependencyDepth) ||
        compareOptionalNumber(left.dependencyFanout, right.dependencyFanout) ||
        compareOptionalNumber(left.listenerCount, right.listenerCount) ||
        compareOptionalNumber(left.effectWrites, right.effectWrites) ||
        compareOptionalNumber(
            left.transactionMutations,
            right.transactionMutations
        )
    );
}

function compareSkippedCases(
    left: BenchmarkScenarioResult["skipped"][number],
    right: BenchmarkScenarioResult["skipped"][number]
) {
    return (
        compareNumber(left.depth, right.depth) ||
        compareNumber(left.width, right.width) ||
        compareNumber(left.commits, right.commits) ||
        left.callbackReadMode.localeCompare(right.callbackReadMode) ||
        compareOptionalNumber(left.dependencyDepth, right.dependencyDepth) ||
        compareOptionalNumber(left.dependencyFanout, right.dependencyFanout) ||
        compareOptionalNumber(left.listenerCount, right.listenerCount) ||
        compareOptionalNumber(left.effectWrites, right.effectWrites) ||
        compareOptionalNumber(
            left.transactionMutations,
            right.transactionMutations
        )
    );
}

function compareNumber(left: number, right: number) {
    return left - right;
}

function compareOptionalNumber(
    left: number | undefined,
    right: number | undefined
) {
    if (left === undefined && right === undefined) {
        return 0;
    }
    if (left === undefined) {
        return -1;
    }
    if (right === undefined) {
        return 1;
    }
    return left - right;
}

function resolveWorkerCount(options: {
    requestedWorkerCount?: number;
    scenarioCount: number;
    shardCount: number;
}) {
    if (options.shardCount < 1) {
        throw new Error(
            "Cannot run benchmark workers because no benchmark work shards were configured."
        );
    }
    const requestedWorkerCount =
        options.requestedWorkerCount ??
        getDefaultWorkerCount(options.scenarioCount);
    if (!Number.isInteger(requestedWorkerCount)) {
        throw new Error(
            `Invalid benchmark worker count ${requestedWorkerCount}. Worker count must be a whole number.`
        );
    }
    if (requestedWorkerCount < 1) {
        throw new Error(
            `Invalid benchmark worker count ${requestedWorkerCount}. Worker count must be at least 1.`
        );
    }
    return Math.min(requestedWorkerCount, options.shardCount);
}

function getDefaultWorkerCount(scenarioCount: number) {
    const availableParallelism =
        typeof os.availableParallelism === "function"
            ? os.availableParallelism()
            : os.cpus().length;
    const cpuFriendlyWorkerCount = Math.max(1, availableParallelism - 1);
    return Math.max(scenarioCount, Math.min(12, cpuFriendlyWorkerCount));
}

function createFallbackProgressEvent(options: {
    scenarioId: ScenarioId;
    shard: ScenarioWorkShard;
}): BenchmarkProgressEvent {
    const scenario = getBenchmarkScenarioDefinitions().find(
        (definition) => definition.id === options.scenarioId
    );
    if (scenario === undefined) {
        throw new Error(
            `Cannot create benchmark progress fallback for unknown scenario ${options.scenarioId}.`
        );
    }
    return {
        callbackReadMode: options.shard.callbackReadMode ?? "none",
        caseIndex: options.shard.workEstimate.totalCases,
        commitIndex: 0,
        commitsInPhase: 0,
        depth: options.shard.depthTier.value,
        depthTitle: options.shard.depthTier.title,
        frequencyTitle: options.shard.frequencyTier.title,
        operationIndex: options.shard.workEstimate.totalOperations,
        phase: "measured",
        phaseIndex: options.shard.workEstimate.totalPhases,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        totalCases: options.shard.workEstimate.totalCases,
        totalOperations: options.shard.workEstimate.totalOperations,
        totalPhases: options.shard.workEstimate.totalPhases,
        width: 0,
        widthTitle: "All",
    };
}

function parseWorkerMessage(message: unknown): WorkerMessage {
    if (!isRecord(message)) {
        throw new Error("Benchmark worker sent a non-object message.");
    }
    if (message.type === "progress") {
        if (!isScenarioId(message.scenarioId)) {
            throw new Error("Benchmark progress message missing scenarioId.");
        }
        if (!isBenchmarkProgressEvent(message.event)) {
            throw new Error("Benchmark progress message missing event.");
        }
        return {
            event: message.event,
            scenarioId: message.scenarioId,
            type: "progress",
        };
    }
    if (message.type === "result") {
        if (!isScenarioId(message.scenarioId)) {
            throw new Error("Benchmark result message missing scenarioId.");
        }
        if (!isBenchmarkScenarioResult(message.result)) {
            throw new Error("Benchmark result message missing result.");
        }
        return {
            result: message.result,
            scenarioId: message.scenarioId,
            type: "result",
        };
    }
    if (message.type === "stopped") {
        if (!isScenarioId(message.scenarioId)) {
            throw new Error("Benchmark stopped message missing scenarioId.");
        }
        return {
            scenarioId: message.scenarioId,
            type: "stopped",
        };
    }
    if (message.type === "error") {
        if (!isScenarioId(message.scenarioId)) {
            throw new Error("Benchmark error message missing scenarioId.");
        }
        if (typeof message.message !== "string") {
            throw new Error("Benchmark error message missing message text.");
        }
        return {
            message: message.message,
            scenarioId: message.scenarioId,
            stack:
                typeof message.stack === "string" ? message.stack : undefined,
            type: "error",
        };
    }
    throw new Error("Benchmark worker sent an unknown message type.");
}

function createBenchmarkMetadata(config: BenchmarkConfig, workerCount: number) {
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
        parallelWorkers: workerCount,
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function isBenchmarkProgressEvent(
    value: unknown
): value is BenchmarkProgressEvent {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.callbackReadMode === "string" &&
        typeof value.caseIndex === "number" &&
        typeof value.commitIndex === "number" &&
        typeof value.commitsInPhase === "number" &&
        typeof value.operationIndex === "number" &&
        typeof value.phaseIndex === "number" &&
        typeof value.scenarioTitle === "string" &&
        typeof value.totalCases === "number" &&
        typeof value.totalOperations === "number" &&
        typeof value.totalPhases === "number"
    );
}

function isBenchmarkScenarioResult(
    value: unknown
): value is BenchmarkScenarioResult {
    if (!isRecord(value)) {
        return false;
    }
    return (
        Array.isArray(value.cases) &&
        isScenarioId(value.scenarioId) &&
        Array.isArray(value.skipped) &&
        typeof value.title === "string"
    );
}

function isScenarioId(value: unknown): value is ScenarioId {
    if (typeof value !== "string") {
        return false;
    }
    return getBenchmarkScenarioDefinitions().some(
        (scenario) => scenario.id === value
    );
}
