/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
// "use no memo" is load-bearing when this source is compiled by the React
// Compiler (source-inclusion setups only; consumers' compilers skip the
// published bin/ output in node_modules). See useNodeInternalCore.ts and
// react-compiler.spec.tsx for the failure mode and proof.
"use no memo";
"use client";

import { TreeNode } from "@retreejs/core";
import { getBaseProxy, getReproxyNode } from "@retreejs/core/internal";
import { NodeFactory } from "../types.js";
import {
    getRetreeExternalStoreSource,
    RetreeExternalStoreSource,
} from "./externalStore.js";
import { NodeFactoryHookName } from "./factoryWarning.js";
import {
    useNodeInternalCore,
    UseNodeInternalListenerType,
    UseNodeInternalOperations,
} from "./useNodeInternalCore.js";
import {
    getUseNodeInternalBenchmarkRecorder,
    measureUseNodeInternalBenchmarkOperation,
} from "./useNodeInternalBenchmark.js";

/**
 * Instrumented wrappers around the shared external-store sources. Cached per
 * shared source so wrapper identity is stable across renders — the composite
 * store keys memoization on source identity, and a fresh wrapper every render
 * would force resubscription churn that pollutes the measurements.
 */
const instrumentedSourceCache = new WeakMap<
    RetreeExternalStoreSource,
    RetreeExternalStoreSource
>();

function getInstrumentedSource(
    listenerType: UseNodeInternalListenerType,
    baseProxy: TreeNode
): RetreeExternalStoreSource {
    const shared = getRetreeExternalStoreSource(baseProxy, listenerType);
    const cached = instrumentedSourceCache.get(shared);
    if (cached !== undefined) {
        return cached;
    }
    const instrumented: RetreeExternalStoreSource = {
        baseProxy,
        listenerType,
        getVersion() {
            const recorder = getUseNodeInternalBenchmarkRecorder();
            if (recorder === undefined) {
                return shared.getVersion();
            }
            return measureUseNodeInternalBenchmarkOperation(
                recorder,
                "snapshot-read",
                listenerType,
                () => shared.getVersion()
            );
        },
        subscribe(onStoreChange) {
            const subscribeRecorder = getUseNodeInternalBenchmarkRecorder();
            let unsubscribe: () => void;
            if (subscribeRecorder === undefined) {
                unsubscribe = shared.subscribe(onStoreChange);
            } else {
                unsubscribe = measureUseNodeInternalBenchmarkOperation(
                    subscribeRecorder,
                    "external-store-subscribe",
                    listenerType,
                    () => shared.subscribe(onStoreChange)
                );
            }
            return () => {
                const cleanupRecorder = getUseNodeInternalBenchmarkRecorder();
                if (cleanupRecorder === undefined) {
                    unsubscribe();
                    return;
                }
                measureUseNodeInternalBenchmarkOperation(
                    cleanupRecorder,
                    "external-store-cleanup",
                    listenerType,
                    unsubscribe
                );
            };
        },
    };
    instrumentedSourceCache.set(shared, instrumented);
    return instrumented;
}

const operations: UseNodeInternalOperations = {
    getRenderBaseProxy(listenerType, node) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            return getBaseProxy(node);
        }

        return measureUseNodeInternalBenchmarkOperation(
            recorder,
            "render-base-proxy",
            listenerType,
            () => getBaseProxy(node)
        );
    },
    getRenderReproxyNode(listenerType, node) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            return getReproxyNode(node);
        }

        return measureUseNodeInternalBenchmarkOperation(
            recorder,
            "render-reproxy",
            listenerType,
            () => getReproxyNode(node)
        );
    },
    getSource(listenerType, baseProxy) {
        return getInstrumentedSource(listenerType, baseProxy);
    },
};

/**
 * Benchmark-instrumented version of useNodeInternal.
 */
export function useNodeInternal<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>,
    listenerType: UseNodeInternalListenerType,
    hookName: NodeFactoryHookName
): T {
    return useNodeInternalCore(node, listenerType, hookName, operations);
}
