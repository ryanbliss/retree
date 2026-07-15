import { parentPort, workerData } from "node:worker_threads";
import {
    BenchmarkStoppedError,
    getBenchmarkScenarioDefinitions,
    runBenchmarkScenarioWithProgress,
} from "./benchmarks.js";
import {
    CONTROL_PAUSED_INDEX,
    CONTROL_STEP_INDEX,
    CONTROL_STOPPED_INDEX,
} from "./parallel.js";
import { BenchmarkConfig, ScenarioId } from "./types.js";

interface ScenarioWorkerData {
    config: BenchmarkConfig;
    controlBuffer: SharedArrayBuffer;
    scenarioId: ScenarioId;
}

const parsedWorkerData = parseScenarioWorkerData(workerData);
const control = new Int32Array(parsedWorkerData.controlBuffer);

runBenchmarkScenarioWithProgress(
    parsedWorkerData.config,
    parsedWorkerData.scenarioId,
    {
        onProgress(event) {
            parentPort?.postMessage({
                event,
                scenarioId: parsedWorkerData.scenarioId,
                type: "progress",
            });
        },
        shouldStop() {
            return Atomics.load(control, CONTROL_STOPPED_INDEX) === 1;
        },
        async waitForTurn() {
            waitForControlTurn(control);
        },
    }
)
    .then((result) => {
        parentPort?.postMessage({
            result,
            scenarioId: parsedWorkerData.scenarioId,
            type: "result",
        });
    })
    .catch((error: unknown) => {
        if (error instanceof BenchmarkStoppedError) {
            parentPort?.postMessage({
                scenarioId: parsedWorkerData.scenarioId,
                type: "stopped",
            });
            return;
        }
        if (error instanceof Error) {
            parentPort?.postMessage({
                message: error.message,
                scenarioId: parsedWorkerData.scenarioId,
                stack: error.stack,
                type: "error",
            });
            return;
        }
        parentPort?.postMessage({
            message: String(error),
            scenarioId: parsedWorkerData.scenarioId,
            type: "error",
        });
    });

function waitForControlTurn(control: Int32Array) {
    if (Atomics.load(control, CONTROL_STOPPED_INDEX) === 1) {
        throw new BenchmarkStoppedError();
    }
    while (Atomics.load(control, CONTROL_PAUSED_INDEX) === 1) {
        const steps = Atomics.load(control, CONTROL_STEP_INDEX);
        if (steps > 0) {
            const previous = Atomics.compareExchange(
                control,
                CONTROL_STEP_INDEX,
                steps,
                steps - 1
            );
            if (previous === steps) {
                return;
            }
            continue;
        }
        Atomics.wait(control, CONTROL_PAUSED_INDEX, 1, 100);
        if (Atomics.load(control, CONTROL_STOPPED_INDEX) === 1) {
            throw new BenchmarkStoppedError();
        }
    }
}

function parseScenarioWorkerData(value: unknown): ScenarioWorkerData {
    if (!isRecord(value)) {
        throw new Error("Scenario worker data must be an object.");
    }
    if (!isBenchmarkConfig(value.config)) {
        throw new Error("Scenario worker data missing benchmark config.");
    }
    if (!(value.controlBuffer instanceof SharedArrayBuffer)) {
        throw new Error("Scenario worker data missing shared control buffer.");
    }
    if (!isScenarioId(value.scenarioId)) {
        throw new Error("Scenario worker data missing scenario id.");
    }
    return {
        config: value.config,
        controlBuffer: value.controlBuffer,
        scenarioId: value.scenarioId,
    };
}

function isBenchmarkConfig(value: unknown): value is BenchmarkConfig {
    if (!isRecord(value)) {
        return false;
    }
    return typeof value.profileName === "string";
}

function isScenarioId(value: unknown): value is ScenarioId {
    if (typeof value !== "string") {
        return false;
    }
    return getBenchmarkScenarioDefinitions().some(
        (scenario) => scenario.id === value
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}
