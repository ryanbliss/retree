import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./internals/TypedEventEmitter";

interface ITestEvents {
    (event: "ping", listener: (value: number) => void): void;
}

/**
 * The in-house emitter replaced the `events` npm polyfill for bundle size.
 * These specs pin the Node-EventEmitter semantics Retree depends on.
 */
describe("TypedEventEmitter", () => {
    it("calls listeners in registration order with emit arguments", () => {
        const emitter = new TypedEventEmitter<ITestEvents>();
        const order: string[] = [];
        emitter.on("ping", (value) => order.push(`first:${value}`));
        emitter.on("ping", (value) => order.push(`second:${value}`));

        const hadListeners = emitter.emit("ping", 7);

        expect(hadListeners).toBe(true);
        expect(order).toEqual(["first:7", "second:7"]);
    });

    it("returns false from emit when nothing is subscribed", () => {
        const emitter = new TypedEventEmitter<ITestEvents>();
        expect(emitter.emit("ping", 1)).toBe(false);
    });

    it("off removes exactly one registration and unknown listeners are a no-op", () => {
        const emitter = new TypedEventEmitter<ITestEvents>();
        const listener = vi.fn();
        emitter.on("ping", listener);
        emitter.on("ping", listener);

        emitter.off("ping", listener);
        emitter.emit("ping", 1);
        expect(listener).toHaveBeenCalledTimes(1);

        emitter.off("ping", listener);
        emitter.off("ping", listener); // already gone — must not throw
        emitter.emit("ping", 2);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("a listener unsubscribing itself mid-emit does not skip later listeners", () => {
        // Node EventEmitter iterates a snapshot; Retree's unsubscribe-during-
        // emit paths (e.g. Retree.on cleanup inside a change callback) rely
        // on this.
        const emitter = new TypedEventEmitter<ITestEvents>();
        const second = vi.fn();
        const first = vi.fn(() => {
            emitter.off("ping", first);
        });
        emitter.on("ping", first);
        emitter.on("ping", second);

        emitter.emit("ping", 1);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        emitter.emit("ping", 2);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
    });

    it("a listener added mid-emit does not run until the next emit", () => {
        const emitter = new TypedEventEmitter<ITestEvents>();
        const late = vi.fn();
        emitter.on("ping", () => {
            emitter.on("ping", late);
        });
        emitter.on("ping", vi.fn());

        emitter.emit("ping", 1);
        expect(late).not.toHaveBeenCalled();

        emitter.emit("ping", 2);
        expect(late).toHaveBeenCalledTimes(1);
        // Undo the compounding registration from the first listener.
        emitter.off("ping", late);
    });

    it("once fires exactly once", () => {
        const emitter = new TypedEventEmitter<ITestEvents>();
        const listener = vi.fn();
        emitter.once("ping", listener);

        emitter.emit("ping", 1);
        emitter.emit("ping", 2);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(1);
    });
});
