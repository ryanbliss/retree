import { afterEach, expect, it, vi } from "vitest";
import {
    memo,
    ReactiveNode,
    Retree,
    RetreeMaterializeProgress,
} from "./index.js";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function clock() {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    return () => now++;
}

it("resumes thousands of nested reads within the step budget and preserves managed identity", async () => {
    const tick = clock();
    const root = Retree.root({
        rows: Array.from({ length: 5000 }, (_, id) => ({ child: { id } })),
    });
    const progress: RetreeMaterializeProgress[] = [];
    let starts = 0;
    const schedule = vi.fn(async () => {});
    const result = await Retree.materializeAsync(
        root,
        function* (source) {
            starts++;
            const rows: { id: number }[] = [];
            for (const row of source.rows) {
                rows.push(row.child);
                tick();
                yield;
            }
            return rows;
        },
        { budgetMs: 4, schedule, onProgress: (value) => progress.push(value) }
    );

    expect(starts).toBe(1);
    expect(result).toEqual(root.rows.map((row) => row.child));
    expect(result[4000]).toBe(root.rows[4000].child);
    expect(Retree.managed(Retree.raw(result[4000]))).toBe(result[4000]);
    expect(schedule).toHaveBeenCalledTimes(1251);
    for (let i = 0; i < progress.length; i++) {
        expect(
            progress[i].steps - (progress[i - 1]?.steps ?? 0)
        ).toBeLessThanOrEqual(4);
    }
    expect(progress.at(-1)).toEqual({ steps: 5000, slices: 1251, done: true });
});

it("cancels a suspended task promptly and closes its iterator without discarding warm proxies", async () => {
    const tick = clock();
    const root = Retree.root({ child: { value: 1 } });
    const controller = new AbortController();
    let closed = false;
    let warmed: typeof root.child | undefined;
    let signal: AbortSignal | undefined;
    let schedules = 0;
    const task = Retree.materializeAsync(
        root,
        function* (source) {
            try {
                warmed = source.child;
                tick();
                yield;
                throw new Error("Cancelled work resumed");
            } finally {
                closed = true;
            }
        },
        {
            budgetMs: 1,
            signal: controller.signal,
            schedule: async (current) => {
                signal = current;
                if (++schedules === 2) {
                    controller.abort();
                    await new Promise(() => {});
                }
            },
        }
    );
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(closed).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(root.child).toBe(warmed);
});

it.each(["tree", "revision", "silent"])(
    "rejects changed %s input between slices",
    async (kind) => {
        const tick = clock();
        const root = Retree.root({ child: { value: 1 } });
        let revision = 0;
        let schedules = 0;
        let closed = false;
        const task = Retree.materializeAsync(
            root,
            function* (source) {
                try {
                    const first = source.child.value;
                    tick();
                    yield;
                    return [first, source.child.value];
                } finally {
                    closed = true;
                }
            },
            {
                budgetMs: 1,
                getRevision: kind === "revision" ? () => revision : undefined,
                schedule: async () => {
                    if (++schedules !== 2) return;
                    if (kind === "revision") revision++;
                    else if (kind === "silent")
                        Retree.runSilent(() => root.child.value++);
                    else root.child.value++;
                },
            }
        );
        await expect(task).rejects.toMatchObject({ name: "AbortError" });
        expect(closed).toBe(true);
    }
);

it("allows silent cache warming with an explicit source revision", async () => {
    const tick = clock();
    class Node extends ReactiveNode {
        revision = 0;
        private cached: { value: number } | null = null;
        get preview() {
            if (this.cached === null) {
                Retree.runSilent(() => {
                    this.cached = { value: 42 };
                });
            }
            return this.cached;
        }
    }
    const root = Retree.root(new Node());
    const result = await Retree.materializeAsync(
        root,
        function* (source) {
            const preview = source.preview;
            tick();
            yield;
            return preview;
        },
        { budgetMs: 1, getRevision: () => root.revision }
    );
    expect(result).toBe(root.preview);
    expect(result?.value).toBe(42);
});

it("does not invalidate for writes to a separate tree", async () => {
    const root = Retree.root({ value: 1 });
    const other = Retree.root({ value: 0 });
    await expect(
        Retree.materializeAsync(
            root,
            function* (source) {
                yield;
                return source.value;
            },
            {
                schedule: async () => {
                    other.value++;
                },
            }
        )
    ).resolves.toBe(1);
});

it("rejects writes and revision changes during the final step or progress callback", async () => {
    const root = Retree.root({ value: 1 });
    await expect(
        Retree.materializeAsync(
            root,
            function* (source) {
                source.value++;
                yield;
                return source.value;
            },
            { schedule: async () => {} }
        )
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
        Retree.materializeAsync(
            root,
            function* (source) {
                yield;
                return source.value;
            },
            {
                schedule: async () => {},
                onProgress: () => {
                    root.value++;
                },
            }
        )
    ).rejects.toMatchObject({ name: "AbortError" });
});

it("keeps memo tracking and peekInto reads intact without collecting async dependencies", async () => {
    let computes = 0;
    class Node extends ReactiveNode {
        child = { value: 2 };
        @memo
        get doubled() {
            computes++;
            return this.child.value * 2;
        }
    }
    const root = Retree.root(new Node());
    const result = await Retree.untracked(() =>
        Retree.materializeAsync(root, function* (source) {
            const value = source.doubled;
            yield;
            return [
                value,
                source.doubled,
                Retree.peekInto(source.child, (child) => child.value),
            ];
        })
    );
    expect(result).toEqual([4, 4, 2]);
    expect(computes).toBe(1);
    root.child.value = 3;
    expect(root.doubled).toBe(6);
    expect(computes).toBe(2);
});

it("waits for a host task before starting work", async () => {
    const started = vi.fn();
    const task = Retree.materializeAsync(Retree.root({}), function* () {
        started();
        yield;
        return 42;
    });
    await Promise.resolve();
    expect(started).not.toHaveBeenCalled();
    await expect(task).resolves.toBe(42);
});

it("waits for a frame followed by a task in a visible browser", async () => {
    vi.useFakeTimers();
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const started = vi.fn();
    const task = Retree.materializeAsync(Retree.root({}), function* () {
        started();
        yield;
        return 42;
    });
    await Promise.resolve();
    expect(frame).toBeDefined();
    expect(started).not.toHaveBeenCalled();
    frame!(0);
    expect(started).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await expect(task).resolves.toBe(42);
});

it.each([false, true])(
    "cancels the default browser wait, frame fired: %s",
    async (fireFrame) => {
        vi.useFakeTimers();
        let frame: FrameRequestCallback | undefined;
        const cancelFrame = vi.fn();
        vi.stubGlobal("document", { visibilityState: "visible" });
        vi.stubGlobal(
            "requestAnimationFrame",
            (callback: FrameRequestCallback) => {
                frame = callback;
                return 1;
            }
        );
        vi.stubGlobal("cancelAnimationFrame", cancelFrame);
        const controller = new AbortController();
        const build = vi.fn();
        const task = Retree.materializeAsync(Retree.root({}), build, {
            signal: controller.signal,
        });
        await Promise.resolve();
        if (fireFrame) frame!(0);
        controller.abort();
        await expect(task).rejects.toMatchObject({ name: "AbortError" });
        expect(cancelFrame).toHaveBeenCalledWith(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(build).not.toHaveBeenCalled();
    }
);

it("does not start an already aborted task", async () => {
    const build = vi.fn();
    const schedule = vi.fn();
    await expect(
        Retree.materializeAsync(Retree.root({}), build, {
            signal: AbortSignal.abort(),
            schedule,
        })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(build).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
});

it("closes the iterator when scheduling fails and propagates computation errors", async () => {
    const tick = clock();
    const error = new Error("host failed");
    let schedules = 0;
    let closed = false;
    await expect(
        Retree.materializeAsync(
            Retree.root({}),
            function* () {
                try {
                    tick();
                    yield;
                } finally {
                    closed = true;
                }
            },
            {
                budgetMs: 1,
                schedule: async () => {
                    if (++schedules === 2) throw error;
                },
            }
        )
    ).rejects.toBe(error);
    expect(closed).toBe(true);
    await expect(
        Retree.materializeAsync(
            Retree.root({}),
            function* () {
                yield;
                throw error;
            },
            { schedule: async () => {} }
        )
    ).rejects.toBe(error);
});

it.each([0, -1, NaN, Infinity])(
    "rejects invalid budget %s",
    async (budgetMs) => {
        await expect(
            Retree.materializeAsync(
                Retree.root({}),
                function* () {
                    yield;
                },
                { budgetMs }
            )
        ).rejects.toThrow("budgetMs");
    }
);
