import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNode, useRaw, useSelect, useTree } from "./index.js";

/**
 * Every hook that takes a node reaches the same base-proxy lookup. Passing a
 * value that is not a node used to surface Retree's internal invariant, which
 * told the caller to file a Retree issue for their own mistake. Each hook now
 * names itself and what it received instead.
 */
describe("hooks that receive a value that is not a node", () => {
    const unmanaged = { title: "not a node" };
    const hooks: [name: string, use: (value: object) => unknown][] = [
        ["useNode", (value) => useNode(value)],
        ["useTree", (value) => useTree(value)],
        ["useRaw", (value) => useRaw(value)],
        ["useSelect", (value) => useSelect(value, (node) => node)],
    ];

    for (const [name, use] of hooks) {
        it(`names ${name} and the value it received`, () => {
            function Consumer() {
                use(unmanaged);
                return null;
            }

            // React logs the thrown error before rethrowing it; silence it so
            // the expected failure does not pollute test output.
            const consoleError = vi
                .spyOn(console, "error")
                .mockImplementation(() => {});
            try {
                expect(() => render(<Consumer />)).toThrow(
                    `${name}: expected a Retree-managed node but received an unmanaged object.`
                );
            } finally {
                consoleError.mockRestore();
            }
        });
    }
});
