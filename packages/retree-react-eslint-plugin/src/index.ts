import parser from "@typescript-eslint/parser";
import type { TSESLint } from "@typescript-eslint/utils";

import { noUnobservedReactRead } from "./rules/no-unobserved-react-read.js";

export const rules = {
    "no-unobserved-react-read": noUnobservedReactRead,
};

interface RetreeReactEslintPlugin extends TSESLint.FlatConfig.Plugin {
    configs: TSESLint.FlatConfig.SharedConfigs;
    rules: typeof rules;
}

const plugin: RetreeReactEslintPlugin = {
    configs: {},
    rules,
};

export const typescript: TSESLint.FlatConfig.ConfigArray = [
    {
        name: "@retreejs/react-eslint-plugin/typescript",
        files: ["**/*.{ts,tsx}"],
        ignores: ["**/*.spec.{ts,tsx}", "**/*.test.{ts,tsx}"],
        languageOptions: {
            parser,
            parserOptions: {
                projectService: true,
            },
        },
        plugins: {
            "@retreejs": plugin,
        },
        rules: {
            "@retreejs/no-unobserved-react-read": "error",
        },
    },
];

plugin.configs.typescript = typescript;

export const configs = plugin.configs;
export default plugin;
