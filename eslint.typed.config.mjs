import retree from "./packages/retree-eslint-plugin/bin/index.js";
import typedBaseline, { typedFiles } from "./eslint.typed.base.config.mjs";

export default [
    ...typedBaseline,
    {
        name: "retree/no-unobserved-react-read-dogfood",
        files: typedFiles,
        plugins: {
            "@retreejs": retree,
        },
        rules: {
            "@retreejs/no-unobserved-react-read": "warn",
        },
    },
];
