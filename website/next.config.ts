import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    reactCompiler: true,
    transpilePackages: [
        "@retreejs/core",
        "@retreejs/react",
        "@retreejs/convex",
        "@retreejs/react-convex",
    ],
    turbopack: {
        root: path.join(__dirname, ".."),
    },
    webpack(config) {
        config.resolve ??= {};
        config.resolve.symlinks = false;
        return config;
    },
};

export default nextConfig;
