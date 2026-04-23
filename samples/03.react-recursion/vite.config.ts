import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

function decoratorPreset(options: Record<string, unknown>) {
    return {
        preset: () => ({
            plugins: [["@babel/plugin-proposal-decorators", options]],
        }),
        rolldown: {
            filter: { code: "@" },
        },
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        babel({
            presets: [decoratorPreset({ version: "2023-11" })],
        }),
    ],
    resolve: {
        preserveSymlinks: true,
    },
    server: {
        port: 3000,
        open: true,
    },
    optimizeDeps: {
        force: true,
    },
    oxc: {
        target: "esnext",
    },
});
