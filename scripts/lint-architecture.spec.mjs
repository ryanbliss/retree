import { describe, expect, it } from "vitest";
import { findRuntimeTestImports } from "./lint-architecture.mjs";

describe("SDK runtime import boundaries", () => {
    it("rejects test frameworks, fixture exports, and dynamic test imports", () => {
        const imports = findRuntimeTestImports(
            "packages/core/src/runtime.ts",
            `
            import { vi } from 'vitest';
            export * from './__fixtures__/tree.js';
            const test = import('@retreejs/react/testing');
        `
        );
        expect(imports).toHaveLength(3);
    });
    it("allows SDK dependencies and isolated test entrypoints", () => {
        expect(
            findRuntimeTestImports(
                "packages/react/src/runtime.ts",
                "import { Retree } from '@retreejs/core';"
            )
        ).toEqual([]);
        expect(
            findRuntimeTestImports(
                "packages/react/src/testing/index.ts",
                "import { act } from '@testing-library/react';"
            )
        ).toEqual([]);
        expect(
            findRuntimeTestImports(
                "packages/core/src/runtime.spec.ts",
                "import { vi } from 'vitest';"
            )
        ).toEqual([]);
    });
});
