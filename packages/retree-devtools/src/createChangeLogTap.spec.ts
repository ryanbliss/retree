/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Retree } from "@retreejs/core";
import { createChangeLogTap } from "./createChangeLogTap.js";
import { IRetreeChangeLogEntry } from "./types.js";

const tapsToRemove: (() => void)[] = [];

function captureEntries(options?: {
    paths?: boolean;
}): IRetreeChangeLogEntry[] {
    const entries: IRetreeChangeLogEntry[] = [];
    tapsToRemove.push(
        createChangeLogTap((entry) => entries.push(entry), options)
    );
    return entries;
}

afterEach(() => {
    for (const removeTap of tapsToRemove.splice(0)) {
        removeTap();
    }
});

describe("createChangeLogTap", () => {
    it("delivers one structured entry per write with root name and records", () => {
        const app = Retree.root({ count: 0 });
        Retree.registerRootName(app, "logApp");
        const entries = captureEntries();

        app.count = 1;

        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({
            kind: "nodeChanged",
            rootName: "logApp",
            path: [],
            records: [
                {
                    node: Retree.raw(app),
                    key: "count",
                    previous: 0,
                    new: 1,
                },
            ],
            transaction: false,
            silent: false,
        });
    });

    it("resolves key paths for nested nodes, including array indices", () => {
        const app = Retree.root({
            tasks: [
                { title: "a", done: false },
                { title: "b", done: false },
            ],
        });
        const entries = captureEntries();

        app.tasks[1].done = true;

        expect(entries).toHaveLength(1);
        expect(entries[0]?.path).toEqual(["tasks", "1"]);
        expect(entries[0]?.rootName).toBeUndefined();
    });

    it("omits paths when the paths option is disabled", () => {
        const app = Retree.root({ child: { v: 0 } });
        const entries = captureEntries({ paths: false });

        app.child.v = 1;

        expect(entries).toHaveLength(1);
        expect(entries[0]?.path).toBeUndefined();
    });

    it("flags entries inside a transaction window", () => {
        const app = Retree.root({ a: 0, b: 0 });
        const entries = captureEntries();

        Retree.runTransaction(() => {
            app.a = 1;
            app.b = 2;
        });
        app.a = 3;

        expect(entries).toHaveLength(3);
        expect(entries.map((entry) => entry.transaction)).toEqual([
            true,
            true,
            false,
        ]);
    });

    it("flags listener-suppressed runSilent writes as silent", () => {
        const app = Retree.root({ count: 0 });
        const entries = captureEntries();

        Retree.runSilent(() => {
            app.count = 1;
        }, false);
        app.count = 2;

        expect(entries.map((entry) => entry.silent)).toEqual([true, false]);
    });

    it("delivers nodeRemoved entries with no records", () => {
        const app = Retree.root({ child: { v: 0 } } as {
            child?: { v: number };
        });
        void app.child?.v;
        const entries = captureEntries();

        delete app.child;

        const removed = entries.find((entry) => entry.kind === "nodeRemoved");
        expect(removed).toBeDefined();
        expect(removed?.records).toEqual([]);
    });

    it("stops delivering after the returned unsubscribe is called", () => {
        const app = Retree.root({ count: 0 });
        const entries: IRetreeChangeLogEntry[] = [];
        const removeTap = createChangeLogTap((entry) => entries.push(entry));

        app.count = 1;
        removeTap();
        app.count = 2;
        // Idempotent.
        removeTap();

        expect(entries).toHaveLength(1);
    });
});
