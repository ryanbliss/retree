import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode";
import { Retree } from "./Retree";
import { ignore, link, memo, select } from "./decorators";
import { Transactions } from "./internals/transactions";

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
});
