declare module "@retreejs/react/benchmark" {
    import { TreeNode } from "@retreejs/core";

    export type UseNodeInternalBenchmarkOperation =
        | "external-store-cleanup"
        | "external-store-subscribe"
        | "render-base-proxy"
        | "render-reproxy"
        | "snapshot-read";

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
