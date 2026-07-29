import parser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";

import plugin, { configs, rules, typescript } from "./index.js";
import typescriptEntryPoint from "./typescript.js";

describe("@retreejs/react-eslint-plugin configuration", () => {
    it("exports a complete TypeScript flat-config preset", () => {
        expect(typescriptEntryPoint).toBe(typescript);
        expect(configs.typescript).toBe(typescript);
        expect(typescript).toHaveLength(1);

        const [config] = typescript;
        expect(config).toMatchObject({
            name: "@retreejs/react-eslint-plugin/typescript",
            files: ["**/*.{ts,tsx}"],
            ignores: ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}"],
            languageOptions: {
                parserOptions: {
                    projectService: true,
                },
            },
            rules: {
                "@retreejs/no-unobserved-react-read": "error",
            },
        });
        expect(config?.languageOptions?.parser).toBe(parser);
        expect(config?.plugins?.["@retreejs"]).toBe(plugin);
    });

    it("keeps the low-level rule export available", () => {
        expect(plugin.rules).toBe(rules);
        expect(rules["no-unobserved-react-read"]).toBeDefined();
    });
});
