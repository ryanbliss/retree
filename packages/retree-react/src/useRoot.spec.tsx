import React, { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRoot } from "./useRoot";

describe("useRoot", () => {
    it("initializes the root once per mount under StrictMode", () => {
        const factory = vi.fn(() => ({ count: 1 }));

        function Probe() {
            const root = useRoot(factory);
            return <div>{root.count}</div>;
        }

        render(
            <StrictMode>
                <Probe />
            </StrictMode>
        );

        expect(screen.getByText("1")).toBeTruthy();
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it("returns a stable root across rerenders", () => {
        let firstRoot: object | null = null;
        let sawStableIdentity = true;

        function Probe({ label }: { label: string }) {
            const root = useRoot(() => ({ count: 1 }));
            if (!firstRoot) {
                firstRoot = root;
            } else {
                sawStableIdentity = sawStableIdentity && firstRoot === root;
            }
            return <div>{label}</div>;
        }

        const view = render(<Probe label="first" />);
        view.rerender(<Probe label="second" />);

        expect(screen.getByText("second")).toBeTruthy();
        expect(sawStableIdentity).toBe(true);
    });
});
