import { runWithIsolatedDependencyTracking } from "./internals/dependency-tracking.js";
import { getTreeSnapshotVersion } from "./internals/snapshot-version.js";
import { getUnscopedWriteVersion } from "./internals/write-version.js";
import { TreeNode } from "./types.js";

export interface RetreeMaterializeProgress {
    /** Number of generator yields completed so far. */
    readonly steps: number;
    readonly slices: number;
    readonly done: boolean;
}

export interface RetreeMaterializeOptions {
    /** Milliseconds of work per slice, checked between steps. Defaults to 4. */
    budgetMs?: number;
    /** Abort when the selected root changes or the loading boundary unmounts. */
    signal?: AbortSignal;
    /**
     * Additional revision for inputs outside the root's structural tree.
     * Must return a stable value until those inputs change, compared with Object.is.
     */
    getRevision?: () => unknown;
    /** Called after each slice. No partial result is exposed. */
    onProgress?: (progress: RetreeMaterializeProgress) => void;
    /**
     * Host scheduling override. Must yield to a task, not just a microtask.
     * The default waits for an animation frame then a timer in visible browsers,
     * or a timer in other environments. Abort cancels the wait in either case.
     */
    schedule?: (signal: AbortSignal) => Promise<void>;
}

/** @internal Implementation of Retree.materializeAsync. */
export async function materializeAsync<TNode extends TreeNode, TResult>(
    root: TNode,
    build: (root: TNode) => Iterator<void, TResult, void>,
    options: RetreeMaterializeOptions
): Promise<TResult> {
    const budget = options.budgetMs ?? 4;
    if (!Number.isFinite(budget)) {
        throw new Error("Retree.materializeAsync: budgetMs must be finite.");
    }
    if (budget <= 0) {
        throw new Error(
            "Retree.materializeAsync: budgetMs must be greater than 0."
        );
    }
    const controller = new AbortController();
    const { signal } = controller;
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let iterator: Iterator<void, TResult, void> | undefined;
    let completed = false;
    try {
        signal.throwIfAborted();
        const version = getTreeSnapshotVersion(root);
        const unscopedVersion = getUnscopedWriteVersion();
        const revision = runWithIsolatedDependencyTracking(() =>
            options.getRevision?.()
        );
        const validate = () => {
            signal.throwIfAborted();
            if (getUnscopedWriteVersion() !== unscopedVersion) {
                throw new DOMException(
                    "Retree.materializeAsync: a silent or unscoped write may have changed the source. Start a new task after the write.",
                    "AbortError"
                );
            }
            if (getTreeSnapshotVersion(root) !== version) {
                throw new DOMException(
                    "Retree.materializeAsync: the source tree changed. Start a new task for the current source.",
                    "AbortError"
                );
            }
            if (!Object.is(options.getRevision?.(), revision)) {
                throw new DOMException(
                    "Retree.materializeAsync: the supplied revision changed. Start a new task for the current revision.",
                    "AbortError"
                );
            }
        };
        let steps = 0;
        let slices = 0;
        while (true) {
            await waitForHost(options.schedule ?? scheduleAfterPaint, signal);
            const result = runWithIsolatedDependencyTracking(() => {
                validate();
                const deadline = performance.now() + budget;
                iterator ??= build(root);
                let next: IteratorResult<void, TResult>;
                do {
                    signal.throwIfAborted();
                    next = iterator.next();
                    if (next.done) break;
                    steps++;
                } while (performance.now() < deadline);
                validate();
                slices++;
                options.onProgress?.({
                    steps,
                    slices,
                    done: next.done === true,
                });
                validate();
                return next;
            });
            if (result.done) {
                completed = true;
                return result.value;
            }
        }
    } finally {
        options.signal?.removeEventListener("abort", abort);
        controller.abort();
        if (!completed)
            runWithIsolatedDependencyTracking(() => iterator?.return?.());
    }
}

function waitForHost(
    schedule: (signal: AbortSignal) => Promise<void>,
    signal: AbortSignal
): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve()
            .then(() => {
                signal.throwIfAborted();
                return schedule(signal);
            })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
    });
}

function scheduleAfterPaint(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        let frame: number | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
            if (frame !== undefined) cancelAnimationFrame(frame);
            clearTimeout(timer);
            reject(signal.reason);
        };
        const finish = () => {
            signal.removeEventListener("abort", abort);
            resolve();
        };
        signal.addEventListener("abort", abort, { once: true });
        if (
            typeof requestAnimationFrame === "function" &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible"
        ) {
            frame = requestAnimationFrame(() => {
                timer = setTimeout(finish, 0);
            });
        } else {
            timer = setTimeout(finish, 0);
        }
    });
}
