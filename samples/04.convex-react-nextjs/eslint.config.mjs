import { defineConfig, globalIgnores } from "eslint/config";
import parser from "@typescript-eslint/parser";
import retree from "@retreejs/react-eslint-plugin";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        name: "retree-sample/no-unobserved-react-read",
        files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
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
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        ".next/**",
        "out/**",
        "build/**",
        "next-env.d.ts",
    ]),
]);

export default eslintConfig;
