import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import { memo } from "./decorators";
import { Transactions } from "./internals/transactions";

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

function clearListenersRecursively(node: unknown, seen = new Set<object>()) {
    if (!node || typeof node !== "object" || seen.has(node)) {
        return;
    }
    seen.add(node);
    Retree.clearListeners(node as never);
    for (const child of Object.values(node)) {
        clearListenersRecursively(child, seen);
    }
}

interface Card {
    text: string;
}

class ListFilterMethod extends ReactiveNode {
    public list: Card[] = [];
    public searchText: string = "";
    public computeCount = 0;

    get filtered(): Card[] {
        return this.memo(
            "filtered",
            () => {
                this.computeCount += 1;
                return this.list.filter((c) => c.text === this.searchText);
            },
            [this.list, this.searchText]
        );
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}

class ListFilterDecorator extends ReactiveNode {
    public list: Card[] = [];
    public searchText: string = "";
    public computeCount = 0;

    @memo((self: ListFilterDecorator) => [self.list, self.searchText])
    get filtered(): Card[] {
        this.computeCount += 1;
        return this.list.filter((c) => c.text === this.searchText);
    }

    get dependencies() {
        return [this.dependency(this.list)];
    }
}

describe("memo (method form)", () => {
    it("recomputes when comparison cells change and reuses cache otherwise", () => {
        const root = trackRoot(Retree.root(new ListFilterMethod()));
        Retree.on(root, "nodeChanged", vi.fn());

        // First read computes once.
        expect(root.filtered).toEqual([]);
        expect(root.computeCount).toBe(1);

        // Repeated read with no change reuses the cache.
        root.filtered;
        root.filtered;
        expect(root.computeCount).toBe(1);

        // Change a comparison value (searchText). Reads after recompute once.
        root.searchText = "match";
        expect(root.filtered).toEqual([]);
        expect(root.computeCount).toBe(2);
        root.filtered;
        expect(root.computeCount).toBe(2);

        // Mutate list (a comparison ref); next read recomputes.
        root.list.push({ text: "match" });
        expect(root.filtered).toEqual([{ text: "match" }]);
        expect(root.computeCount).toBe(3);
    });

    it("with empty comparisons array, computes once and caches forever", () => {
        class OnceNode extends ReactiveNode {
            public counter = 0;
            public computeCount = 0;

            get cached(): number {
                return this.memo(
                    "cached",
                    () => {
                        this.computeCount += 1;
                        return this.counter;
                    },
                    []
                );
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new OnceNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.cached).toBe(0);
        root.counter = 5;
        expect(root.cached).toBe(0); // still cached
        expect(root.computeCount).toBe(1);
    });

    it("with undefined comparisons, recomputes once per reproxy", () => {
        class UndefinedDepsNode extends ReactiveNode {
            public counter = 0;
            public computeCount = 0;

            get cached(): number {
                return this.memo("cached", () => {
                    this.computeCount += 1;
                    return this.counter;
                });
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new UndefinedDepsNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        // Multiple reads in the same reproxy share the cache.
        expect(root.cached).toBe(0);
        expect(root.cached).toBe(0);
        expect(root.cached).toBe(0);
        expect(root.computeCount).toBe(1);

        // A property set reproxies the ReactiveNode → next read recomputes.
        root.counter = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);

        // Repeated reads are cached again until the next reproxy.
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);
    });

    it("uses Object.is for comparisons (NaN equals NaN, signed zeros not equal)", () => {
        class CompareNode extends ReactiveNode {
            public x: number = 0;
            public computeCount = 0;

            get cached(): number {
                return this.memo(
                    "cached",
                    () => {
                        this.computeCount += 1;
                        return this.x;
                    },
                    [this.x]
                );
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new CompareNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        root.x = NaN;
        root.cached;
        const before = root.computeCount;
        root.x = NaN;
        root.cached;
        // NaN compared via Object.is is equal — should NOT recompute.
        expect(root.computeCount).toBe(before);
    });

    it("snapshots the comparisons array (later mutation of the same array does not cause spurious hits)", () => {
        class SnapshotNode extends ReactiveNode {
            public computeCount = 0;
            public sharedDeps: unknown[] = [1];

            get cached(): number {
                return this.memo(
                    "cached",
                    () => {
                        this.computeCount += 1;
                        return this.sharedDeps.length;
                    },
                    this.sharedDeps
                );
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new SnapshotNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(1);

        // Replace the deps array entirely with a different one of the same length.
        root.sharedDeps = [2];
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);
    });

    it("supports multiple memo cells in the same getter via distinct keys", () => {
        class MultiNode extends ReactiveNode {
            public a = 1;
            public b = 1;
            public aCount = 0;
            public bCount = 0;

            get pair(): { a: number; b: number } {
                const a = this.memo(
                    "pair.a",
                    () => {
                        this.aCount += 1;
                        return this.a * 10;
                    },
                    [this.a]
                );
                const b = this.memo(
                    "pair.b",
                    () => {
                        this.bCount += 1;
                        return this.b * 100;
                    },
                    [this.b]
                );
                return { a, b };
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new MultiNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        root.pair;
        expect(root.aCount).toBe(1);
        expect(root.bCount).toBe(1);

        // Change only `a`; `b` cell stays cached.
        root.a = 2;
        const result = root.pair;
        expect(result).toEqual({ a: 20, b: 100 });
        expect(root.aCount).toBe(2);
        expect(root.bCount).toBe(1);
    });

    it("isolates cache per ReactiveNode instance", () => {
        const a = trackRoot(Retree.root(new ListFilterMethod()));
        const b = trackRoot(Retree.root(new ListFilterMethod()));
        Retree.on(a, "nodeChanged", vi.fn());
        Retree.on(b, "nodeChanged", vi.fn());

        a.list.push({ text: "x" });
        a.searchText = "x";
        expect(a.filtered).toEqual([{ text: "x" }]);
        expect(b.filtered).toEqual([]);
        expect(a.computeCount).toBe(1);
        expect(b.computeCount).toBe(1);
    });
});

describe("@memo decorator", () => {
    it("caches by getter name and recomputes when the deps function returns different cells", () => {
        const root = trackRoot(Retree.root(new ListFilterDecorator()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.filtered).toEqual([]);
        expect(root.computeCount).toBe(1);

        root.filtered;
        expect(root.computeCount).toBe(1);

        root.searchText = "match";
        expect(root.filtered).toEqual([]);
        expect(root.computeCount).toBe(2);

        root.list.push({ text: "match" });
        expect(root.filtered).toEqual([{ text: "match" }]);
        expect(root.computeCount).toBe(3);
    });

    it("supports the dynamic-deps form (function captures live `this`)", () => {
        // Sanity check: the decorator's deps function is called every read with the
        // current instance, so it sees mutations made after class declaration.
        class Dyn extends ReactiveNode {
            public toggle = false;
            public a = 1;
            public b = 2;
            public computeCount = 0;

            @memo((self: Dyn) => (self.toggle ? [self.a] : [self.b]))
            get value(): number {
                this.computeCount += 1;
                return this.toggle ? this.a : this.b;
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Dyn()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.value).toBe(2);
        expect(root.computeCount).toBe(1);

        // Changing `a` while toggle=false reads the [b]-shaped deps; no recompute.
        root.a = 99;
        expect(root.value).toBe(2);
        expect(root.computeCount).toBe(1);

        // Flip toggle. Deps shape changes from [b] to [a]; counts as a change.
        root.toggle = true;
        expect(root.value).toBe(99);
        expect(root.computeCount).toBe(2);
    });

    it("with no deps function (undefined comparisons), recomputes once per reproxy", () => {
        class UndefDeps extends ReactiveNode {
            public counter = 0;
            public computeCount = 0;

            @memo()
            get cached(): number {
                this.computeCount += 1;
                return this.counter;
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new UndefDeps()));
        Retree.on(root, "nodeChanged", vi.fn());

        root.cached;
        root.cached;
        root.cached;
        expect(root.computeCount).toBe(1);

        root.counter = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);
    });

    it("returns []-style 'cache forever' when the deps function returns []", () => {
        class Once extends ReactiveNode {
            public counter = 0;
            public computeCount = 0;

            @memo(() => [])
            get cached(): number {
                this.computeCount += 1;
                return this.counter;
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Once()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.cached).toBe(0);
        root.counter = 99;
        expect(root.cached).toBe(0);
        expect(root.computeCount).toBe(1);
    });

    it("isolates cache per instance", () => {
        const a = trackRoot(Retree.root(new ListFilterDecorator()));
        const b = trackRoot(Retree.root(new ListFilterDecorator()));
        Retree.on(a, "nodeChanged", vi.fn());
        Retree.on(b, "nodeChanged", vi.fn());

        a.searchText = "match";
        a.list.push({ text: "match" });
        expect(a.filtered).toEqual([{ text: "match" }]);
        expect(b.filtered).toEqual([]);
        expect(a.computeCount).toBeGreaterThanOrEqual(1);
        expect(b.computeCount).toBe(1);
    });

    it("works with subclassing — derived getter @memo cell is independent of base", () => {
        class Base extends ReactiveNode {
            public x = 1;
            public baseCount = 0;
            @memo((self: Base) => [self.x])
            get computed(): number {
                this.baseCount += 1;
                return this.x * 2;
            }
            get dependencies() {
                return [];
            }
        }
        class Derived extends Base {
            public y = 1;
            public derivedCount = 0;
            @memo((self: Derived) => [self.y])
            get other(): number {
                this.derivedCount += 1;
                return this.y * 3;
            }
        }

        const root = trackRoot(Retree.root(new Derived()));
        Retree.on(root, "nodeChanged", vi.fn());

        root.computed;
        root.other;
        expect(root.baseCount).toBe(1);
        expect(root.derivedCount).toBe(1);

        root.x = 2;
        root.computed;
        root.other;
        expect(root.baseCount).toBe(2);
        expect(root.derivedCount).toBe(1); // y didn't change
    });
});
