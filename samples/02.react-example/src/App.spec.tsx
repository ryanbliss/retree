import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("02.react-example", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("renders the title and completes a successful randomize flow", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                json: async () => ({ data: ["Cats sleep for most of the day."] }),
            }))
        );

        const { default: App } = await import("./App");
        render(<App />);

        expect(screen.getByText("Retree cat facts example")).toBeTruthy();
        fireEvent.click(screen.getByText("Random fact"));
        expect(screen.getByText("Loading cat facts...")).toBeTruthy();

        await waitFor(() => {
            expect(
                screen.getByText("Cats sleep for most of the day.")
            ).toBeTruthy();
        });
    });

    it("renders the error state when randomize fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("network failed");
            })
        );

        const { default: App } = await import("./App");
        render(<App />);

        fireEvent.click(screen.getByText("Random fact"));

        await waitFor(() => {
            expect(screen.getByText("network failed")).toBeTruthy();
        });
    });
});