import { describe, expect, it } from "vitest";
import {
    estimateBenchmarkWork,
    getBenchmarkScenarioCallbackReadModes,
    runBenchmarks,
    runBenchmarksWithProgress,
} from "./benchmarks";
import { PROFILES } from "./config";
import { BenchmarkConfig } from "./types";

describe("benchmark scenarios", () => {
    it("uses focused render reads for React useNode", () => {
        const profile = PROFILES.stable;
        const config = createSmokeConfig();
        config.callbackReadModes = [...profile.callbackReadModes];

        expect(
            getBenchmarkScenarioCallbackReadModes(config, "react-use-node")
        ).toEqual(["none", "shallow"]);
        expect(
            getBenchmarkScenarioCallbackReadModes(config, "react-use-tree")
        ).toEqual(["none", "deep"]);
    });

    it("runs expanded scenarios with emission validation", () => {
        const profile = PROFILES.smoke;
        const results = runBenchmarks({
            callbackReadModes: [...profile.callbackReadModes],
            dependencyDepths: [1, 3],
            dependencyFanouts: [...profile.dependencyFanouts],
            effectWrites: [...profile.effectWrites],
            listenerFanouts: [...profile.listenerFanouts],
            mutationTypes: [...profile.mutationTypes],
            outputDir: "unused",
            parallelWorkers: 1,
            profile,
            profileName: "smoke",
            reactInitialRenderSamples: profile.reactInitialRenderSamples,
            seed: 42,
            selectedDepthTiers: ["low"],
            selectedFrequencyTiers: ["low"],
            transactionMutations: [...profile.transactionMutations],
            widthTiers: [profile.widthTiers.low],
        });

        expect(results.scenarios).toHaveLength(17);

        const autoSelect = results.scenarios.find(
            (scenario) => scenario.scenarioId === "auto-trapped-select"
        );
        const autoMemo = results.scenarios.find(
            (scenario) => scenario.scenarioId === "auto-trapped-memo"
        );
        const autoFnMemo = results.scenarios.find(
            (scenario) => scenario.scenarioId === "auto-trapped-fn-memo"
        );

        const direct = results.scenarios.find(
            (scenario) => scenario.scenarioId === "direct-node-changed"
        );
        const tree = results.scenarios.find(
            (scenario) => scenario.scenarioId === "root-tree-changed"
        );
        const dependency = results.scenarios.find(
            (scenario) =>
                scenario.scenarioId === "reactive-dependency-node-changed"
        );
        const listenerFanout = results.scenarios.find(
            (scenario) =>
                scenario.scenarioId === "listener-fan-out-node-changed"
        );
        const distinctNodeListeners = results.scenarios.find(
            (scenario) => scenario.scenarioId === "distinct-node-listeners"
        );
        const dependencyFanout = results.scenarios.find(
            (scenario) => scenario.scenarioId === "reactive-dependency-fan-out"
        );
        const dependencyUpdateFanout = results.scenarios.find(
            (scenario) =>
                scenario.scenarioId === "reactive-dependency-update-fan-out"
        );
        const reactUseNode = results.scenarios.find(
            (scenario) => scenario.scenarioId === "react-use-node"
        );
        const reactUseTree = results.scenarios.find(
            (scenario) => scenario.scenarioId === "react-use-tree"
        );
        const onChangedEffect = results.scenarios.find(
            (scenario) => scenario.scenarioId === "on-changed-effect"
        );
        const subscriptionChurn = results.scenarios.find(
            (scenario) => scenario.scenarioId === "subscription-churn"
        );
        const transaction = results.scenarios.find(
            (scenario) => scenario.scenarioId === "run-transaction"
        );
        const selectVsTraversal = results.scenarios.find(
            (scenario) => scenario.scenarioId === "select-vs-tree-traversal"
        );

        expect(autoSelect?.cases[0]?.autotrappingMode).toBe("select");
        expect(autoMemo?.cases[0]?.autotrappingMode).toBe("memo");
        expect(autoFnMemo?.cases[0]?.autotrappingMode).toBe("fnMemo");
        expect(autoSelect?.cases[0]?.measurements[0]?.mutationType).toBe(
            "scalar-set"
        );
        expect(direct?.cases).toHaveLength(1);
        expect(tree?.cases).toHaveLength(1);
        expect(dependency?.cases).toHaveLength(1);
        expect(dependency?.skipped).toHaveLength(1);
        expect(direct?.cases[0]?.durationsMs).toHaveLength(2);
        expect(
            direct?.cases[0]?.setupMeasurements.map(
                (measurement) => measurement.operation
            )
        ).toContain("root-proxy");
        expect(direct?.cases[0]?.setupSummary.samples).toBeGreaterThan(0);
        expect(
            direct?.cases[0]?.measurements.map((value) => value.mutationType)
        ).toEqual(["scalar-set", "array-push"]);
        expect(direct?.cases[0]?.mutationSummaries).toHaveLength(2);
        expect(tree?.cases[0]?.summary.samples).toBe(2);
        expect(dependency?.cases[0]?.dependencyDepth).toBe(1);
        expect(dependency?.skipped[0]?.reason).toMatch(/deeper than tree/);
        expect(listenerFanout?.cases[0]?.listenerCount).toBe(2);
        expect(distinctNodeListeners?.cases[0]?.listenerCount).toBe(2);
        expect(dependencyFanout?.cases[0]?.dependencyFanout).toBe(2);
        expect(dependencyUpdateFanout?.cases[0]?.dependencyFanout).toBe(2);
        expect(dependencyUpdateFanout?.cases[0]?.dependencyDepth).toBe(1);
        expect(reactUseNode?.cases[0]?.measurements[0]?.mutationType).toBe(
            "scalar-set"
        );
        expect(
            reactUseNode?.cases[0]?.setupMeasurements.map(
                (measurement) => measurement.operation
            )
        ).toContain("react-root-render");
        expect(
            reactUseNode?.cases[0]?.setupMeasurements.map(
                (measurement) => measurement.operation
            )
        ).toContain("react-hook-effect-subscribe");
        expect(
            reactUseNode?.cases[0]?.setupSummaries.find(
                (summary) => summary.operation === "react-hook-render-read"
            )?.samples
        ).toBe(profile.reactInitialRenderSamples);
        expect(
            reactUseNode?.cases[0]?.measurements[0]?.details?.map(
                (detail) => detail.operation
            )
        ).toEqual(
            expect.arrayContaining([
                "react-component-render",
                "react-hook-call",
                "react-hook-render-base-proxy",
                "react-hook-render-read",
                "react-hook-render-read-first",
                "react-hook-render-read-second",
                "react-unrelated-component-render",
                "react-unrelated-render-read",
                "react-unrelated-render-read-first",
                "react-unrelated-render-read-second",
                "react-update-outside-component",
            ])
        );
        expect(reactUseTree?.cases[0]?.measurements[0]?.mutationType).toBe(
            "scalar-set"
        );
        expect(onChangedEffect?.cases[0]?.effectWrites).toBe(1);
        expect(subscriptionChurn?.cases[0]?.measurements[0]?.mutationType).toBe(
            "subscription-cycle"
        );
        expect(transaction?.cases[0]?.transactionMutations).toBe(2);
        expect(transaction?.title).toBe("runTransaction overhead");
        expect(
            transaction?.cases[0]?.measurements[0]?.transactionComparison
        ).toMatchObject({
            savedListenerCalls: 1,
            transactionListenerCalls: 1,
            unwrappedListenerCalls: 2,
        });
        expect(
            selectVsTraversal?.cases.map((benchmarkCase) => ({
                callbackReadMode: benchmarkCase.callbackReadMode,
                selectionMode: benchmarkCase.selectionMode,
            }))
        ).toEqual([
            {
                callbackReadMode: "none",
                selectionMode: "reactive-dependency-select",
            },
            {
                callbackReadMode: "none",
                selectionMode: "root-tree-traversal",
            },
        ]);
    });

    it("runs the stable mutation mix without reparenting collection children", () => {
        const profile = PROFILES.stable;
        const results = runBenchmarks({
            callbackReadModes: ["none"],
            dependencyDepths: [1],
            dependencyFanouts: [2],
            effectWrites: [1],
            listenerFanouts: [2],
            mutationTypes: [...profile.mutationTypes],
            outputDir: "unused",
            parallelWorkers: 1,
            profile,
            profileName: "stable",
            reactInitialRenderSamples: profile.reactInitialRenderSamples,
            seed: 42,
            selectedDepthTiers: ["low"],
            selectedFrequencyTiers: ["low"],
            transactionMutations: [2],
            widthTiers: [profile.widthTiers.low],
        });

        const direct = results.scenarios.find(
            (scenario) => scenario.scenarioId === "direct-node-changed"
        );

        expect(
            direct?.cases[0]?.mutationSummaries.map(
                (summary) => summary.mutationType
            )
        ).toEqual(profile.mutationTypes);
    });

    it("estimates work and emits progress for async runs", async () => {
        const config = createSmokeConfig();
        const estimate = estimateBenchmarkWork(config);
        const lastOperationDurations: Array<number | undefined> = [];
        const progressOperations: number[] = [];
        const progressPhases: number[] = [];

        await runBenchmarksWithProgress(config, {
            onProgress(event) {
                lastOperationDurations.push(event.lastOperationDurationMs);
                progressOperations.push(event.operationIndex);
                progressPhases.push(event.phaseIndex);
            },
        });

        expect(estimate.totalOperations).toBeGreaterThan(0);
        expect(progressOperations).toHaveLength(estimate.totalOperations);
        expect(progressOperations[0]).toBe(1);
        expect(progressOperations[progressOperations.length - 1]).toBe(
            estimate.totalOperations
        );
        expect(progressPhases[0]).toBe(1);
        expect(Math.max(...progressPhases)).toBe(estimate.totalPhases);
        expect(lastOperationDurations[0]).toBeUndefined();
        expect(typeof lastOperationDurations[1]).toBe("number");
    });
});

function createSmokeConfig(): BenchmarkConfig {
    const profile = PROFILES.smoke;
    return {
        callbackReadModes: [...profile.callbackReadModes],
        dependencyDepths: [1],
        dependencyFanouts: [...profile.dependencyFanouts],
        effectWrites: [...profile.effectWrites],
        listenerFanouts: [...profile.listenerFanouts],
        mutationTypes: [...profile.mutationTypes],
        outputDir: "unused",
        parallelWorkers: 1,
        profile,
        profileName: "smoke",
        reactInitialRenderSamples: profile.reactInitialRenderSamples,
        seed: 42,
        selectedDepthTiers: ["low"],
        selectedFrequencyTiers: ["low"],
        transactionMutations: [...profile.transactionMutations],
        widthTiers: [profile.widthTiers.low],
    };
}
