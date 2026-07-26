import { noUnobservedReactRead } from "./rules/no-unobserved-react-read.js";

export const rules = {
    "no-unobserved-react-read": noUnobservedReactRead,
};

interface RetreeReactEslintPlugin {
    configs: Record<string, unknown>;
    rules: typeof rules;
}

const plugin: RetreeReactEslintPlugin = {
    configs: {},
    rules,
};

plugin.configs["flat/recommended-type-checked"] = {
    name: "@retreejs/react-eslint-plugin/flat/recommended-type-checked",
    plugins: {
        "@retreejs": plugin,
    },
    rules: {
        "@retreejs/no-unobserved-react-read": "warn",
    },
};

export const configs = plugin.configs;
export default plugin;
