import { defineConfig } from "vitest/config";
import config from "./vitest.config";

export default defineConfig({
    ...config,
    test: {
        ...config.test,
        maxWorkers: 1,
        projects: [
            {
                extends: true,
                test: {
                    name: "react-performance",
                    include: ["packages/retree-react/src/useRaw.perf.spec.tsx"],
                    environment: "jsdom",
                },
            },
        ],
    },
});
