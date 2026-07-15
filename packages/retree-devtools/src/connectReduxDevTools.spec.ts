/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Retree } from "@retreejs/core";
import { connectReduxDevTools } from "./connectReduxDevTools.js";
import {
    IReduxDevToolsAction,
    IReduxDevToolsInstance,
} from "./internals/redux-devtools-extension.js";
import { IReduxDevToolsConnection } from "./types.js";

interface ISentEntry {
    action: IReduxDevToolsAction;
    state: unknown;
}

interface IFakeExtensionHarness {
    sent: ISentEntry[];
    connectOptions: unknown[];
    getInitState(): unknown;
    dispatchMessage(message: unknown): void;
    getMessageUnsubscribeCalls(): number;
    getInstanceUnsubscribeCalls(): number;
}

const connectionsToDispose: IReduxDevToolsConnection[] = [];

function trackConnection(
    connection: IReduxDevToolsConnection
): IReduxDevToolsConnection {
    connectionsToDispose.push(connection);
    return connection;
}

function installFakeExtension(): IFakeExtensionHarness {
    const sent: ISentEntry[] = [];
    const connectOptions: unknown[] = [];
    const listeners: ((message: unknown) => void)[] = [];
    let initState: unknown = "<init never called>";
    let messageUnsubscribeCalls = 0;
    let instanceUnsubscribeCalls = 0;
    const instance: IReduxDevToolsInstance = {
        init: (state) => {
            initState = state;
        },
        send: (action, state) => {
            sent.push({ action, state });
        },
        subscribe: (listener) => {
            listeners.push(listener);
            return () => {
                messageUnsubscribeCalls += 1;
            };
        },
        unsubscribe: () => {
            instanceUnsubscribeCalls += 1;
        },
    };
    Reflect.set(globalThis, "__REDUX_DEVTOOLS_EXTENSION__", {
        connect: (options: unknown) => {
            connectOptions.push(options);
            return instance;
        },
    });
    return {
        sent,
        connectOptions,
        getInitState: () => initState,
        dispatchMessage: (message) => {
            for (const listener of [...listeners]) {
                listener(message);
            }
        },
        getMessageUnsubscribeCalls: () => messageUnsubscribeCalls,
        getInstanceUnsubscribeCalls: () => instanceUnsubscribeCalls,
    };
}

afterEach(() => {
    for (const connection of connectionsToDispose.splice(0)) {
        connection.dispose();
    }
    Reflect.deleteProperty(globalThis, "__REDUX_DEVTOOLS_EXTENSION__");
});

describe("connectReduxDevTools", () => {
    it("connects with the instance name and maxAge and reports the initial state", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });

        const connection = trackConnection(
            connectReduxDevTools({
                name: "Test App",
                maxAge: 25,
                roots: { initApp: app },
            })
        );

        expect(connection.connected).toBe(true);
        expect(harness.connectOptions).toEqual([
            { name: "Test App", maxAge: 25 },
        ]);
        expect(harness.getInitState()).toEqual({ initApp: { count: 0 } });
    });

    it("sends one action per write with the change records and a state snapshot", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(connectReduxDevTools({ roots: { writeApp: app } }));

        app.count = 1;

        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]?.action).toEqual({
            type: "writeApp/Object.count",
            payload: {
                rootName: "writeApp",
                node: "Object",
                silent: false,
                changes: [{ key: "count", previous: 0, new: 1 }],
            },
        });
        expect(harness.sent[0]?.state).toEqual({ writeApp: { count: 1 } });
    });

    it("labels array mutations with the Array node label and structural ops", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ items: [1] });
        trackConnection(connectReduxDevTools({ roots: { arrayApp: app } }));

        app.items.push(2);

        expect(harness.sent).toHaveLength(1);
        const action = harness.sent[0]?.action;
        expect(action?.type.startsWith("arrayApp/Array.")).toBe(true);
        expect(action?.payload).toMatchObject({
            rootName: "arrayApp",
            node: "Array",
        });
        expect(harness.sent[0]?.state).toEqual({ arrayApp: { items: [1, 2] } });
    });

    it("snapshots state with structuredClone so later writes do not mutate sent snapshots", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(connectReduxDevTools({ roots: { cloneApp: app } }));

        app.count = 1;
        app.count = 2;

        expect(harness.sent[0]?.state).toEqual({ cloneApp: { count: 1 } });
        expect(harness.sent[1]?.state).toEqual({ cloneApp: { count: 2 } });
    });

    it("batches a runTransaction window into a single transaction action", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ a: 0, b: 0 });
        trackConnection(
            connectReduxDevTools({ roots: { transactionApp: app } })
        );

        Retree.runTransaction(() => {
            app.a = 1;
            app.b = 2;
        });

        expect(harness.sent).toHaveLength(1);
        const action = harness.sent[0]?.action;
        expect(action?.type).toBe("transaction");
        expect(action?.payload).toEqual({
            actions: [
                {
                    type: "transactionApp/Object.a",
                    payload: {
                        rootName: "transactionApp",
                        node: "Object",
                        silent: false,
                        changes: [{ key: "a", previous: 0, new: 1 }],
                    },
                },
                {
                    type: "transactionApp/Object.b",
                    payload: {
                        rootName: "transactionApp",
                        node: "Object",
                        silent: false,
                        changes: [{ key: "b", previous: 0, new: 2 }],
                    },
                },
            ],
        });
        expect(harness.sent[0]?.state).toEqual({
            transactionApp: { a: 1, b: 2 },
        });
    });

    it("sends nothing for an empty transaction", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(connectReduxDevTools({ roots: { emptyTxApp: app } }));

        Retree.runTransaction(() => {});

        expect(harness.sent).toHaveLength(0);
    });

    it("includes listener-suppressed runSilent writes flagged silent", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(connectReduxDevTools({ roots: { silentApp: app } }));

        Retree.runSilent(() => {
            app.count = 1;
        }, false);

        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]?.action.payload).toMatchObject({
            silent: true,
        });
    });

    it("labels writes on unnamed trees as anonymous", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(connectReduxDevTools());

        app.count = 1;

        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]?.action.type).toBe("anonymous/Object.count");
    });

    it("sends a removed action when a node leaves the tree", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ child: { v: 0 } } as {
            child?: { v: number };
        });
        // Materialize the child so removal can emit for it.
        void app.child?.v;
        trackConnection(connectReduxDevTools({ roots: { removeApp: app } }));

        delete app.child;

        // The removed node is already detached when the emission fires, so
        // its root name is no longer resolvable and it reports as anonymous.
        const actionTypes = harness.sent.map((entry) => entry.action.type);
        expect(actionTypes).toContain("anonymous/Object.removed");
    });

    it("sends a null state when stateSnapshots is disabled", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(
            connectReduxDevTools({
                roots: { noSnapshotApp: app },
                stateSnapshots: false,
            })
        );

        app.count = 1;

        expect(harness.getInitState()).toBeNull();
        expect(harness.sent[0]?.state).toBeNull();
    });

    it("applies JUMP_TO_ACTION state to roots without echoing actions back", () => {
        const harness = installFakeExtension();
        const app = Retree.root({
            count: 0,
            items: [
                { id: 1, label: "x" },
                { id: 2, label: "y" },
            ],
        });
        trackConnection(connectReduxDevTools({ roots: { jumpApp: app } }));
        app.count = 1;
        const sendsBeforeJump = harness.sent.length;
        const rawItemsBeforeJump = Retree.raw(app.items);

        harness.dispatchMessage({
            type: "DISPATCH",
            payload: { type: "JUMP_TO_ACTION" },
            state: JSON.stringify({
                jumpApp: { count: 5, items: [{ id: 1, label: "a" }] },
            }),
        });

        expect(app.count).toBe(5);
        expect(app.items).toHaveLength(1);
        expect(app.items[0]?.label).toBe("a");
        // Node identities survive the jump.
        expect(Retree.raw(app.items)).toBe(rawItemsBeforeJump);
        // The jump's own writes do not echo back to the extension.
        expect(harness.sent).toHaveLength(sendsBeforeJump);
    });

    it("deletes plain-object keys the jumped-to state does not have", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ kept: 1, extra: 2 } as {
            kept: number;
            extra?: number;
        });
        trackConnection(connectReduxDevTools({ roots: { deleteApp: app } }));

        harness.dispatchMessage({
            type: "DISPATCH",
            payload: { type: "JUMP_TO_STATE" },
            state: JSON.stringify({ deleteApp: { kept: 1 } }),
        });

        expect(Object.hasOwn(Retree.raw(app), "extra")).toBe(false);
        expect(app.kept).toBe(1);
    });

    it("keeps Map contents on jump and warns that JSON cannot restore them", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0, lookup: new Map([["k", 1]]) });
        trackConnection(connectReduxDevTools({ roots: { mapApp: app } }));

        harness.dispatchMessage({
            type: "DISPATCH",
            payload: { type: "JUMP_TO_ACTION" },
            state: JSON.stringify({ mapApp: { count: 3, lookup: {} } }),
        });

        expect(app.count).toBe(3);
        expect(app.lookup.get("k")).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toContain("mapApp.lookup");
    });

    it("ignores jumps when stateSnapshots is disabled", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        trackConnection(
            connectReduxDevTools({
                roots: { frozenApp: app },
                stateSnapshots: false,
            })
        );

        harness.dispatchMessage({
            type: "DISPATCH",
            payload: { type: "JUMP_TO_ACTION" },
            state: JSON.stringify({ frozenApp: { count: 9 } }),
        });

        expect(app.count).toBe(0);
    });

    it("no-ops safely when the extension is absent", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const app = Retree.root({ count: 0 });

        const connection = trackConnection(
            connectReduxDevTools({ roots: { absentApp: app } })
        );
        const secondConnection = trackConnection(connectReduxDevTools());
        app.count = 1;
        connection.dispose();
        secondConnection.dispose();

        expect(connection.connected).toBe(false);
        expect(secondConnection.connected).toBe(false);
        expect(info).toHaveBeenCalledTimes(1);
    });

    it("dispose removes the tap and unsubscribes from the extension", () => {
        const harness = installFakeExtension();
        const app = Retree.root({ count: 0 });
        const connection = trackConnection(
            connectReduxDevTools({ roots: { disposeApp: app } })
        );

        app.count = 1;
        connection.dispose();
        app.count = 2;
        // Idempotent.
        connection.dispose();

        expect(harness.sent).toHaveLength(1);
        expect(harness.getMessageUnsubscribeCalls()).toBe(1);
        expect(harness.getInstanceUnsubscribeCalls()).toBe(1);
    });
});
