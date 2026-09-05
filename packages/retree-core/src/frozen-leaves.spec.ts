/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode } from "./ReactiveNode.js";
import { INodeFieldChanges } from "./types.js";

interface IConfig {
    readonly limit: number;
    readonly nested: { readonly flag: boolean };
}

function frozenConfig(limit: number): IConfig {
    return Object.freeze({ limit, nested: Object.freeze({ flag: true }) });
}

interface IShape {
    cfg: IConfig;
    other: number;
    list: IConfig[];
    map: Map<string, IConfig>;
    set: Set<IConfig>;
}

function makeRoot(cfg: IConfig) {
    return Retree.root<IShape>({
        cfg,
        other: 0,
        list: [cfg],
        map: new Map([["a", cfg]]),
        set: new Set([cfg]),
    });
}

describe("frozen objects as immutable leaves", () => {
    it("returns the frozen object itself from every read path", () => {
        const cfg = frozenConfig(1);
        const root = makeRoot(cfg);
        let view = root;
        Retree.on(root, "nodeChanged", (next) => {
            view = next;
        });
        root.other = 1;

        expect(root.cfg).toBe(cfg);
        expect(view.cfg).toBe(cfg);
        expect(root.cfg.nested.flag).toBe(true);
        expect(root.list[0]).toBe(cfg);
        expect(root.map.get("a")).toBe(cfg);
        expect([...root.set][0]).toBe(cfg);
        expect(Retree.managed(cfg)).toBeUndefined();
        expect(Retree.isNode(root.cfg)).toBe(false);
    });

    it("keeps a frozen class instance and a frozen array as leaves", () => {
        class Point {
            constructor(public readonly x: number) {}
        }
        const point = Object.freeze(new Point(1));
        const empty: readonly number[] = Object.freeze([]);
        const root = Retree.root<{
            point: Point;
            empty: readonly number[];
        }>({ point, empty });
        expect(root.point).toBe(point);
        expect(root.empty).toBe(empty);
        root.point = Object.freeze(new Point(2));
        expect(root.point.x).toBe(2);
        expect(Retree.managed(root.point)).toBeUndefined();
    });

    it("re-runs tracked readers when the leaf is replaced and skips sibling writes", () => {
        const root = makeRoot(frozenConfig(1));
        let runs = 0;
        const callback = vi.fn();
        const stop = Retree.select(() => {
            runs++;
            return root.cfg.limit;
        }, callback);
        root.other = 1;
        expect(runs).toBe(1);
        root.cfg = frozenConfig(2);
        expect(callback).toHaveBeenCalledWith(2, 1);
        stop();
    });

    it("emits ordinary change records for leaf replacement", () => {
        const previous = frozenConfig(1);
        const next = frozenConfig(2);
        const root = makeRoot(previous);
        const seen: INodeFieldChanges[] = [];
        Retree.on(root, "nodeChanged", (_, changes) => {
            seen.push(...changes);
        });
        root.cfg = next;
        expect(seen).toEqual([
            { node: Retree.raw(root), key: "cfg", previous, new: next },
        ]);
    });

    it("invalidates a memo keyed on the leaf only when it is replaced", () => {
        class Owner extends ReactiveNode {
            public cfg = frozenConfig(1);
            public other = 0;
            public computeRuns = 0;
            get dependencies() {
                return [];
            }
            get limit(): number {
                return this.memo(() => {
                    this.computeRuns++;
                    return this.cfg.limit;
                }, [this.cfg]);
            }
        }
        const owner = Retree.root(new Owner());
        expect(owner.limit).toBe(1);
        owner.other = 1;
        expect(owner.limit).toBe(1);
        expect(owner.computeRuns).toBe(1);
        owner.cfg = frozenConfig(3);
        expect(owner.limit).toBe(3);
        expect(owner.computeRuns).toBe(2);
    });

    it("rejects a frozen root", () => {
        expect(() => Retree.root(frozenConfig(1))).toThrow(
            "Retree.root: frozen objects are immutable leaves and cannot become a root. Pass a mutable object, or store the frozen object in a field of a mutable root."
        );
    });
});
