declare module "@retreejs/react/benchmark" {
    import { TreeNode } from "@retreejs/core";

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

    export function __unstable_setUseNodeInternalBenchmarkRecorder(
        recorder: UseNodeInternalBenchmarkRecorder | undefined
    ): () => void;

    export function useNode<T extends TreeNode = TreeNode>(
        node: T | (() => T)
    ): T;

    export function useTree<T extends TreeNode = TreeNode>(
        node: T | (() => T)
    ): T;
}
