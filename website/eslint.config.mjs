import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        rules: {
            // Retree's documented model is direct mutation of useNode/useTree
            // results (state.count += 1); the react-hooks immutability rule
            // is written for immutable stores and flags every such write.
            // The site dogfoods Retree, so the rule is disabled here.
            "react-hooks/immutability": "off",
        },
    },
    // Override default ignores of eslint-config-next.
    globalIgnores([
        // Default ignores of eslint-config-next:
        ".next/**",
        "out/**",
        "build/**",
        "next-env.d.ts",
        "generated/**",
        // Generated at build time (pagefind postbuild, llms.txt copy).
        "public/**",
    ]),
]);

export default eslintConfig;
