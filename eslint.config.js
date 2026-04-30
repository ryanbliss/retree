const js = require("@eslint/js");
const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const prettierPlugin = require("eslint-plugin-prettier");
const prettierConfig = require("eslint-config-prettier");
const reactHooks = require("eslint-plugin-react-hooks");
const reactRefresh = require("eslint-plugin-react-refresh").default;

const sourceFiles = ["**/*.{js,jsx,ts,tsx}"];
const reactSampleFiles = [
    "samples/{02.react-example,03.react-recursion}/src/**/*.{ts,tsx}",
];

module.exports = [
    {
        ignores: [
            "**/bin/**",
            "**/build/**",
            "**/demo-packages/**",
            "**/dist/**",
            "**/docs/assets/main.js",
            "**/manifest/**",
            "**/node_modules/**",
            "**/package-lock.json",
            "**/.eslintrc.cjs",
        ],
    },
    js.configs.recommended,
    {
        files: sourceFiles,
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2020,
                ...globals.jest,
                ...globals.mocha,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            prettier: prettierPlugin,
            "react-hooks": reactHooks,
        },
        rules: {
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/explicit-member-accessibility": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-namespace": "off",
            "no-async-promise-executor": "off",
            "no-constant-condition": "off",
            "no-undef": "off",
            "no-unused-vars": "off",
            "prettier/prettier": "error",
        },
        settings: {
            react: {
                version: "detect",
            },
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsParser,
        },
    },
    {
        files: reactSampleFiles,
        plugins: {
            "react-refresh": reactRefresh,
        },
        rules: {
            "react-refresh/only-export-components": [
                "warn",
                { allowConstantExport: true },
            ],
        },
    },
    prettierConfig,
];
