import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree";
import { Transactions } from "./internals/transactions";

const rootsToCleanup: object[] = [];

function trackRoot<T extends object>(root: T): T {
    rootsToCleanup.push(root);
    return root;
}

afterEach(() => {
    for (const root of rootsToCleanup.splice(0)) {
        Retree.clearListeners(root as never, false);
    }
    Transactions.skipEmit = false;
    Transactions.skipReproxy = false;
    Transactions.runningTransaction = false;
    Transactions.runPendingTransactions();
});

describe("Date within Retree proxy", () => {
    it("supports getTime on a Date child", () => {
        const time = Date.UTC(2026, 4, 27, 12);
        const root = trackRoot(Retree.root({ createdAt: new Date(time) }));

        expect(root.createdAt.getTime()).toBe(time);
    });

    it("supports getTime on a Date root", () => {
        const time = Date.UTC(2026, 4, 27, 12);
        const root = trackRoot(Retree.root(new Date(time)));

        expect(root.getTime()).toBe(time);
    });

    it("supports getTime on a Date reproxy passed to listeners", () => {
        const root = trackRoot(Retree.root(new Date(0)));
        let latestReproxy: Date | undefined;
        Retree.on(root, "nodeChanged", (reproxy) => {
            latestReproxy = reproxy;
        });

        root.setTime(1);

        expect(latestReproxy?.getTime()).toBe(1);
    });

    it("emits nodeChanged when a Date mutating method changes time", () => {
        const root = trackRoot(Retree.root({ updatedAt: new Date(0) }));
        const nodeChanged = vi.fn();
        Retree.on(root.updatedAt, "nodeChanged", nodeChanged);

        root.updatedAt.setTime(1);

        expect(root.updatedAt.getTime()).toBe(1);
        expect(nodeChanged).toHaveBeenCalledTimes(1);
    });

    it("does not emit nodeChanged when a Date mutating method keeps the same time", () => {
        const root = trackRoot(Retree.root({ updatedAt: new Date(0) }));
        const nodeChanged = vi.fn();
        Retree.on(root.updatedAt, "nodeChanged", nodeChanged);

        root.updatedAt.setTime(0);

        expect(nodeChanged).not.toHaveBeenCalled();
    });
});
