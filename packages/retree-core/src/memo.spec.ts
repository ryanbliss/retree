import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { fnMemo, ignore, link, memo, select } from "./decorators.js";
import { getMemoGetterFramePushCount } from "./internals/memo.js";
import { getReproxyNode } from "./internals/reproxy.js";
import { Transactions } from "./internals/transactions.js";

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

interface Row {
    id: string;
    value: string;
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

    it("with omitted comparisons, traps getter reads as comparisons", () => {
        class UndefinedDepsNode extends ReactiveNode {
            public counter = 0;
            public unrelated = 0;
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

        root.counter = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);

        root.unrelated = 1;
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

    it("with no deps function, traps getter reads as comparisons", () => {
        class UndefDeps extends ReactiveNode {
            public counter = 0;
            public unrelated = 0;
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

        root.unrelated = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);
    });

    it("supports @memo without parentheses as automatic dependency trapping", () => {
        class BareMemoNode extends ReactiveNode {
            public counter = 0;
            public unrelated = 0;
            public computeCount = 0;

            @memo
            get cached(): number {
                this.computeCount += 1;
                return this.counter;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new BareMemoNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.cached).toBe(0);
        expect(root.cached).toBe(0);
        expect(root.computeCount).toBe(1);

        root.unrelated = 1;
        expect(root.cached).toBe(0);
        expect(root.computeCount).toBe(1);

        root.counter = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);
    });

    it("with no deps function, narrows trapped child property reads", () => {
        class ChildPropertyNode extends ReactiveNode {
            public child = { value: 1, label: "initial" };
            public computeCount = 0;

            @memo()
            get doubled(): number {
                this.computeCount += 1;
                return this.child.value * 2;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new ChildPropertyNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.doubled).toBe(2);
        expect(root.doubled).toBe(2);
        expect(root.computeCount).toBe(1);

        root.child.label = "updated";
        expect(root.doubled).toBe(2);
        expect(root.computeCount).toBe(1);

        root.child.value = 2;
        expect(root.doubled).toBe(4);
        expect(root.computeCount).toBe(2);
    });

    it("does not re-read trapped memo property accessors when source reproxies are unchanged", () => {
        let valueReadCount = 0;
        class CountedMemoNode extends ReactiveNode {
            public child = {
                current: 1,
                get value() {
                    valueReadCount++;
                    return this.current;
                },
            };
            @ignore
            public computeCount = 0;

            @memo()
            get doubled(): number {
                this.computeCount++;
                return this.child.value * 2;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new CountedMemoNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.doubled).toBe(2);
        expect(root.doubled).toBe(2);
        expect(root.doubled).toBe(2);
        expect(root.doubled).toBe(2);
        expect(root.computeCount).toBe(1);
        expect(valueReadCount).toBe(3);

        root.child.current = 2;

        expect(root.doubled).toBe(4);
        expect(root.computeCount).toBe(2);
        expect(valueReadCount).toBe(6);

        expect(root.doubled).toBe(4);
        expect(root.doubled).toBe(4);
        expect(valueReadCount).toBe(6);
    });

    it("still emits and reproxies when a @memo getter writes a non-ignored field", () => {
        class SideEffectMemoNode extends ReactiveNode {
            public source = 1;
            public sideEffectCount = 0;

            @memo()
            get doubled(): number {
                this.sideEffectCount += 1;
                return this.source * 2;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new SideEffectMemoNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        const beforeRead = getReproxyNode(root);

        expect(root.doubled).toBe(2);

        expect(root.sideEffectCount).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).not.toBe(beforeRead);
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

    it("can co-exist with a keyless this.memo() call in the same class", () => {
        // Sanity check that the @memo decorator and a keyless this.memo() in a
        // separate getter on the same class don't interfere with each other.
        class Mixed extends ReactiveNode {
            public x = 1;
            public y = 1;
            public xCount = 0;
            public yCount = 0;

            @memo((self: Mixed) => [self.x])
            get viaDecorator(): number {
                this.xCount += 1;
                return this.x * 2;
            }

            get viaMethod(): number {
                return this.memo(() => {
                    this.yCount += 1;
                    return this.y * 3;
                }, [this.y]);
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Mixed()));
        Retree.on(root, "nodeChanged", vi.fn());

        root.viaDecorator;
        root.viaMethod;
        expect(root.xCount).toBe(1);
        expect(root.yCount).toBe(1);

        root.x = 2;
        root.viaDecorator;
        root.viaMethod;
        expect(root.xCount).toBe(2);
        expect(root.yCount).toBe(1);
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

describe("automatic dependency trapping through array lookup", () => {
    class Store extends ReactiveNode {
        public rows: Row[] = [];

        get dependencies() {
            return [this.dependency(this.rows)];
        }

        public byId(id: string): Row | null {
            return this.rows.find((row) => row.id === id) ?? null;
        }

        public replaceRow(next: Row): void {
            const index = this.rows.findIndex((row) => row.id === next.id);
            if (index === -1) {
                this.rows.push(next);
                return;
            }
            this.rows.splice(index, 1, next);
        }

        public removeRow(id: string): void {
            const index = this.rows.findIndex((row) => row.id === id);
            if (index === -1) {
                return;
            }
            this.rows.splice(index, 1);
        }

        public moveRow(id: string, toIndex: number): void {
            const index = this.rows.findIndex((row) => row.id === id);
            if (index === -1) {
                return;
            }
            const [row] = this.rows.splice(index, 1);
            this.rows.splice(toIndex, 0, row);
        }
    }

    class Consumer extends ReactiveNode {
        @link
        public store: Store | null = null;
        public rowId = "";

        get dependencies() {
            return [];
        }

        @memo
        private get _result(): string | null {
            return this.store?.byId(this.rowId)?.value ?? null;
        }

        @select
        public get result(): string | null {
            return this._result;
        }
    }

    function buildLookupTree(rows: Row[] = [{ id: "a", value: "Ada" }]) {
        const root = trackRoot(
            Retree.root({
                store: new Store(),
                consumer: new Consumer(),
            })
        );
        root.store.rows.push(...rows);
        root.consumer.store = root.store;
        root.consumer.rowId = "a";
        return root;
    }

    it("recomputes when the resolved row's field is mutated in place", () => {
        const root = buildLookupTree();
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        const row = root.store.byId("a");
        if (row === null) {
            // @retree-throws
            throw new Error(
                "Test setup failed: expected buildLookupTree() to create row 'a'."
            );
        }
        row.value = "Grace";

        expect(root.consumer.result).toBe("Grace");
        expect(changed).toHaveBeenCalled();
    });

    it("recomputes when the resolved row is replaced via splice", () => {
        const root = buildLookupTree();
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        root.store.replaceRow({ id: "a", value: "Grace" });

        expect(root.consumer.result).toBe("Grace");
        expect(changed).toHaveBeenCalled();
    });

    it("recomputes across multiple separate field edits to the resolved row", () => {
        const root = buildLookupTree();
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        const row = root.store.byId("a");
        if (row === null) {
            // @retree-throws
            throw new Error(
                "Test setup failed: expected buildLookupTree() to create row 'a'."
            );
        }

        row.value = "Grace";
        expect(root.consumer.result).toBe("Grace");
        expect(changed).toHaveBeenCalledTimes(1);

        row.value = "Hopper";
        expect(root.consumer.result).toBe("Hopper");
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("recomputes across multiple separate splice replacements of the resolved row", () => {
        const root = buildLookupTree();
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        root.store.replaceRow({ id: "a", value: "Grace" });
        expect(root.consumer.result).toBe("Grace");
        expect(changed).toHaveBeenCalledTimes(1);

        root.store.replaceRow({ id: "a", value: "Hopper" });
        expect(root.consumer.result).toBe("Hopper");
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("does not emit when an unmatched row field changes before the resolved row", () => {
        const root = buildLookupTree([
            { id: "b", value: "Babbage" },
            { id: "a", value: "Ada" },
        ]);
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        const row = root.store.byId("b");
        if (row === null) {
            // @retree-throws
            throw new Error(
                "Test setup failed: expected buildLookupTree() to create row 'b'."
            );
        }
        row.value = "Byron";

        expect(root.consumer.result).toBe("Ada");
        expect(changed).not.toHaveBeenCalled();
    });

    it("does not re-read cached memo accessors while replaying dependencies for @select", () => {
        let valueReadCount = 0;
        class CountedStore extends ReactiveNode {
            public rows = [
                {
                    id: "a",
                    current: "Ada",
                    get value() {
                        valueReadCount++;
                        return this.current;
                    },
                },
            ];

            get dependencies() {
                return [this.dependency(this.rows)];
            }

            public byId(id: string) {
                return this.rows.find((row) => row.id === id) ?? null;
            }
        }

        class CountedConsumer extends ReactiveNode {
            @link
            public store: CountedStore | null = null;
            public rowId = "a";
            public tick = 0;

            get dependencies() {
                return [];
            }

            @memo
            private get _result(): string | null {
                return this.store?.byId(this.rowId)?.value ?? null;
            }

            @select
            public get result(): string | null {
                return `${this.tick}:${this._result}`;
            }
        }

        const root = trackRoot(
            Retree.root({
                store: new CountedStore(),
                consumer: new CountedConsumer(),
            })
        );
        root.consumer.store = root.store;
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("0:Ada");
        const warmedValueReadCount = valueReadCount;

        root.consumer.tick = 1;

        expect(root.consumer.result).toBe("1:Ada");
        expect(changed).toHaveBeenCalledTimes(1);
        expect(valueReadCount).toBe(warmedValueReadCount);
    });

    it("does not emit when an unmatched row field changes after the resolved row", () => {
        const root = buildLookupTree([
            { id: "a", value: "Ada" },
            { id: "b", value: "Babbage" },
        ]);
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        const row = root.store.byId("b");
        if (row === null) {
            // @retree-throws
            throw new Error(
                "Test setup failed: expected buildLookupTree() to create row 'b'."
            );
        }
        row.value = "Byron";

        expect(root.consumer.result).toBe("Ada");
        expect(changed).not.toHaveBeenCalled();
    });

    it("does not emit when an unmatched row is replaced after the resolved row", () => {
        const root = buildLookupTree([
            { id: "a", value: "Ada" },
            { id: "b", value: "Babbage" },
        ]);
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        root.store.replaceRow({ id: "b", value: "Byron" });

        expect(root.consumer.result).toBe("Ada");
        expect(changed).not.toHaveBeenCalled();
    });

    it("does not emit when an unmatched row is replaced before the resolved row", () => {
        const root = buildLookupTree([
            { id: "b", value: "Babbage" },
            { id: "a", value: "Ada" },
        ]);
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        root.store.replaceRow({ id: "b", value: "Byron" });

        expect(root.consumer.result).toBe("Ada");
        expect(changed).not.toHaveBeenCalled();
    });

    it("does not emit when an unmatched row is spliced out", () => {
        const root = buildLookupTree([
            { id: "b", value: "Babbage" },
            { id: "a", value: "Ada" },
        ]);
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        root.store.removeRow("b");

        expect(root.consumer.result).toBe("Ada");
        expect(changed).not.toHaveBeenCalled();
    });

    it("does not emit when an unmatched row is reordered", () => {
        const root = buildLookupTree([
            { id: "b", value: "Babbage" },
            { id: "a", value: "Ada" },
            { id: "c", value: "Curie" },
        ]);
        const changed = vi.fn();
        Retree.on(root.consumer, "nodeChanged", changed);

        expect(root.consumer.result).toBe("Ada");

        root.store.moveRow("b", 2);

        expect(root.consumer.result).toBe("Ada");
        expect(changed).not.toHaveBeenCalled();
    });
});

describe("@fnMemo decorator", () => {
    it("recomputes when arguments or dependency comparisons change", () => {
        class Scaler extends ReactiveNode {
            public factor = 2;
            public computeCount = 0;

            @fnMemo((self: Scaler) => [self.factor])
            public scale(value: number): number {
                this.computeCount += 1;
                return value * this.factor;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Scaler()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.scale(3)).toBe(6);
        expect(root.scale(3)).toBe(6);
        expect(root.computeCount).toBe(1);

        expect(root.scale(4)).toBe(8);
        expect(root.computeCount).toBe(2);

        root.factor = 3;
        expect(root.scale(4)).toBe(12);
        expect(root.computeCount).toBe(3);
        expect(root.scale(4)).toBe(12);
        expect(root.computeCount).toBe(3);
    });

    it("with no deps function, traps method reads and method arguments as comparisons", () => {
        class Formatter extends ReactiveNode {
            public suffix = "a";
            public unrelated = 0;
            public computeCount = 0;

            @fnMemo()
            public format(value: number): string {
                this.computeCount += 1;
                return `${value}:${this.suffix}`;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Formatter()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.format(1)).toBe("1:a");
        expect(root.format(1)).toBe("1:a");
        expect(root.computeCount).toBe(1);

        expect(root.format(2)).toBe("2:a");
        expect(root.computeCount).toBe(2);
        expect(root.format(2)).toBe("2:a");
        expect(root.computeCount).toBe(2);

        root.unrelated = 1;
        expect(root.format(2)).toBe("2:a");
        expect(root.computeCount).toBe(2);

        root.suffix = "b";
        expect(root.format(2)).toBe("2:b");
        expect(root.computeCount).toBe(3);
    });

    it("supports @fnMemo without parentheses as automatic dependency trapping", () => {
        class BareFnMemoNode extends ReactiveNode {
            public suffix = "a";
            public unrelated = 0;
            public computeCount = 0;

            @fnMemo
            public format(value: number): string {
                this.computeCount += 1;
                return `${value}:${this.suffix}`;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new BareFnMemoNode()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.format(1)).toBe("1:a");
        expect(root.format(1)).toBe("1:a");
        expect(root.computeCount).toBe(1);

        root.unrelated = 1;
        expect(root.format(1)).toBe("1:a");
        expect(root.computeCount).toBe(1);

        expect(root.format(2)).toBe("2:a");
        expect(root.computeCount).toBe(2);

        root.suffix = "b";
        expect(root.format(2)).toBe("2:b");
        expect(root.computeCount).toBe(3);
    });

    it("with no deps function, narrows trapped method child property reads", () => {
        class ChildFormatter extends ReactiveNode {
            public child = { suffix: "a", label: "initial" };
            public computeCount = 0;

            @fnMemo()
            public format(value: number): string {
                this.computeCount += 1;
                return `${value}:${this.child.suffix}`;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new ChildFormatter()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.format(1)).toBe("1:a");
        expect(root.format(1)).toBe("1:a");
        expect(root.computeCount).toBe(1);

        root.child.label = "updated";
        expect(root.format(1)).toBe("1:a");
        expect(root.computeCount).toBe(1);

        expect(root.format(2)).toBe("2:a");
        expect(root.computeCount).toBe(2);

        root.child.suffix = "b";
        expect(root.format(2)).toBe("2:b");
        expect(root.computeCount).toBe(3);
    });

    it("does not re-read trapped fnMemo property accessors when source reproxies are unchanged", () => {
        let suffixReadCount = 0;
        class CountedFormatter extends ReactiveNode {
            public child = {
                current: "a",
                get suffix() {
                    suffixReadCount++;
                    return this.current;
                },
            };
            @ignore
            public computeCount = 0;

            @fnMemo()
            public format(value: number): string {
                this.computeCount++;
                return `${value}:${this.child.suffix}`;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new CountedFormatter()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.format(1)).toBe("1:a");
        expect(root.format(1)).toBe("1:a");
        expect(root.format(1)).toBe("1:a");
        expect(root.format(1)).toBe("1:a");
        expect(root.computeCount).toBe(1);
        expect(suffixReadCount).toBe(3);

        expect(root.format(2)).toBe("2:a");
        expect(root.computeCount).toBe(2);
        expect(suffixReadCount).toBe(5);

        expect(root.format(2)).toBe("2:a");
        expect(root.format(2)).toBe("2:a");
        expect(suffixReadCount).toBe(5);

        root.child.current = "b";

        expect(root.format(2)).toBe("2:b");
        expect(root.computeCount).toBe(3);
        expect(suffixReadCount).toBe(8);
    });

    it("still emits and reproxies when a @fnMemo method writes a non-ignored field", () => {
        class SideEffectFnMemoNode extends ReactiveNode {
            public suffix = "a";
            public sideEffectCount = 0;

            @fnMemo()
            public format(value: number): string {
                this.sideEffectCount += 1;
                return `${value}:${this.suffix}`;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new SideEffectFnMemoNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        const beforeCall = getReproxyNode(root);

        expect(root.format(1)).toBe("1:a");

        expect(root.sideEffectCount).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).not.toBe(beforeCall);
    });

    it("traps nested memo reads while keeping fnMemo writes out of the cache dependencies", () => {
        class MixedSideEffectNode extends ReactiveNode {
            public count1 = 0;
            @ignore
            public count2 = 0;
            @ignore
            public count3ComputeCount = 0;
            @ignore
            public incrementComputeCount = 0;

            @memo()
            get count3(): number {
                this.count3ComputeCount += 1;
                return this.count1 + this.count2;
            }

            @fnMemo()
            public increment(label: string): number {
                this.incrementComputeCount += 1;
                this.count1 += 1;
                this.count2 += 1;
                return this.count3;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new MixedSideEffectNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        expect(root.increment("same")).toBe(2);
        expect(root.count1).toBe(1);
        expect(root.count2).toBe(1);
        expect(root.incrementComputeCount).toBe(1);
        expect(root.count3ComputeCount).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        expect(root.increment("same")).toBe(2);
        expect(root.count1).toBe(1);
        expect(root.count2).toBe(1);
        expect(root.incrementComputeCount).toBe(1);
        expect(root.count3ComputeCount).toBe(1);

        root.count1 = 10;
        expect(root.increment("same")).toBe(13);
        expect(root.count1).toBe(11);
        expect(root.count2).toBe(2);
        expect(root.incrementComputeCount).toBe(2);
        expect(root.count3ComputeCount).toBe(3);
        expect(nodeChanged).toHaveBeenCalledTimes(3);

        root.count2 = 20;
        expect(root.increment("same")).toBe(33);
        expect(root.count1).toBe(12);
        expect(root.count2).toBe(21);
        expect(root.incrementComputeCount).toBe(3);
        expect(root.count3ComputeCount).toBe(5);
        expect(nodeChanged).toHaveBeenCalledTimes(4);

        expect(root.increment("other")).toBe(35);
        expect(root.count1).toBe(13);
        expect(root.count2).toBe(22);
        expect(root.incrementComputeCount).toBe(4);
        expect(root.count3ComputeCount).toBe(6);
        expect(nodeChanged).toHaveBeenCalledTimes(5);
    });

    it("with empty comparisons, recomputes only when arguments change", () => {
        class OncePerArgs extends ReactiveNode {
            public offset = 1;
            public computeCount = 0;

            @fnMemo(() => [])
            public addOffset(value: number): number {
                this.computeCount += 1;
                return value + this.offset;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new OncePerArgs()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.addOffset(4)).toBe(5);
        root.offset = 10;
        expect(root.addOffset(4)).toBe(5);
        expect(root.computeCount).toBe(1);

        expect(root.addOffset(5)).toBe(15);
        expect(root.computeCount).toBe(2);
    });

    it("allows dependency comparisons to read method arguments", () => {
        class ThresholdCounter extends ReactiveNode {
            public values = [1, 2, 3];
            public computeCount = 0;

            @fnMemo((self: ThresholdCounter, minimum: number) => [
                self.values,
                minimum,
            ])
            public countAtLeast(minimum: number): number {
                this.computeCount += 1;
                return this.values.filter((value) => value >= minimum).length;
            }

            get dependencies() {
                return [this.dependency(this.values)];
            }
        }

        const root = trackRoot(Retree.root(new ThresholdCounter()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.countAtLeast(2)).toBe(2);
        expect(root.countAtLeast(2)).toBe(2);
        expect(root.computeCount).toBe(1);

        root.values.push(4);
        expect(root.countAtLeast(2)).toBe(3);
        expect(root.computeCount).toBe(2);
    });

    it("compares tree-node arguments by reproxy identity", () => {
        class ListCounter extends ReactiveNode {
            public list: Card[] = [];
            public computeCount = 0;

            @fnMemo(() => [])
            public countMatching(list: Card[], text: string): number {
                this.computeCount += 1;
                return list.filter((card) => card.text === text).length;
            }

            get dependencies() {
                return [this.dependency(this.list)];
            }
        }

        const root = trackRoot(Retree.root(new ListCounter()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.countMatching(root.list, "match")).toBe(0);
        expect(root.countMatching(root.list, "match")).toBe(0);
        expect(root.computeCount).toBe(1);

        root.list.push({ text: "match" });
        expect(root.countMatching(root.list, "match")).toBe(1);
        expect(root.computeCount).toBe(2);
    });
});

describe("memo (keyless method form)", () => {
    it("derives the cache key from the active getter's name", () => {
        class Keyless extends ReactiveNode {
            public list: Card[] = [];
            public searchText: string = "";
            public computeCount = 0;

            get filtered(): Card[] {
                return this.memo(() => {
                    this.computeCount += 1;
                    return this.list.filter((c) => c.text === this.searchText);
                }, [this.list, this.searchText]);
            }

            get dependencies() {
                return [this.dependency(this.list)];
            }
        }

        const root = trackRoot(Retree.root(new Keyless()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.filtered).toEqual([]);
        expect(root.computeCount).toBe(1);

        // Repeated reads with no change reuse the cache.
        root.filtered;
        root.filtered;
        expect(root.computeCount).toBe(1);

        // Change a comparison, then mutate the list — both should invalidate.
        root.searchText = "match";
        root.filtered;
        root.list.push({ text: "match" });
        expect(root.filtered).toEqual([{ text: "match" }]);
        expect(root.computeCount).toBe(3);
    });

    it("supports omitted comparisons by trapping getter reads", () => {
        class Undef extends ReactiveNode {
            public counter = 0;
            public unrelated = 0;
            public computeCount = 0;

            get cached(): number {
                return this.memo(() => {
                    this.computeCount += 1;
                    return this.counter;
                });
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Undef()));
        Retree.on(root, "nodeChanged", vi.fn());

        root.cached;
        root.cached;
        root.cached;
        expect(root.computeCount).toBe(1);

        root.counter = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);

        root.unrelated = 1;
        expect(root.cached).toBe(1);
        expect(root.computeCount).toBe(2);
    });

    it("supports the empty-deps form (cache forever)", () => {
        class Once extends ReactiveNode {
            public counter = 0;
            public computeCount = 0;

            get cached(): number {
                return this.memo(() => {
                    this.computeCount += 1;
                    return this.counter;
                }, []);
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

    it("uses a separate cache cell for each getter (keyless cells don't collide across getters)", () => {
        class TwoGetters extends ReactiveNode {
            public a = 1;
            public b = 1;
            public aCount = 0;
            public bCount = 0;

            get fromA(): number {
                return this.memo(() => {
                    this.aCount += 1;
                    return this.a * 10;
                }, [this.a]);
            }

            get fromB(): number {
                return this.memo(() => {
                    this.bCount += 1;
                    return this.b * 100;
                }, [this.b]);
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new TwoGetters()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.fromA).toBe(10);
        expect(root.fromB).toBe(100);
        expect(root.aCount).toBe(1);
        expect(root.bCount).toBe(1);

        // Change a; b stays cached.
        root.a = 2;
        expect(root.fromA).toBe(20);
        expect(root.fromB).toBe(100);
        expect(root.aCount).toBe(2);
        expect(root.bCount).toBe(1);
    });

    it("works for nested getters (each getter pushes its own frame)", () => {
        class Nested extends ReactiveNode {
            public x = 1;
            public innerCount = 0;
            public outerCount = 0;

            get inner(): number {
                return this.memo(() => {
                    this.innerCount += 1;
                    return this.x * 10;
                }, [this.x]);
            }

            get outer(): number {
                return this.memo(() => {
                    this.outerCount += 1;
                    // Outer reads inner; both should memoize independently.
                    return this.inner + 1;
                }, [this.x]);
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Nested()));
        Retree.on(root, "nodeChanged", vi.fn());

        expect(root.outer).toBe(11);
        expect(root.innerCount).toBe(1);
        expect(root.outerCount).toBe(1);

        // Repeat read: both stay cached.
        root.outer;
        expect(root.innerCount).toBe(1);
        expect(root.outerCount).toBe(1);

        root.x = 2;
        expect(root.outer).toBe(21);
        expect(root.innerCount).toBe(2);
        expect(root.outerCount).toBe(2);
    });

    it("throws if called outside a getter (e.g. from a method)", () => {
        class FromMethod extends ReactiveNode {
            public callIt(): number {
                return this.memo(() => 42);
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new FromMethod()));
        expect(() => root.callIt()).toThrow(/without a key outside of/i);
    });

    it("throws if called twice in the same getter without explicit keys", () => {
        class Double extends ReactiveNode {
            get bad(): number {
                this.memo(() => 1);
                return this.memo(() => 2);
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Double()));
        expect(() => root.bad).toThrow(/more than once in getter 'bad'/i);
    });

    it("does not leave stale frames after a throwing getter", () => {
        class Throws extends ReactiveNode {
            public shouldThrow = true;
            get bad(): number {
                if (this.shouldThrow) throw new Error("boom");
                return this.memo(() => 1);
            }
            get good(): number {
                return this.memo(() => 99);
            }
            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new Throws()));
        expect(() => root.bad).toThrow("boom");
        // If push/pop weren't balanced, `good`'s memo would inherit `bad`'s frame
        // and either collide or pick up an already-consumed frame.
        expect(root.good).toBe(99);
    });
});

describe("keyless memo getter fast path", () => {
    it("skips memo-getter frame bookkeeping for classes that never use keyless memo", () => {
        class NoKeylessMemo extends ReactiveNode {
            public count = 0;

            get doubled(): number {
                return this.count * 2;
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new NoKeylessMemo()));
        // Warm the read path once (prototype getter-name caches, proxies).
        expect(root.doubled).toBe(0);

        const framesBefore = getMemoGetterFramePushCount();
        for (let i = 0; i < 25; i++) {
            void root.doubled;
        }
        // Read through a reproxy too (reproxy.ts mirrors the fast path).
        const nodeChanged = vi.fn();
        const unsubscribe = Retree.on(root, "nodeChanged", nodeChanged);
        root.count = 1;
        const reproxy = getReproxyNode(root);
        expect(reproxy.doubled).toBe(2);
        unsubscribe();

        expect(getMemoGetterFramePushCount()).toBe(framesBefore);
    });

    it("still answers the first-ever keyless memo call and pushes frames afterwards", () => {
        class FirstCall extends ReactiveNode {
            public counter = 0;
            public computeCount = 0;

            get cached(): number {
                return this.memo(() => {
                    this.computeCount += 1;
                    return this.counter;
                }, [this.counter]);
            }

            get dependencies() {
                return [];
            }
        }

        const root = trackRoot(Retree.root(new FirstCall()));
        // The very first read arrives with the class unmarked: the fast path
        // must recover (mark + re-run with a frame) and return the value.
        expect(root.cached).toBe(0);
        expect(root.computeCount).toBe(1);

        const framesBefore = getMemoGetterFramePushCount();
        expect(root.cached).toBe(0);
        // Marked class: getter reads now push frames again.
        expect(getMemoGetterFramePushCount()).toBeGreaterThan(framesBefore);
        // And the memo cache still holds (no recompute).
        expect(root.computeCount).toBe(1);
    });
});
