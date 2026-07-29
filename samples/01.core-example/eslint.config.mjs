import { defineConfig } from "eslint/config";
import retree from "@retreejs/react-eslint-plugin/typescript";
import baseConfig from "../../eslint.config.js";

export default defineConfig([...baseConfig, ...retree]);
