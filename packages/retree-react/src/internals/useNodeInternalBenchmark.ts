/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

export type UseNodeInternalBenchmarkOperation =
    | "effect-cleanup"
    | "effect-subscribe"
    | "initial-reproxy-state"
    | "render-base-proxy"
    | "render-reproxy-reset"
    | "render-state-base-proxy";

export interface UseNodeInternalBenchmarkMeasurement {
    durationMs: number;
    listenerType: "nodeChanged" | "treeChanged";
    operation: UseNodeInternalBenchmarkOperation;
}

export type UseNodeInternalBenchmarkRecorder = (
    measurement: UseNodeInternalBenchmarkMeasurement
) => void;

let benchmarkRecorder: UseNodeInternalBenchmarkRecorder | undefined;

export function __unstable_setUseNodeInternalBenchmarkRecorder(
    recorder: UseNodeInternalBenchmarkRecorder | undefined
) {
    const previousRecorder = benchmarkRecorder;
    benchmarkRecorder = recorder;
    return () => {
        benchmarkRecorder = previousRecorder;
    };
}

export function getUseNodeInternalBenchmarkRecorder() {
    return benchmarkRecorder;
}

export function measureUseNodeInternalBenchmarkOperation<T>(
    recorder: UseNodeInternalBenchmarkRecorder,
    operation: UseNodeInternalBenchmarkOperation,
    listenerType: "nodeChanged" | "treeChanged",
    run: () => T
): T {
    const startedAt = now();
    try {
        return run();
    } finally {
        recorder({
            durationMs: now() - startedAt,
            listenerType,
            operation,
        });
    }
}

function now() {
    if (globalThis.performance !== undefined) {
        return globalThis.performance.now();
    }
    return Date.now();
}
