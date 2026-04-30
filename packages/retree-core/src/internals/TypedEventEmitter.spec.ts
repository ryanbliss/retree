import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./TypedEventEmitter";

class TestEmitter extends TypedEventEmitter<any> {}

describe("TypedEventEmitter", () => {
    it("supports standard event emitter runtime behavior", () => {
        const emitter = new TestEmitter();
        const listener = vi.fn();

        emitter.on("ping", listener);
        emitter.emit("ping", 1);
        emitter.off("ping", listener);
        emitter.emit("ping", 2);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(1);
    });
});