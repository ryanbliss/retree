import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { fnMemo, ignore, link, memo, select } from "./decorators.js";
import { getUnproxiedNode } from "./internals/index.js";
import { getReproxyNode } from "./internals/reproxy.js";
import { Transactions } from "./internals/transactions.js";

class IgnoredNode extends ReactiveNode {
    @ignore
    public ignored = { count: 0 };
    public count = 0;

    get dependencies() {
        return [];
    }
}

class IgnoredPointerNode extends ReactiveNode {
    public child = { value: 0 };

    @ignore
    public selected: { value: number } | null = null;

    get dependencies() {
        return [];
    }
}

class IgnoredExternalPointerNode extends ReactiveNode {
    @ignore
    public selected: { value: number } | null = null;

    get dependencies() {
        return [];
    }
}

class LinkedPointerNode extends ReactiveNode {
    public child = { value: 0 };

    @link
    public selected: { value: number } | null = null;

    get dependencies() {
        return [];
    }
}

class ConstructorLinkedChildNode extends ReactiveNode {
    @link
    public parent: ConstructorLinkedParentNode;

    constructor(parent: ConstructorLinkedParentNode) {
        super();
        this.parent = parent;
    }

    get dependencies() {
        return [];
    }
}

class ConstructorLinkedParentNode extends ReactiveNode {
    public value = 0;
    public child: ConstructorLinkedChildNode;

    constructor() {
        super();
        this.child = new ConstructorLinkedChildNode(this);
    }

    get dependencies() {
        return [];
    }
}

class AttributeViewNode extends ReactiveNode {
    public attributeId = "a";
    public attributes = [
        { id: "a", value: 0 },
        { id: "b", value: 0 },
    ];

    @memo((self: AttributeViewNode) => [self.attributes, self.attributeId])
    private get _attribute() {
        return this.attributes.find(
            (attribute) => attribute.id === this.attributeId
        );
    }

    @select((self: AttributeViewNode) => [
        self.attributes,
        self.attributeId,
        self._attribute,
    ])
    get attribute() {
        return this._attribute;
    }

    get dependencies() {
        return [];
    }
}

class AttributeViewCustomSelectNode extends ReactiveNode {
    public attributeId = "a";
    public attributes = [
        { id: "a", value: 0 },
        { id: "b", value: 0 },
    ];

    @memo((self: AttributeViewCustomSelectNode) => [
        self.attributes,
        self.attributeId,
    ])
    private get _attribute() {
        return this.attributes.find(
            (attribute) => attribute.id === this.attributeId
        );
    }

    @select((self: AttributeViewCustomSelectNode) => [
        self.attributes,
        self.attributeId,
        self.dependency(self._attribute, [self._attribute?.id]),
    ])
    get attribute() {
        return this._attribute;
    }

    get dependencies() {
        return [];
    }
}

class DynamicSelectNode extends ReactiveNode {
    public includeSecond = false;
    public first = { value: 0 };
    public second = { value: 0 };

    @select((self: DynamicSelectNode) =>
        self.includeSecond ? [self.first, self.second] : [self.first]
    )
    get total() {
        return this.first.value + (this.includeSecond ? this.second.value : 0);
    }

    get dependencies() {
        return [];
    }
}

class BroadSelectNode extends ReactiveNode {
    public child = { value: 0, label: "initial" };

    @select((self: BroadSelectNode) => self.child)
    get selectedChild() {
        return this.child;
    }

    get dependencies() {
        return [];
    }
}

class SelectOptionsNode extends ReactiveNode {
    public output = { foo: "same", bar: 0 };

    @select({
        equals: (self, previous, next) => {
            expect(self).toBeInstanceOf(SelectOptionsNode);
            const previousFoo: string = previous.foo;
            const nextFoo: string = next.foo;
            return previousFoo === nextFoo;
        },
    })
    get selectedOutput() {
        return {
            foo: this.output.foo,
            bar: this.output.bar,
        };
    }

    get dependencies() {
        return [];
    }
}

class SelectOptionsWithDependenciesNode extends ReactiveNode {
    public output = { foo: "same", bar: 0 };

    @select((self: SelectOptionsWithDependenciesNode) => self.output, {
        equals: (self, previous, next) => {
            expect(self).toBeInstanceOf(SelectOptionsWithDependenciesNode);
            const previousFoo: string = previous.foo;
            const nextFoo: string = next.foo;
            return previousFoo === nextFoo;
        },
    })
    get selectedOutput() {
        return {
            foo: this.output.foo,
            bar: this.output.bar,
        };
    }

    get dependencies() {
        return [];
    }
}

class SelectSkipsOutputWhenDependenciesAreUnchangedNode extends ReactiveNode {
    @ignore
    public outputReadCount = 0;
    public source = { flag: true, noise: 0 };

    @select(
        (self: SelectSkipsOutputWhenDependenciesAreUnchangedNode) =>
            self.dependency(self.source, [self.source.flag]),
        {
            equals: (_self, previous, next) => previous.flag === next.flag,
        }
    )
    get selectedOutput() {
        this.outputReadCount++;
        return {
            flag: this.source.flag,
        };
    }

    get dependencies() {
        return [];
    }
}

class AutoSelectTotalNode extends ReactiveNode {
    public price = { value: 2 };
    public amount = { value: 3 };
    public note = { value: "ignored" };

    @select()
    get total() {
        return this.price.value * this.amount.value;
    }

    get dependencies() {
        return [];
    }
}

class BareAutoSelectTotalNode extends ReactiveNode {
    public price = { value: 2 };
    public amount = { value: 3 };
    public note = { value: "ignored" };

    @select
    get total() {
        return this.price.value * this.amount.value;
    }

    get dependencies() {
        return [];
    }
}

class AutoSelectTaskRowNode extends ReactiveNode {
    @link
    public task: { isCompleted: boolean; text: string };

    constructor(task: { isCompleted: boolean; text: string }) {
        super();
        this.task = task;
    }

    @select()
    get isVisible() {
        return !this.task.isCompleted;
    }

    get dependencies() {
        return [];
    }
}

interface FilteredTask {
    isCompleted: boolean;
    text: string;
}

class AutoSelectTaskListNode extends ReactiveNode {
    public filters = { isCompleted: null as boolean | null };
    public allTasks: FilteredTask[] = [
        { isCompleted: false, text: "Write docs" },
        { isCompleted: true, text: "Ship release" },
    ];

    @select()
    public get tasks(): FilteredTask[] {
        return this.allTasks.filter(
            (task) =>
                this.filters.isCompleted === null ||
                task.isCompleted === this.filters.isCompleted
        );
    }

    get dependencies() {
        return [];
    }
}

let scanBoardGetterRuns = 0;

class ScanBoardNode extends ReactiveNode {
    public items = [
        { name: "a", score: 1 },
        { name: "b", score: 2 },
        { name: "c", score: 3 },
    ];

    @select()
    get total(): number {
        scanBoardGetterRuns++;
        let total = 0;
        for (const item of this.items) {
            total += item.score;
        }
        return total;
    }

    get dependencies() {
        return [];
    }
}

class OrderedSelectNode extends ReactiveNode {
    public first = { value: 0 };
    public second = { value: 0 };

    @select((self: OrderedSelectNode) => [self.first, self.second.value])
    get summary(): string {
        return `${this.first.value}:${this.second.value}`;
    }

    get dependencies() {
        return [];
    }
}

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(node: T): T {
    rootsToCleanup.push(node);
    return node;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        Retree.clearListeners(root, false);
    }
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

describe("ignore", () => {
    it("skips Retree listener emission for ignored nested objects", () => {
        const root = trackRoot(Retree.root(new IgnoredNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.ignored.count += 1;
        root.count += 1;

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.ignored.count).toBe(1);
    });

    it("does not emit when an ignored field is set to a proxied node", () => {
        const state = trackRoot(Retree.root(new IgnoredPointerNode()));
        const nodeChanged = vi.fn();
        Retree.on(state, "nodeChanged", nodeChanged);

        state.selected = state.child;

        expect(nodeChanged).not.toHaveBeenCalled();
    });

    it("does not reparent a proxied node stored in an ignored field", () => {
        const source = trackRoot(Retree.root({ child: { value: 0 } }));
        const owner = trackRoot(Retree.root(new IgnoredExternalPointerNode()));

        owner.selected = source.child;

        if (!owner.selected) {
            throw new Error(
                "Expected ignored field to store the selected source child."
            );
        }
        expect(Retree.parent(owner.selected)).toBe(source);
    });

    it("returns the latest reproxy for a proxied node stored in an ignored field", () => {
        const state = trackRoot(Retree.root(new IgnoredPointerNode()));
        state.selected = state.child;

        const selectedBeforeChange = state.selected;
        if (!selectedBeforeChange) {
            throw new Error(
                "Expected ignored field to return the selected child before mutation."
            );
        }

        state.child.value = 1;

        const selectedAfterChange = state.selected;
        if (!selectedAfterChange) {
            throw new Error(
                "Expected ignored field to return the selected child after mutation."
            );
        }
        expect(selectedAfterChange).not.toBe(selectedBeforeChange);
        expect(selectedAfterChange.value).toBe(1);
    });
});

describe("link", () => {
    it("emits when a linked field is set to a proxied node", () => {
        const state = trackRoot(Retree.root(new LinkedPointerNode()));
        const nodeChanged = vi.fn();
        Retree.on(state, "nodeChanged", nodeChanged);

        state.selected = state.child;

        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("does not reparent a node stored in a linked field", () => {
        const source = trackRoot(Retree.root({ child: { value: 0 } }));
        const owner = trackRoot(Retree.root(new LinkedPointerNode()));

        owner.selected = source.child;

        if (!owner.selected) {
            throw new Error(
                "Expected linked field to store the selected source child."
            );
        }
        expect(Retree.parent(owner.selected)).toBe(source);
    });

    it("returns the latest reproxy for a linked field", () => {
        const state = trackRoot(Retree.root(new LinkedPointerNode()));
        state.selected = state.child;

        const selectedBeforeChange = state.selected;
        if (!selectedBeforeChange) {
            throw new Error(
                "Expected linked field to return the selected child before mutation."
            );
        }

        state.child.value = 1;

        const selectedAfterChange = state.selected;
        if (!selectedAfterChange) {
            throw new Error(
                "Expected linked field to return the selected child after mutation."
            );
        }
        expect(selectedAfterChange).not.toBe(selectedBeforeChange);
        expect(selectedAfterChange.value).toBe(1);
    });

    it("resolves a raw constructor-time self reference to the managed parent proxy", () => {
        const state = trackRoot(Retree.root(new ConstructorLinkedParentNode()));

        expect(getUnproxiedNode(state.child.parent)).toBe(
            getUnproxiedNode(state)
        );
    });

    it("returns the latest reproxy for a raw constructor-time linked parent", () => {
        const state = trackRoot(Retree.root(new ConstructorLinkedParentNode()));
        const parentBeforeChange = state.child.parent;

        state.value = 1;

        expect(state.child.parent).not.toBe(parentBeforeChange);
        expect(state.child.parent.value).toBe(1);
    });

    it("allows assigning a raw object to @link after that object belongs to a Retree tree", () => {
        const rawChild = { value: 0 };
        const source = trackRoot(Retree.root({ child: rawChild }));
        const owner = trackRoot(Retree.root(new LinkedPointerNode()));

        expect(source.child).toBeDefined();
        owner.selected = rawChild;
        const selectedBeforeChange = owner.selected;

        source.child.value = 1;

        expect(owner.selected).not.toBe(selectedBeforeChange);
        expect(owner.selected?.value).toBe(1);
        expect(getUnproxiedNode(owner.selected)).toBe(
            getUnproxiedNode(source.child)
        );
    });
});

describe("select", () => {
    it("emits the owner node when selected dependencies change", () => {
        const root = trackRoot(Retree.root(new AttributeViewNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.attributes.push({ id: "c", value: 0 });
        root.attributes[1].value = 1;

        expect(nodeChanged).not.toHaveBeenCalled();

        root.attributes[0].value = 1;
        root.attributeId = "b";

        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(root.attribute?.id).toBe("b");
    });

    it("accepts explicit dependency slots for custom @select comparisons", () => {
        const root = trackRoot(
            Retree.root(new AttributeViewCustomSelectNode())
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.attributes[0].value = 1;

        expect(nodeChanged).not.toHaveBeenCalled();

        root.attributeId = "b";

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.attribute?.id).toBe("b");
    });

    it("allows @select dependency list length changes independently", () => {
        const root = trackRoot(Retree.root(new DynamicSelectNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.second.value = 1;
        expect(nodeChanged).not.toHaveBeenCalled();

        root.includeSecond = true;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.total).toBe(1);

        root.second.value = 2;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
    });

    it("reproxies the owner when an explicit @select dependency changes", () => {
        const root = trackRoot(Retree.root(new BroadSelectNode()));
        Retree.on(root, "nodeChanged", vi.fn());
        const beforeChange = getReproxyNode(root);

        root.child.label = "updated";

        expect(getReproxyNode(root)).not.toBe(beforeChange);
    });

    it("uses custom equals for automatic @select output comparisons", () => {
        const root = trackRoot(Retree.root(new SelectOptionsNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        const beforeBarChange = getReproxyNode(root);

        expect(root.selectedOutput).toEqual({ foo: "same", bar: 0 });

        root.output.bar = 1;

        expect(nodeChanged).not.toHaveBeenCalled();
        expect(getReproxyNode(root)).toBe(beforeBarChange);
        expect(root.selectedOutput).toEqual({ foo: "same", bar: 1 });

        root.output.foo = "changed";

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).not.toBe(beforeBarChange);
        expect(root.selectedOutput).toEqual({ foo: "changed", bar: 1 });
    });

    it("uses custom equals with explicit @select dependencies", () => {
        const root = trackRoot(
            Retree.root(new SelectOptionsWithDependenciesNode())
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        const beforeBarChange = getReproxyNode(root);

        expect(root.selectedOutput).toEqual({ foo: "same", bar: 0 });

        root.output.bar = 1;

        expect(nodeChanged).not.toHaveBeenCalled();
        expect(getReproxyNode(root)).toBe(beforeBarChange);
        expect(root.selectedOutput).toEqual({ foo: "same", bar: 1 });

        root.output.foo = "changed";

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).not.toBe(beforeBarChange);
        expect(root.selectedOutput).toEqual({ foo: "changed", bar: 1 });
    });

    it("does not run select output equality when dependency comparisons are unchanged", () => {
        const root = trackRoot(
            Retree.root(new SelectSkipsOutputWhenDependenciesAreUnchangedNode())
        );
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        root.outputReadCount = 0;

        root.source.noise = 1;

        expect(root.outputReadCount).toBe(0);
        expect(nodeChanged).not.toHaveBeenCalled();

        root.source.flag = false;

        expect(root.outputReadCount).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("captures accessed Retree nodes when @select is called without a selector", () => {
        const root = trackRoot(Retree.root(new AutoSelectTotalNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        const beforeChange = getReproxyNode(root);

        root.note.value = "still ignored";
        expect(nodeChanged).not.toHaveBeenCalled();

        root.price.value = 4;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(root)).not.toBe(beforeChange);
        expect(root.total).toBe(12);

        root.amount.value = 5;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(root.total).toBe(20);
    });

    it("captures accessed Retree nodes when @select is used without parentheses", () => {
        const root = trackRoot(Retree.root(new BareAutoSelectTotalNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.note.value = "still ignored";
        expect(nodeChanged).not.toHaveBeenCalled();

        root.price.value = 4;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.total).toBe(12);

        root.amount.value = 5;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(root.total).toBe(20);
    });

    it("captures primitive reads as comparisons for @select without a selector", () => {
        const source = trackRoot(
            Retree.root({
                task: {
                    isCompleted: false,
                    text: "Write docs",
                },
            })
        );
        const row = trackRoot(
            Retree.root(new AutoSelectTaskRowNode(source.task))
        );
        const nodeChanged = vi.fn();
        Retree.on(row, "nodeChanged", nodeChanged);
        const beforeChange = getReproxyNode(row);

        source.task.text = "Write better docs";
        expect(nodeChanged).not.toHaveBeenCalled();

        source.task.isCompleted = true;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(getReproxyNode(row)).not.toBe(beforeChange);
        expect(row.isVisible).toBe(false);
    });

    it("narrows trapped object reads to accessed fields while preserving list slot identity", () => {
        const root = trackRoot(Retree.root(new AutoSelectTaskListNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.allTasks[0].text = "Write even better docs";
        expect(nodeChanged).not.toHaveBeenCalled();

        root.allTasks[0].isCompleted = true;
        expect(nodeChanged).not.toHaveBeenCalled();

        root.allTasks[0] = {
            isCompleted: false,
            text: "Fresh task object",
        };
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.tasks.map((task) => task.text)).toEqual([
            "Fresh task object",
            "Ship release",
        ]);

        root.filters.isCompleted = false;
        expect(nodeChanged).toHaveBeenCalledTimes(2);
        expect(root.tasks.map((task) => task.text)).toEqual([
            "Fresh task object",
        ]);

        root.allTasks[0].text = "Write best docs";
        expect(nodeChanged).toHaveBeenCalledTimes(2);

        root.allTasks[0].isCompleted = true;
        expect(nodeChanged).toHaveBeenCalledTimes(3);
        expect(root.tasks).toEqual([]);

        root.allTasks[0] = {
            isCompleted: false,
            text: "Fresh task object",
        };
        expect(nodeChanged).toHaveBeenCalledTimes(4);
        expect(root.tasks.map((task) => task.text)).toEqual([
            "Fresh task object",
        ]);
    });

    it("skips trapped @select dependency collection for writes to unread fields", () => {
        const root = trackRoot(Retree.root(new ScanBoardNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);
        expect(root.total).toBe(6);

        const runsBeforeUnrelated = scanBoardGetterRuns;
        root.items[1].name = "renamed";

        expect(nodeChanged).not.toHaveBeenCalled();
        expect(scanBoardGetterRuns).toBe(runsBeforeUnrelated);

        root.items[1].score = 10;

        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(scanBoardGetterRuns).toBeGreaterThan(runsBeforeUnrelated);
        expect(root.total).toBe(14);
    });

    it("compares trailing dependency values when an earlier @select dependency emits", () => {
        const root = trackRoot(Retree.root(new OrderedSelectNode()));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        // `first` changed, but the trailing comparison window
        // (`second.value`) is unchanged.
        root.first.value = 1;
        expect(nodeChanged).not.toHaveBeenCalled();

        // Primitive-only dependencies have no subscription of their own.
        root.second.value = 5;
        expect(nodeChanged).not.toHaveBeenCalled();

        // Now `first` emits and the trailing window differs (0 -> 5).
        root.first.value = 2;
        expect(nodeChanged).toHaveBeenCalledTimes(1);
        expect(root.summary).toBe("2:5");
    });
});

describe("legacy decorator transpilation detection", () => {
    /**
     * Simulates what TypeScript's `experimentalDecorators` / Babel's legacy
     * decorator transform actually calls at runtime: `(target, propertyKey,
     * descriptor)` — reproduced July 2026 inside Sandpack's react-ts
     * template. The cast is deliberate: the whole point is calling the
     * decorator with the wrong (legacy) shape.
     */
    type LegacyDecoratorCall = (
        target: object,
        propertyKey: string,
        descriptor?: PropertyDescriptor
    ) => unknown;

    function asLegacyCall(decorator: unknown): LegacyDecoratorCall {
        return decorator as LegacyDecoratorCall;
    }

    const prototype = {};
    const getterDescriptor: PropertyDescriptor = {
        get: () => 1,
        configurable: true,
        enumerable: false,
    };
    const methodDescriptor: PropertyDescriptor = {
        value: () => 1,
        configurable: true,
        enumerable: false,
        writable: true,
    };

    it("@memo names the decorator-config mismatch instead of blaming Retree", () => {
        expect(() =>
            asLegacyCall(memo)(prototype, "filtered", getterDescriptor)
        ).toThrow(
            '@memo on "filtered" was invoked with legacy decorator semantics'
        );
        expect(() =>
            asLegacyCall(memo)(prototype, "filtered", getterDescriptor)
        ).toThrow('{ "version": "2023-11" }');
    });

    it("@memo(...) factory form detects the legacy shape too", () => {
        expect(() =>
            asLegacyCall(memo())(prototype, "filtered", getterDescriptor)
        ).toThrow(
            '@memo(...) on "filtered" was invoked with legacy decorator semantics'
        );
    });

    it("@select names the decorator-config mismatch", () => {
        expect(() =>
            asLegacyCall(select)(prototype, "doneCount", getterDescriptor)
        ).toThrow(
            '@select on "doneCount" was invoked with legacy decorator semantics'
        );
    });

    it("@select(...) factory form detects the legacy shape too", () => {
        expect(() =>
            asLegacyCall(select(() => []))(
                prototype,
                "doneCount",
                getterDescriptor
            )
        ).toThrow(
            '@select(...) on "doneCount" was invoked with legacy decorator semantics'
        );
    });

    it("@fnMemo names the decorator-config mismatch", () => {
        expect(() =>
            asLegacyCall(fnMemo)(prototype, "filterBy", methodDescriptor)
        ).toThrow(
            '@fnMemo on "filterBy" was invoked with legacy decorator semantics'
        );
    });

    it("@fnMemo(...) factory form detects the legacy shape too", () => {
        expect(() =>
            asLegacyCall(fnMemo())(prototype, "filterBy", methodDescriptor)
        ).toThrow(
            '@fnMemo(...) on "filterBy" was invoked with legacy decorator semantics'
        );
    });

    it("@ignore names the decorator-config mismatch", () => {
        expect(() => asLegacyCall(ignore)(prototype, "cache")).toThrow(
            '@ignore on "cache" was invoked with legacy decorator semantics'
        );
    });

    it("@link names the decorator-config mismatch", () => {
        expect(() => asLegacyCall(link)(prototype, "selected")).toThrow(
            '@link on "selected" was invoked with legacy decorator semantics'
        );
    });

    it("keeps the likely-a-Retree-bug error for a 2023-11 context with a non-function target", () => {
        const context = {
            kind: "getter",
            name: "broken",
        } as ClassGetterDecoratorContext<ReactiveNode, unknown>;
        const callMemo = memo as unknown as (
            target: unknown,
            decoratorContext: unknown
        ) => unknown;
        expect(() => callMemo(123, context)).toThrow("likely a Retree bug");
    });
});
