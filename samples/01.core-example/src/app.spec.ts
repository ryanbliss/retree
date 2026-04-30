import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("01.core-example", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '<div id="content"></div>';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("starts without throwing and exercises the listener flow", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        await import("./app");

        expect(log).toHaveBeenCalledWith("start");
        expect(
            log.mock.calls.some((call) => call[0] === "nodeRemoved node")
        ).toBe(true);
        expect(error).not.toHaveBeenCalled();
    });
});
