/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { getCustomProxyHandler } from "./internals/proxy.js";

const rootsToCleanup: object[] = [];
const unsubscribesToCleanup: (() => void)[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

function trackUnsubscribe(unsubscribe: () => void): () => void {
    unsubscribesToCleanup.push(unsubscribe);
    return unsubscribe;
}

afterEach(() => {
    for (const unsubscribe of unsubscribesToCleanup.splice(0)) {
        unsubscribe();
    }
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    if (getCustomProxyHandler(node)) {
        Retree.clearListeners(node as never);
    }
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

describe("Retree.effect", () => {
    it("runs immediately and re-runs when a tracked read changes", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const observed: number[] = [];

        trackUnsubscribe(
            Retree.effect(() => {
                observed.push(root.count);
            })
        );

        expect(observed).toEqual([0]);
        root.count = 1;
        expect(observed).toEqual([0, 1]);
        root.count = 2;
        expect(observed).toEqual([0, 1, 2]);
    });

    it("skips unrelated writes to a tracked node (validation gate)", () => {
        const root = trackRoot(Retree.root({ read: 0, unrelated: 0 }));
        let runs = 0;

        trackUnsubscribe(
            Retree.effect(() => {
                runs++;
                void root.read;
            })
        );

        expect(runs).toBe(1);
        root.unrelated = 1;
        expect(runs).toBe(1);
        root.read = 1;
        expect(runs).toBe(2);
    });

    it("excludes reads wrapped in Retree.untracked", () => {
        const root = trackRoot(
            Retree.root({ tracked: { v: 0 }, hidden: { v: 0 } })
        );
        let runs = 0;

        trackUnsubscribe(
            Retree.effect(() => {
                runs++;
                void root.tracked.v;
                Retree.untracked(() => {
                    void root.hidden.v;
                });
            })
        );

        expect(runs).toBe(1);
        root.hidden.v = 1;
        expect(runs).toBe(1);
        root.tracked.v = 1;
        expect(runs).toBe(2);
    });

    it("re-runs on nested node reads", () => {
        const root = trackRoot(
            Retree.root({ child: { inner: { value: "a" } } })
        );
        const observed: string[] = [];

        trackUnsubscribe(
            Retree.effect(() => {
                observed.push(root.child.inner.value);
            })
        );

        root.child.inner.value = "b";
        expect(observed).toEqual(["a", "b"]);

        // Replacing an intermediate node re-runs and re-tracks the new path.
        root.child = { inner: { value: "c" } };
        expect(observed).toEqual(["a", "b", "c"]);
        root.child.inner.value = "d";
        expect(observed).toEqual(["a", "b", "c", "d"]);
    });

    it("stops re-running after unsubscribe", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        let runs = 0;

        const stop = Retree.effect(() => {
            runs++;
            void root.count;
        });

        root.count = 1;
        expect(runs).toBe(2);
        stop();
        root.count = 2;
        expect(runs).toBe(2);
        // Unsubscribe is idempotent.
        stop();
    });

    it("throws a pinpointed loop-guard error when the effect's own writes re-trigger it forever", () => {
        const root = trackRoot(Retree.root({ items: [] as number[] }));

        trackUnsubscribe(
            Retree.effect(function growForever() {
                root.items.push(root.items.length);
            })
        );

        expect(() => root.items.push(-1)).toThrow(
            /Retree\.effect: the effect 'growForever' re-triggered itself synchronously more than 100 times/
        );
    });

    it("converges when the effect's writes reach a fixed point", () => {
        const root = trackRoot(Retree.root({ value: 5, clamped: 0 }));
        let runs = 0;

        trackUnsubscribe(
            Retree.effect(() => {
                runs++;
                const next = Math.min(root.value, 10);
                if (root.clamped !== next) {
                    root.clamped = next;
                }
            })
        );

        expect(root.clamped).toBe(5);
        root.value = 25;
        expect(root.clamped).toBe(10);
        // One re-run for the value write plus one for its own clamped write.
        expect(runs).toBeLessThanOrEqual(4);
    });

    it("passes errors to onError and keeps the reaction alive", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const errors: unknown[] = [];
        const observed: number[] = [];

        trackUnsubscribe(
            Retree.effect(
                () => {
                    const value = root.count;
                    if (value === 1) {
                        throw new Error("boom");
                    }
                    observed.push(value);
                },
                { onError: (error) => errors.push(error) }
            )
        );

        root.count = 1; // throws inside the run
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(Error);

        root.count = 2; // reaction recovered
        expect(observed).toEqual([0, 2]);
        expect(errors).toHaveLength(1);
    });

    it("rethrows asynchronously by default without killing the reaction", () => {
        vi.useFakeTimers();
        const root = trackRoot(Retree.root({ count: 0 }));
        const observed: number[] = [];

        trackUnsubscribe(
            Retree.effect(() => {
                const value = root.count;
                if (value === 1) {
                    throw new Error("async boom");
                }
                observed.push(value);
            })
        );

        // The triggering write itself must not throw.
        expect(() => {
            root.count = 1;
        }).not.toThrow();
        // The error surfaces later on a fresh stack.
        expect(() => vi.runAllTimers()).toThrow("async boom");

        root.count = 2;
        expect(observed).toEqual([0, 2]);
    });

    it("does not warn about writes made inside the effect", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const root = trackRoot(Retree.root({ source: 1, mirror: 0 }));

        trackUnsubscribe(
            Retree.effect(() => {
                root.mirror = root.source * 2;
            })
        );
        root.source = 2;

        expect(root.mirror).toBe(4);
        expect(warn).not.toHaveBeenCalled();
    });

    it("throws a pinpointed error when fn is not a function", () => {
        expect(() => Retree.effect(undefined as unknown as () => void)).toThrow(
            /Retree\.effect: expected a function/
        );
    });

    it("removes every subscription when the effect stops itself mid-run", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const baseline = liveListenerCount();
        let runs = 0;
        const stop: () => void = trackUnsubscribe(
            Retree.effect(() => {
                runs++;
                if (root.count > 0) {
                    stop();
                }
            })
        );
        expect(runs).toBe(1);

        // Run 2 disposes from inside the body; the post-run resubscribe must
        // bail, or the run's subscriptions leak with no way to remove them.
        root.count = 1;
        expect(runs).toBe(2);
        expect(liveListenerCount()).toBe(baseline);

        root.count = 2;
        expect(runs).toBe(2);
    });

    it("cascades creation-run self-writes to the same fixed point as steady-state runs", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        let runs = 0;

        trackUnsubscribe(
            Retree.effect(() => {
                runs++;
                if (root.count < 3) {
                    root.count = root.count + 1;
                }
            })
        );

        // Three converging creation-cascade writes plus the final clean run;
        // without the cascade the count would stick at 1 after one run.
        expect(runs).toBe(4);
        expect(root.count).toBe(3);
    });

    it("does not cascade when the creation run writes back the value it read", () => {
        const root = trackRoot(Retree.root({ count: 5 }));
        let runs = 0;

        trackUnsubscribe(
            Retree.effect(() => {
                runs++;
                const read = root.count;
                root.count = read;
            })
        );

        // The self-write re-read equal, matching the steady-state emission
        // path, which skips value-unchanged writes.
        expect(runs).toBe(1);
    });

    it("throws the loop-guard error at creation when the first run's own writes never converge", () => {
        const root = trackRoot(Retree.root({ count: 0 }));

        expect(() =>
            Retree.effect(function runaway() {
                root.count = root.count + 1;
            })
        ).toThrow(
            /Retree\.effect: the effect 'runaway' re-triggered itself synchronously more than 100 times/
        );
    });
});

interface IListenerCountProbe {
    nodeChangedListenerCount: number;
    treeChangedListenerCount: number;
    nodeRemovedListenerCount: number;
}

/**
 * Test probe for the private live-listener counters. The registries are
 * non-iterable WeakMaps, so the counters are the only way to observe that a
 * mid-run dispose left no subscriptions behind.
 */
function liveListenerCount(): number {
    const probe = Retree as unknown as IListenerCountProbe;
    return (
        probe.nodeChangedListenerCount +
        probe.treeChangedListenerCount +
        probe.nodeRemovedListenerCount
    );
}
