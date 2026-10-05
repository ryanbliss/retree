/*!
 * Copyright (c) Ryan Bliss. All rights reserved.
 * Licensed under the MIT License.
 */

import { describe, expect, it, vi } from "vitest";
import { Retree } from "./Retree.js";
import { ReactiveNode } from "./ReactiveNode.js";

describe("built-ins that cannot work behind a proxy are leaves", () => {
    it("reads a DOMException assigned into a tree (#119)", () => {
        const state = Retree.root({ error: null as Error | null });
        const error = new DOMException("could not be cloned", "DataCloneError");
        state.error = error;
        expect(state.error).toBe(error);
        expect(state.error.message).toBe("could not be cloned");
        expect(state.error.name).toBe("DataCloneError");
        expect(Retree.isNode(state.error)).toBe(false);
    });

    it("keeps built-ins usable from every storage path", () => {
        class Holder {
            public url = new URL("https://retree.dev/a");
        }
        const pattern = /a+/g;
        const bytes = new Uint8Array([1, 2, 3]);
        const file = new File(["abc"], "a.txt");
        const controller = new AbortController();
        const root = Retree.root({
            holder: new Holder(),
            list: [pattern],
            controllers: [] as AbortController[],
            map: new Map([["bytes", bytes]]),
            set: new Set([file]),
        });
        root.controllers.push(controller);

        expect(root.holder.url.toString()).toBe("https://retree.dev/a");
        expect(root.list[0]).toBe(pattern);
        expect(root.list[0]?.test("aa")).toBe(true);
        expect(root.map.get("bytes")?.length).toBe(3);
        expect([...root.set][0]?.size).toBe(3);
        expect(root.controllers[0]).toBe(controller);
        expect(root.controllers[0]?.signal.aborted).toBe(false);
    });

    it("re-runs tracked readers when the leaf is replaced", () => {
        const root = Retree.root({ error: new DOMException("first") });
        const callback = vi.fn();
        const stop = Retree.select(() => root.error.message, callback);
        root.error = new DOMException("second");
        expect(callback).toHaveBeenCalledWith("second", "first");
        stop();
    });

    it("stores a built-in assigned in a ReactiveNode constructor raw", () => {
        class Upload extends ReactiveNode {
            public signal = new AbortController().signal;
            get dependencies() {
                return [];
            }
        }
        const upload = Retree.root(new Upload());
        expect(upload.signal).toBe(Retree.raw(upload).signal);
        expect(upload.signal.aborted).toBe(false);
    });

    it("rejects a built-in root", () => {
        expect(() => Retree.root(new URL("https://retree.dev"))).toThrow(
            "Retree.root: a URL is a built-in leaf and cannot become a root. Store it in a field of a mutable root."
        );
    });
});
