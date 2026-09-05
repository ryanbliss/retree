/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode } from "./ReactiveNode.js";
import { memo, select } from "./decorators.js";

let keyedDependencyRuns = 0;

class Page extends ReactiveNode {
    public counter = 0;
    public a = 1;
    public b = 2;
    public c = 3;
    get dependencies() {
        return [];
    }
    get sum(): number {
        return this.a + this.b;
    }
    @memo((self: Page) => {
        keyedDependencyRuns++;
        return [self.a];
    })
    get keyed(): number {
        return this.a * 10;
    }
    public mode = true;
    @memo((self: Page) => (self.mode ? [self.a] : [self.b]))
    get cond(): number {
        return this.mode ? this.a : this.b;
    }
    @memo
    get trapped(): number {
        return this.c * 10;
    }
    @select()
    get selected(): number {
        return this.b * 2;
    }
    @select((self: Page) => [self.a])
    get selectedByKey(): number {
        return this.a * 3;
    }
    public useB = false;
    @select()
    get pick(): number {
        return this.useB ? this.b : this.a;
    }
    @select()
    get outer(): number {
        return this.selected + 1;
    }
    get viaKeylessMemo(): number {
        return this.memo(() => this.c + 1, [this.c]);
    }
}

function observe<T>(selector: (page: Page) => T) {
    const page = Retree.root(new Page());
    let runs = 0;
    const callback = vi.fn();
    const stop = Retree.select(() => {
        runs++;
        return selector(page);
    }, callback);
    return { page, callback, stop, runs: () => runs };
}

describe("ReactiveNode key scoping", () => {
    it("skips a reader of data fields for writes to other fields", () => {
        const observed = observe((page) => page.a);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.a = 5;
        expect(observed.runs()).toBe(2);
        expect(observed.callback).toHaveBeenCalledWith(5, 1);
        observed.stop();
    });

    it("re-runs a plain getter reader when a backing field changes", () => {
        const observed = observe((page) => page.sum);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.b = 5;
        expect(observed.callback).toHaveBeenCalledWith(6, 3);
        observed.stop();
    });

    it("validates a @memo getter reader through the memo's dependencies", () => {
        const observed = observe((page) => page.keyed);
        const page = observed.page;
        const dependencyRuns = keyedDependencyRuns;
        page.counter++;
        expect(observed.runs()).toBe(1);
        expect(keyedDependencyRuns).toBe(dependencyRuns);
        page.a = 2;
        expect(observed.callback).toHaveBeenCalledWith(20, 10);
        observed.stop();
    });

    it("follows a @memo dependency list whose read set changed without changing the value", () => {
        const observed = observe((page) => page.cond);
        const page = observed.page;
        page.b = 1;
        expect(observed.runs()).toBe(1);
        page.mode = false;
        expect(observed.runs()).toBe(2);
        page.b = 7;
        expect(observed.callback).toHaveBeenLastCalledWith(7, 1);
        observed.stop();
    });

    it("validates an auto-trapped @memo getter reader through its trapped reads", () => {
        const observed = observe((page) => page.trapped);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.c = 4;
        expect(observed.callback).toHaveBeenCalledWith(40, 30);
        observed.stop();
    });

    it("validates an explicit-dependency @select getter reader through its dependencies", () => {
        const observed = observe((page) => page.selectedByKey);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.a = 2;
        expect(observed.callback).toHaveBeenCalledWith(6, 3);
        observed.stop();
    });

    it("validates a @select getter reader through the body's reads", () => {
        const observed = observe((page) => page.selected);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.b = 5;
        expect(observed.callback).toHaveBeenCalledWith(10, 4);
        observed.stop();
    });

    it("follows a @select body whose read set changed without changing its value", () => {
        const observed = observe((page) => page.pick);
        const page = observed.page;
        page.b = 1;
        expect(observed.runs()).toBe(1);
        page.useB = true;
        expect(observed.runs()).toBe(1);
        expect(observed.callback).not.toHaveBeenCalled();
        page.b = 7;
        expect(observed.callback).toHaveBeenCalledWith(7, 1);
        observed.stop();
    });

    it("validates a nested @select getter reader through the inner body's reads", () => {
        const observed = observe((page) => page.outer);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.b = 5;
        expect(observed.callback).toHaveBeenCalledWith(11, 5);
        observed.stop();
    });

    it("validates a keyless memo inside a getter through its comparisons", () => {
        const observed = observe((page) => page.viaKeylessMemo);
        const page = observed.page;
        page.counter++;
        expect(observed.runs()).toBe(1);
        page.c = 9;
        expect(observed.callback).toHaveBeenCalledWith(10, 4);
        observed.stop();
    });

    it("skips an effect for writes to fields it never read", () => {
        const page = Retree.root(new Page());
        let runs = 0;
        const stop = Retree.effect(() => {
            runs++;
            void page.a;
        });
        page.counter++;
        expect(runs).toBe(1);
        page.a = 5;
        expect(runs).toBe(2);
        stop();
    });
});
