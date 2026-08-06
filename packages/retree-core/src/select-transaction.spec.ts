/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Pins `@select` lifecycle behavior around transactions:
 *
 * 1. Select getters (and any memos they read) must never evaluate against
 *    torn mid-transaction state. Retree used to run the full `@select`
 *    lifecycle on the first write inside a transaction, so a `@memo` keyed on
 *    a revision counter that was bumped before its backing state was written
 *    cached the pre-write state under the new revision — permanently.
 * 2. The lifecycle (dependency collection + select value capture) runs once
 *    per flush per node, not once per write, and dependency arrays are not
 *    re-collected per changed dependency within one flush.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { memo, select } from "./decorators.js";
import { setRetreeListenerFlushWrapper } from "./internals/index.js";

describe("@select lifecycle across transactions", () => {
    it("does not poison a revision-keyed @memo when a transaction bumps the revision before writing state", () => {
        class Player extends ReactiveNode {
            public revision = 0;
            public frame = 0;

            @memo((self: Player) => [self.revision])
            public get derivedFrame(): number {
                return this.frame;
            }

            @select()
            public get selection(): number {
                return this.derivedFrame;
            }
        }

        const player = Retree.root(new Player());
        const listener = vi.fn();
        Retree.on(player, "nodeChanged", listener);

        Retree.runTransaction(() => {
            player.revision = player.revision + 1;
            player.frame = 5;
        });

        // The memo is keyed on `revision`. If the select lifecycle evaluated
        // the getter after the revision bump but before the frame write, the
        // memo cached frame=0 under revision=1 forever.
        expect(player.derivedFrame).toBe(5);
        expect(player.selection).toBe(5);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not poison a keyless memo keyed on a revision cell inside a transaction", () => {
        class Recorder extends ReactiveNode {
            public revision = 0;
            public frames: number[] = [];

            @select()
            public get lastFrame(): number | undefined {
                return this.memo(
                    "lastFrame",
                    () => this.frames[this.frames.length - 1],
                    [this.revision]
                );
            }
        }

        const recorder = Retree.root(new Recorder());
        Retree.on(recorder, "nodeChanged", () => undefined);

        Retree.runTransaction(() => {
            recorder.revision = recorder.revision + 1;
            recorder.frames.push(42);
        });

        expect(recorder.lastFrame).toBe(42);
    });

    it("runs an auto-trapped @select getter a constant number of times per transaction flush, not per write", () => {
        let getterRuns = 0;
        class Stats extends ReactiveNode {
            public a = 0;
            public b = 0;

            @select()
            public get sum(): number {
                getterRuns++;
                return this.a + this.b;
            }
        }

        const stats = Retree.root(new Stats());
        Retree.on(stats, "nodeChanged", () => undefined);
        getterRuns = 0;

        Retree.runTransaction(() => {
            for (let write = 1; write <= 10; write++) {
                stats.a = write;
            }
        });

        // One lifecycle pass at flush. The tracked collection pass supplies
        // both the dependency list and the selected value, so ten writes must
        // not cost ten (let alone twenty) getter evaluations.
        expect(getterRuns).toBeLessThanOrEqual(2);
    });

    it("collects an explicit @select dependency list a constant number of times when many dependencies change in one flush", () => {
        let dependencyRuns = 0;
        class MultiView extends ReactiveNode {
            public d1 = { value: 0 };
            public d2 = { value: 0 };
            public d3 = { value: 0 };
            public d4 = { value: 0 };
            public d5 = { value: 0 };

            @select((self: MultiView) => {
                dependencyRuns++;
                return [self.d1, self.d2, self.d3, self.d4, self.d5];
            })
            public get total(): number {
                return (
                    this.d1.value +
                    this.d2.value +
                    this.d3.value +
                    this.d4.value +
                    this.d5.value
                );
            }
        }

        const view = Retree.root(new MultiView());
        const listener = vi.fn();
        Retree.on(view, "nodeChanged", listener);
        dependencyRuns = 0;

        Retree.runTransaction(() => {
            view.d1.value = 1;
            view.d2.value = 1;
            view.d3.value = 1;
            view.d4.value = 1;
            view.d5.value = 1;
        });

        // Five changed dependencies flush as five emissions, but the
        // dependency array must be collected from one shared pass per flush,
        // not once per changed dependency.
        expect(dependencyRuns).toBeLessThanOrEqual(3);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("still notifies when a dependency written outside any transaction changes the selection", () => {
        class Watcher extends ReactiveNode {
            public doc = { revision: 0, text: "" };

            @select()
            public get summary(): string {
                return `${this.doc.revision}:${this.doc.text}`;
            }
        }

        const watcher = Retree.root(new Watcher());
        const listener = vi.fn();
        Retree.on(watcher, "nodeChanged", listener);

        watcher.doc.text = "hello";
        expect(listener).toHaveBeenCalledTimes(1);
        expect(watcher.summary).toBe("0:hello");

        Retree.runTransaction(() => {
            watcher.doc.revision = 1;
            watcher.doc.text = "world";
        });
        expect(listener).toHaveBeenCalledTimes(2);
        expect(watcher.summary).toBe("1:world");
    });

    it("keeps select previous values from settled pre-transaction state for notification gating", () => {
        class Gate extends ReactiveNode {
            public revision = 0;
            public payload = 0;

            @memo((self: Gate) => [self.revision])
            public get snapshot(): number {
                return this.payload;
            }

            @select()
            public get selection(): number {
                return this.snapshot;
            }
        }

        const gate = Retree.root(new Gate());
        const listener = vi.fn();
        Retree.on(gate, "nodeChanged", listener);

        Retree.runTransaction(() => {
            gate.revision = gate.revision + 1;
            gate.payload = 7;
        });
        expect(gate.selection).toBe(7);
        expect(listener).toHaveBeenCalledTimes(1);

        // A second transaction must observe 7 -> 9, not a torn 0 -> 9.
        Retree.runTransaction(() => {
            gate.revision = gate.revision + 1;
            gate.payload = 9;
        });
        expect(gate.selection).toBe(9);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe("@select lifecycle drain edge cases", () => {
    afterEach(() => {
        setRetreeListenerFlushWrapper(undefined);
    });

    it("does not re-run an explicit-selector @select getter forever when the getter writes", () => {
        let getterRuns = 0;
        class LazyInit extends ReactiveNode {
            public child = { v: 0 };
            public writes = 0;

            @select(
                (self: LazyInit) => self.dependency(self.child, [self.child.v]),
                { equals: (_self, previous, next) => previous === next }
            )
            public get doubled(): number {
                Retree.untracked(() => {
                    this.writes = this.writes + 1;
                });
                return this.child.v * 2;
            }
        }

        const root = Retree.root(new LazyInit());
        const listener = vi.fn();
        Retree.on(root, "nodeChanged", listener);
        getterRuns = 0;
        root.child.v = 1;

        // A getter that writes must not emit/reproxy from inside the
        // lifecycle's value resolution and re-trigger itself forever.
        expect(root.writes).toBeLessThan(10);
        expect(root.doubled).toBe(2);
        void getterRuns;
    });

    it("notifies a dependent subscribed mid-flush for a dependency written in the same transaction", () => {
        class Mid extends ReactiveNode {
            public leaf = { v: 0 };

            @select()
            public get doubled(): number {
                return this.leaf.v * 2;
            }
        }
        class Top extends ReactiveNode {
            public mode = 0;
            public mid = new Mid();

            public get dependencies() {
                return this.mode === 0 ? [] : [this.mid];
            }
        }

        const top = Retree.root(new Top());
        const topListener = vi.fn();
        const midListener = vi.fn();
        Retree.on(top, "nodeChanged", topListener);
        Retree.on(top.mid, "nodeChanged", midListener);

        Retree.runTransaction(() => {
            top.mode = 1;
            top.mid.leaf.v = 1;
        });

        // The deferred lifecycle pass observes post-write state; it must not
        // store that state as mid's "previous" baseline before leaf's pending
        // emission validates, or the change is absorbed instead of notified.
        expect(midListener).toHaveBeenCalledTimes(1);
        expect(top.mid.doubled).toBe(2);
    });

    it("drains lifecycle work scheduled by the listener-flush wrapper after the flush loop", () => {
        class Watched extends ReactiveNode {
            public dep = { v: 0 };

            @select()
            public get tracked(): number {
                return this.dep.v;
            }
        }
        const root = Retree.root({
            trigger: { t: 0 },
            watched: new Watched(),
        });
        const watchedListener = vi.fn();
        let pendingCommit: (() => void) | undefined;
        setRetreeListenerFlushWrapper((flush) => {
            flush();
            const commit = pendingCommit;
            pendingCommit = undefined;
            commit?.();
        });
        Retree.on(root.trigger, "nodeChanged", () => {
            pendingCommit = () => {
                Retree.on(root.watched, "nodeChanged", watchedListener);
            };
        });

        Retree.runTransaction(() => {
            root.trigger.t = 1;
        });
        // The subscription landed after the flush loop's trailing drain but
        // inside the wrapper; its lifecycle pass must still run so the
        // dependency subscription below is live.
        root.watched.dep.v = 1;
        expect(watchedListener).toHaveBeenCalledTimes(1);
    });

    it("refreshes subscriptions even when a listener throws mid-flush", () => {
        class Switcher extends ReactiveNode {
            public useA = true;
            public a = { v: 0 };
            public b = { v: 0 };

            public get dependencies() {
                return [this.useA ? this.a : this.b];
            }
        }
        const root = Retree.root(new Switcher());
        const listener = vi.fn(() => {
            if (root.useA) {
                root.useA = false;
                throw new Error("listener boom");
            }
        });
        Retree.on(root, "nodeChanged", listener);

        expect(() =>
            Retree.runTransaction(() => {
                root.a.v = 1;
            })
        ).toThrow("listener boom");

        listener.mockClear();
        root.b.v = 1;
        expect(listener).toHaveBeenCalledTimes(1);
        listener.mockClear();
        root.a.v = 2;
        expect(listener).not.toHaveBeenCalled();
    });

    it("does not drop other queued lifecycle passes when one dependencies getter throws", () => {
        class Bad extends ReactiveNode {
            public fail = false;

            public get dependencies(): ReactiveNode[] {
                if (this.fail) {
                    throw new Error("dependencies boom");
                }
                return [];
            }
        }
        class Good extends ReactiveNode {
            public useA = true;
            public a = { v: 0 };
            public b = { v: 0 };

            public get dependencies() {
                return [this.useA ? this.a : this.b];
            }
        }
        const root = Retree.root({ bad: new Bad(), good: new Good() });
        Retree.on(root.bad, "nodeChanged", () => undefined);
        const goodListener = vi.fn();
        Retree.on(root.good, "nodeChanged", goodListener);

        expect(() =>
            Retree.runTransaction(() => {
                root.bad.fail = true;
                root.good.useA = false;
            })
        ).toThrow("dependencies boom");

        goodListener.mockClear();
        root.good.b.v = 1;
        expect(goodListener).toHaveBeenCalledTimes(1);
    });

    it("invalidates cached dependency collections when an @ignore field changes", async () => {
        const { ignore } = await import("./decorators.js");
        class Modal extends ReactiveNode {
            @ignore
            public mode = 0;
            public a = { v: 0 };
            public b = { v: 0 };

            public get dependencies() {
                return [this.mode === 0 ? this.a : this.b];
            }
        }
        const root = Retree.root(new Modal());
        const listener = vi.fn();
        Retree.on(root, "nodeChanged", listener);

        root.mode = 1;
        // @ignore writes emit nothing, so resubscription happens on the next
        // lifecycle pass — but that pass must observe the new mode instead of
        // reusing a collection cached before the @ignore write.
        Retree.on(root, "nodeChanged", () => undefined);

        root.b.v = 1;
        expect(listener).toHaveBeenCalledTimes(1);
        listener.mockClear();
        root.a.v = 1;
        expect(listener).not.toHaveBeenCalled();
    });
});
