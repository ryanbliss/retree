/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createUndoHistory } from "./undoHistory.js";
import { Retree } from "./Retree.js";
import { ReactiveNode, ignore } from "./index.js";
import { INodeFieldChanges } from "./types.js";
import { getCustomProxyHandler } from "./internals/proxy.js";

const rootsToCleanup: object[] = [];
const historiesToCleanup: { dispose(): void }[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

function trackHistory<T extends { dispose(): void }>(history: T): T {
    historiesToCleanup.push(history);
    return history;
}

afterEach(() => {
    for (const history of historiesToCleanup.splice(0)) {
        history.dispose();
    }
    for (const root of rootsToCleanup.splice(0)) {
        clearListenersRecursively(root);
    }
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

describe("createUndoHistory", () => {
    it("undoes and redoes object writes step by step", () => {
        const root = trackRoot(Retree.root({ count: 0, label: "a" }));
        const history = trackHistory(createUndoHistory(root));

        root.count = 1;
        root.label = "b";
        expect(history.canUndo).toBe(true);
        expect(history.canRedo).toBe(false);

        expect(history.undo()).toBe(true);
        expect(root.label).toBe("a");
        expect(root.count).toBe(1);

        expect(history.undo()).toBe(true);
        expect(root.count).toBe(0);
        expect(history.canUndo).toBe(false);

        expect(history.redo()).toBe(true);
        expect(root.count).toBe(1);
        expect(history.redo()).toBe(true);
        expect(root.label).toBe("b");
        expect(history.canRedo).toBe(false);
    });

    it("returns false when there is nothing to undo or redo", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root));

        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);
    });

    it("undoes and redoes array push and splice", () => {
        const root = trackRoot(
            Retree.root({ tasks: [{ title: "a" }, { title: "b" }] })
        );
        const history = trackHistory(createUndoHistory(root));

        root.tasks.push({ title: "c" });
        root.tasks.splice(0, 1);
        expect(root.tasks.map((t) => t.title)).toEqual(["b", "c"]);

        history.undo();
        expect(root.tasks.map((t) => t.title)).toEqual(["a", "b", "c"]);
        history.undo();
        expect(root.tasks.map((t) => t.title)).toEqual(["a", "b"]);

        history.redo();
        expect(root.tasks.map((t) => t.title)).toEqual(["a", "b", "c"]);
        history.redo();
        expect(root.tasks.map((t) => t.title)).toEqual(["b", "c"]);
    });

    it("undoes and redoes Map and Set mutations", () => {
        const root = trackRoot(
            Retree.root({
                map: new Map<string, number>(),
                set: new Set<string>(),
            })
        );
        const history = trackHistory(createUndoHistory(root));

        root.map.set("a", 1);
        root.set.add("x");

        history.undo();
        expect(root.set.size).toBe(0);
        history.undo();
        expect(root.map.size).toBe(0);

        history.redo();
        expect(root.map.get("a")).toBe(1);
        history.redo();
        expect(root.set.has("x")).toBe(true);
    });

    it("records nested node writes", () => {
        const root = trackRoot(Retree.root({ child: { inner: { value: 1 } } }));
        const history = trackHistory(createUndoHistory(root));

        root.child.inner.value = 2;
        root.child.inner.value = 3;

        history.undo();
        expect(root.child.inner.value).toBe(2);
        history.undo();
        expect(root.child.inner.value).toBe(1);
        history.redo();
        expect(root.child.inner.value).toBe(2);
    });

    it("coalesces one transaction into one step", () => {
        const root = trackRoot(
            Retree.root({ count: 0, list: [1], child: { v: 0 } })
        );
        const history = trackHistory(createUndoHistory(root));

        Retree.runTransaction(() => {
            root.count = 1;
            root.list.push(2);
            root.child.v = 5;
        });

        expect(history.undo()).toBe(true);
        expect(root.count).toBe(0);
        expect(Retree.raw(root.list)).toEqual([1]);
        expect(root.child.v).toBe(0);
        expect(history.canUndo).toBe(false);

        expect(history.redo()).toBe(true);
        expect(root.count).toBe(1);
        expect(Retree.raw(root.list)).toEqual([1, 2]);
        expect(root.child.v).toBe(5);
    });

    it("treats separate transactions as separate steps", () => {
        const root = trackRoot(Retree.root({ a: 0, b: 0 }));
        const history = trackHistory(createUndoHistory(root));

        Retree.runTransaction(() => {
            root.a = 1;
        });
        Retree.runTransaction(() => {
            root.b = 1;
        });

        history.undo();
        expect(root.b).toBe(0);
        expect(root.a).toBe(1);
        history.undo();
        expect(root.a).toBe(0);
    });

    it("emits to listeners during undo (re-render) without recording the undo", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root));
        const nodeChanged = vi.fn();
        Retree.on(root, "nodeChanged", nodeChanged);

        root.count = 1;
        expect(nodeChanged).toHaveBeenCalledTimes(1);

        history.undo();
        // The undo write emitted like any user write...
        expect(nodeChanged).toHaveBeenCalledTimes(2);
        // ...but was not recorded as a new step.
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(true);
    });

    it("truncates the redo stack when a new write lands after undo", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root));

        root.count = 1;
        root.count = 2;
        history.undo();
        expect(history.canRedo).toBe(true);

        root.count = 99;
        expect(history.canRedo).toBe(false);

        history.undo();
        expect(root.count).toBe(1);
        history.redo();
        expect(root.count).toBe(99);
    });

    it("drops the oldest steps beyond the limit", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root, { limit: 2 }));

        root.count = 1;
        root.count = 2;
        root.count = 3;

        expect(history.undo()).toBe(true);
        expect(root.count).toBe(2);
        expect(history.undo()).toBe(true);
        expect(root.count).toBe(1);
        // The count=1 step was dropped by the limit.
        expect(history.undo()).toBe(false);
        expect(root.count).toBe(1);
    });

    it("throws a pinpointed error for an invalid limit", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        expect(() => createUndoHistory(root, { limit: 0 })).toThrow(
            /createUndoHistory: expected options\.limit to be an integer of at least 1/
        );
    });

    it("merges discrete writes when coalesce returns true", () => {
        const root = trackRoot(Retree.root({ text: "" }));
        const history = trackHistory(
            createUndoHistory(root, {
                coalesce: (previous, next) =>
                    previous.every((record) => record.key === "text") &&
                    next.every((record) => record.key === "text"),
            })
        );

        root.text = "h";
        root.text = "he";
        root.text = "hey";

        expect(history.undo()).toBe(true);
        expect(root.text).toBe("");
        expect(history.canUndo).toBe(false);

        expect(history.redo()).toBe(true);
        expect(root.text).toBe("hey");
    });

    it("clear() drops both stacks without touching state", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root));

        root.count = 1;
        root.count = 2;
        history.undo();
        history.clear();

        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(root.count).toBe(1);
    });

    it("dispose() stops recording", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = createUndoHistory(root);

        root.count = 1;
        history.dispose();
        root.count = 2;

        expect(history.canUndo).toBe(false);
        expect(history.undo()).toBe(false);
        expect(root.count).toBe(2);
        // Idempotent.
        history.dispose();
    });

    it("does not double-apply records forwarded by a ReactiveNode whose dependency is in the tree", () => {
        class Watcher extends ReactiveNode {
            public source = { count: 0 };
            @ignore
            public seen: INodeFieldChanges[] = [];

            get dependencies() {
                return [this.dependency(this.source)];
            }
        }
        const root = trackRoot(Retree.root({ watcher: new Watcher() }));
        const history = trackHistory(createUndoHistory(root));
        // A treeChanged listener anywhere plus the ReactiveNode dependency
        // makes the same records reach the root through two paths.
        root.watcher.source.count = 1;
        root.watcher.source.count = 2;

        history.undo();
        expect(root.watcher.source.count).toBe(1);
        history.undo();
        expect(root.watcher.source.count).toBe(0);
    });

    it("does not record an undo or redo applied inside a user transaction", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root));

        root.count = 1;
        Retree.runTransaction(() => {
            expect(history.undo()).toBe(true);
        });
        expect(root.count).toBe(0);
        // The undo's writes flushed with the outer transaction, after the
        // applying flag reset; they must not become a new step and must not
        // truncate the redo stack.
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(true);

        Retree.runTransaction(() => {
            expect(history.redo()).toBe(true);
        });
        expect(root.count).toBe(1);
        expect(history.canUndo).toBe(true);
        expect(history.canRedo).toBe(false);
    });

    it("keeps recording writes that land after an in-transaction undo", () => {
        const root = trackRoot(Retree.root({ count: 0 }));
        const history = trackHistory(createUndoHistory(root));

        root.count = 1;
        Retree.runTransaction(() => {
            history.undo();
        });

        // The skipped flush is exactly one flush wide: later writes record.
        root.count = 5;
        expect(history.canUndo).toBe(true);
        expect(history.canRedo).toBe(false);
        history.undo();
        expect(root.count).toBe(0);
    });

    it("coalesces discrete ReactiveNode field writes like plain-object writes", () => {
        class Editor extends ReactiveNode {
            public text = "";
        }
        const root = trackRoot(Retree.root({ editor: new Editor() }));
        const history = trackHistory(
            createUndoHistory(root, { coalesce: () => true })
        );

        // Retree flushes each of these through an internal transaction; they
        // must still reach the coalesce predicate as discrete writes.
        root.editor.text = "a";
        root.editor.text = "ab";
        root.editor.text = "abc";

        expect(history.undo()).toBe(true);
        expect(root.editor.text).toBe("");
        expect(history.canUndo).toBe(false);

        expect(history.redo()).toBe(true);
        expect(root.editor.text).toBe("abc");
    });

    it("keeps one user transaction one step when it writes ReactiveNode fields", () => {
        class Editor extends ReactiveNode {
            public text = "";
            public title = "";
        }
        const root = trackRoot(Retree.root({ editor: new Editor() }));
        const history = trackHistory(createUndoHistory(root));

        Retree.runTransaction(() => {
            root.editor.text = "body";
            root.editor.title = "heading";
        });

        expect(history.undo()).toBe(true);
        expect(root.editor.text).toBe("");
        expect(root.editor.title).toBe("");
        expect(history.canUndo).toBe(false);
    });

    it("restores Map.clear entries in the original insertion order", () => {
        const root = trackRoot(
            Retree.root({
                map: new Map([
                    ["a", 1],
                    ["b", 2],
                    ["c", 3],
                ]),
            })
        );
        const history = trackHistory(createUndoHistory(root));

        root.map.clear();
        expect(history.undo()).toBe(true);

        expect([...root.map.keys()]).toEqual(["a", "b", "c"]);
    });

    it("restores Set.clear members in the original insertion order", () => {
        const root = trackRoot(Retree.root({ set: new Set(["a", "b", "c"]) }));
        const history = trackHistory(createUndoHistory(root));

        root.set.clear();
        expect(history.undo()).toBe(true);

        expect([...root.set]).toEqual(["a", "b", "c"]);
    });
});
