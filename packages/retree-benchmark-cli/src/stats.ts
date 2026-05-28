import { BenchmarkSummary } from "./types";

export function summarizeDurations(durationsMs: number[]): BenchmarkSummary {
    if (durationsMs.length === 0) {
        throw new Error(
            "Cannot summarize benchmark durations because the sample list is empty."
        );
    }

    const sorted = [...durationsMs].sort((a, b) => a - b);
    const total = durationsMs.reduce((sum, value) => sum + value, 0);

    return {
        averageMeanMs: total / durationsMs.length,
        maxMs: sorted[sorted.length - 1],
        medianMs: percentile(sorted, 50),
        minMs: sorted[0],
        p95Ms: percentile(sorted, 95),
        samples: durationsMs.length,
    };
}

function percentile(sortedValues: number[], percentileValue: number) {
    if (sortedValues.length === 0) {
        throw new Error(
            `Cannot calculate p${percentileValue} because the sorted value list is empty.`
        );
    }
    const nearestRankIndex = Math.ceil(
        (percentileValue / 100) * sortedValues.length
    );
    return sortedValues[Math.max(nearestRankIndex - 1, 0)];
}
