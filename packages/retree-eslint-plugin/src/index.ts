import { noUnobservedReactRead } from "./rules/no-unobserved-react-read.js";

export const rules = {
    "no-unobserved-react-read": noUnobservedReactRead,
};

interface RetreeEslintPlugin {
    configs: Record<string, unknown>;
    rules: typeof rules;
}

const plugin: RetreeEslintPlugin = {
    configs: {},
    rules,
};

plugin.configs["flat/recommended-type-checked"] = {
    name: "@retreejs/eslint-plugin/flat/recommended-type-checked",
    plugins: {
        "@retreejs": plugin,
    },
    rules: {
        "@retreejs/no-unobserved-react-read": "warn",
    },
};

export const configs = plugin.configs;
export default plugin;
