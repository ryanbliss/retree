import parser from "@typescript-eslint/parser";

export const typedFiles = [
    "packages/*/src/**/*.{ts,tsx}",
    "samples/02.react-example/src/**/*.{ts,tsx}",
    "samples/03.react-recursion/src/**/*.{ts,tsx}",
    "samples/04.convex-react-nextjs/app/**/*.{ts,tsx}",
    "samples/04.convex-react-nextjs/components/**/*.{ts,tsx}",
    "website/app/**/*.{ts,tsx}",
    "website/components/**/*.{ts,tsx}",
];

export default [
    {
        ignores: [
            "**/*.{js,jsx,cjs,mjs,ts,tsx,mts,cts}",
            ...typedFiles.map((file) => `!${file}`),
            "**/*.benchmark.{ts,tsx}",
            "**/*Benchmark.{ts,tsx}",
            "**/*.spec.{ts,tsx}",
        ],
    },
    {
        name: "retree/typed-lint-baseline",
        files: typedFiles,
        linterOptions: {
            reportUnusedDisableDirectives: "off",
        },
        languageOptions: {
            parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
