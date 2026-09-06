/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactiveNode } from "./ReactiveNode.js";
import { Retree } from "./Retree.js";
import { memo, select } from "./decorators.js";
import { getReproxyNode } from "./internals/reproxy.js";

interface IShape {
    child: { value: number };
    other: number;
}

function makeRoot() {
    return Retree.root<IShape>({ child: { value: 0 }, other: 0 });
}

describe("Retree.version", () => {
    it("advances on the node's own writes and treeVersion on descendant writes", () => {
        const root = makeRoot();
        const childVersion = Retree.version(root.child);
        const rootVersion = Retree.version(root);
        const rootTreeVersion = Retree.treeVersion(root);

        root.child.value = 1;
        expect(Retree.version(root.child)).toBeGreaterThan(childVersion);
        expect(Retree.version(root)).toBe(rootVersion);
        expect(Retree.treeVersion(root)).toBeGreaterThan(rootTreeVersion);

        const afterChild = Retree.version(root.child);
        root.other = 1;
        expect(Retree.version(root.child)).toBe(afterChild);
        expect(Retree.version(root)).toBeGreaterThan(rootVersion);
    });

    it("agrees with the view identity and accepts the raw object", () => {
        const root = makeRoot();
        const version = Retree.version(root.child);
        expect(Retree.version(Retree.raw(root.child))).toBe(version);
        const view = getReproxyNode(root.child);

        root.other = 1;
        expect(getReproxyNode(root.child)).toBe(view);
        expect(Retree.version(root.child)).toBe(version);

        root.child.value = 1;
        expect(getReproxyNode(root.child)).not.toBe(view);
        expect(Retree.version(root.child)).not.toBe(version);
        expect(Retree.version(view)).toBe(Retree.version(root.child));
    });

    it("follows runSilent's reproxy mode", () => {
        const root = makeRoot();
        const version = Retree.version(root.child);
        const treeVersion = Retree.treeVersion(root);
        Retree.runSilent(() => {
            root.child.value = 1;
        });
        expect(Retree.version(root.child)).toBe(version);
        expect(Retree.treeVersion(root)).toBe(treeVersion);
        Retree.runSilent(() => {
            root.child.value = 2;
        }, false);
        expect(Retree.version(root.child)).toBeGreaterThan(version);
        expect(Retree.treeVersion(root)).toBeGreaterThan(treeVersion);
    });

    it("throws for values that are not Retree nodes", () => {
        expect(() => Retree.version({})).toThrow(
            "Retree.version: expected a Retree-managed node or the raw object behind one, but the value has never been materialized as a Retree node."
        );
        expect(() => Retree.treeVersion(null as unknown as object)).toThrow(
            "Retree.treeVersion: expected a Retree-managed node or the raw object behind one but received a object."
        );
    });
});

describe("tracked version reads", () => {
    interface IBook {
        title: string;
        tags: string[];
    }
    class Library extends ReactiveNode {
        public books: IBook[] = [{ title: "a", tags: ["x"] }];
        public other = 0;
        public keyRuns = 0;
        public treeKeyRuns = 0;
        public computeCount = 0;
        get dependencies() {
            return [];
        }
        @memo((self: Library) => {
            self.keyRuns++;
            return [Retree.version(self.books)];
        })
        get bookCount(): number {
            this.computeCount++;
            return this.books.length;
        }
        @memo((self: Library) => {
            self.treeKeyRuns++;
            return [Retree.treeVersion(self.books)];
        })
        get tagCount(): number {
            let count = 0;
            for (const book of this.books) count += book.tags.length;
            return count;
        }
        @select
        get booksTreeVersion(): number {
            return Retree.treeVersion(this.books);
        }
    }
    const roots: object[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) Retree.clearListeners(root);
    });
    function makeLibrary(): Library {
        const root = Retree.root(new Library());
        roots.push(root);
        return root;
    }

    it("validates a memo key on Retree.version against the node's own writes", () => {
        const root = makeLibrary();
        expect(root.bookCount).toBe(1);
        expect(root.bookCount).toBe(1);
        root.other++;
        expect(root.bookCount).toBe(1);
        expect(root.keyRuns).toBe(1);
        root.books[0].tags.push("y");
        expect(root.bookCount).toBe(1);
        expect(root.keyRuns).toBe(1);
        root.books.push({ title: "b", tags: [] });
        expect(root.bookCount).toBe(2);
        expect(root.keyRuns).toBe(2);
        expect(root.computeCount).toBe(2);
    });

    it("validates a memo key on Retree.treeVersion against descendant writes", () => {
        const root = makeLibrary();
        expect(root.tagCount).toBe(1);
        expect(root.tagCount).toBe(1);
        root.other++;
        expect(root.tagCount).toBe(1);
        expect(root.treeKeyRuns).toBe(1);
        root.books[0].tags.push("y");
        expect(root.tagCount).toBe(2);
        expect(root.treeKeyRuns).toBe(2);
        expect(root.tagCount).toBe(2);
        expect(root.treeKeyRuns).toBe(2);
    });

    it("re-runs a tracked selector and effect on writes under a tree version read", () => {
        const root = makeRoot();
        const selected: number[] = [];
        const stopSelect = Retree.select(
            () => Retree.treeVersion(root.child),
            (version) => selected.push(version)
        );
        let effectRuns = 0;
        const stopEffect = Retree.effect(() => {
            effectRuns++;
            Retree.treeVersion(root.child);
        });
        expect(effectRuns).toBe(1);
        root.other = 1;
        expect(selected).toEqual([]);
        expect(effectRuns).toBe(1);
        root.child.value = 1;
        expect(selected).toHaveLength(1);
        expect(effectRuns).toBe(2);
        stopSelect();
        stopEffect();
    });

    it("re-runs a tracked selector for a node it never read beneath a tree version read", () => {
        const root = Retree.root<{ rows: { cells: { value: number }[] }[] }>({
            rows: [{ cells: [{ value: 0 }] }],
        });
        roots.push(root);
        const selected: number[] = [];
        const stop = Retree.select(
            () => Retree.treeVersion(root.rows),
            (version) => selected.push(version)
        );
        root.rows[0].cells[0].value = 1;
        expect(selected).toHaveLength(1);
        stop();
    });

    it("re-runs a @select getter on writes under a tree version read", () => {
        const root = Retree.root({
            library: new Library(),
            unrelated: { count: 0 },
        });
        roots.push(root);
        const library = root.library;
        const initial = library.booksTreeVersion;
        const changed = vi.fn();
        Retree.on(library, "nodeChanged", changed);
        root.unrelated.count++;
        expect(changed).not.toHaveBeenCalled();
        library.books[0].tags.push("y");
        expect(changed).toHaveBeenCalledTimes(1);
        expect(root.library.booksTreeVersion).toBeGreaterThan(initial);
        root.library.books.push({ title: "b", tags: [] });
        expect(changed).toHaveBeenCalledTimes(2);
    });
});
