import parser from "@typescript-eslint/parser";
import retree from "@retreejs/react-eslint-plugin";
import baseConfig from "../../eslint.config.js";

export default [
    ...baseConfig,
    {
        name: "retree-sample/no-unobserved-react-read",
        files: ["src/**/*.{ts,tsx}"],
        ignores: ["src/**/*.spec.{ts,tsx}"],
        languageOptions: {
            parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "@retreejs": retree,
        },
        rules: {
            "@retreejs/no-unobserved-react-read": "error",
        },
    },
];
