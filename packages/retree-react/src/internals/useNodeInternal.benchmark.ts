/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */
"use no memo";

import { TreeNode } from "@retreejs/core";
import { getBaseProxy, getReproxyNode } from "@retreejs/core/internal";
import { NodeFactory } from "../types";
import { subscribeToNode } from "./subscriptionHub";
import {
    useNodeInternalCore,
    UseNodeInternalListenerType,
    UseNodeInternalOperations,
} from "./useNodeInternalCore";
import {
    getUseNodeInternalBenchmarkRecorder,
    measureUseNodeInternalBenchmarkOperation,
} from "./useNodeInternalBenchmark";

const operations: UseNodeInternalOperations = {
    cleanupSubscription(listenerType, unsubscribe) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            unsubscribe();
            return;
        }

        measureUseNodeInternalBenchmarkOperation(
            recorder,
            "effect-cleanup",
            listenerType,
            unsubscribe
        );
    },
    getInitialReproxyNode(listenerType, node) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            return getReproxyNode(node);
        }

        return measureUseNodeInternalBenchmarkOperation(
            recorder,
            "initial-reproxy-state",
            listenerType,
            () => getReproxyNode(node)
        );
    },
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
    getResetReproxyNode(listenerType, node) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            return getReproxyNode(node);
        }

        return measureUseNodeInternalBenchmarkOperation(
            recorder,
            "render-reproxy-reset",
            listenerType,
            () => getReproxyNode(node)
        );
    },
    getStateBaseProxy(listenerType, node) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            return getBaseProxy(node);
        }

        return measureUseNodeInternalBenchmarkOperation(
            recorder,
            "render-state-base-proxy",
            listenerType,
            () => getBaseProxy(node)
        );
    },
    subscribeToNode(listenerType, node, listener) {
        const recorder = getUseNodeInternalBenchmarkRecorder();
        if (recorder === undefined) {
            return subscribeToNode(node, listenerType, listener);
        }

        return measureUseNodeInternalBenchmarkOperation(
            recorder,
            "effect-subscribe",
            listenerType,
            () => subscribeToNode(node, listenerType, listener)
        );
    },
};

/**
 * Benchmark-instrumented version of useNodeInternal.
 */
export function useNodeInternal<T extends TreeNode = TreeNode>(
    node: T | NodeFactory<T>,
    listenerType: UseNodeInternalListenerType
): T {
    return useNodeInternalCore(node, listenerType, operations);
}
