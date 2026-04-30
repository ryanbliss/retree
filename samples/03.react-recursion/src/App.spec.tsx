import React from "react";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("03.react-recursion", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("renders both recursive examples and updates a visible counter", async () => {
        const { default: App } = await import("./App");
        render(<App />);

        expect(screen.getByText("Recursion examples")).toBeTruthy();
        expect(screen.getByText("useNode (optimal performance)")).toBeTruthy();
        expect(screen.getByText("useTree (ease of use)")).toBeTruthy();

        const firstCard = screen.getAllByText(/counter:/)[0]?.closest(".card");
        if (!firstCard) {
            throw new Error("expected the first card to render");
        }

        fireEvent.click(within(firstCard).getByText("+count"));
        expect(within(firstCard).getByText("counter: 2")).toBeTruthy();
    });

    it("does not rerender the ignored-state button text when clicked", async () => {
        const { default: App } = await import("./App");
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        render(<App />);

        const ignoredButton = screen.getByText("0++");
        fireEvent.click(ignoredButton);

        expect(screen.getByText("0++")).toBeTruthy();
        expect(log).toHaveBeenCalled();
    });
});
