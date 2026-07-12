import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    // StrictMode's dev-only double render invocation doubles every render
    // counter on the page (+2 per write instead of +1). This site's product
    // IS its render counters, so dev must match prod. The library contract
    // (one write → one re-render) is pinned by a regression test in
    // packages/retree-react/src/useNode.spec.tsx instead.
    reactStrictMode: false,
    reactCompiler: true,
    experimental: {
        // React <ViewTransition> integration: route navigations run inside
        // document.startViewTransition, enabling the page-fade cross-fade in
        // globals.css (wrapper in app/layout.tsx).
        viewTransition: true,
    },
    // Trace server-file dependencies from the repo root so the symlinked
    // @retreejs workspace packages resolve inside the trace root on Vercel.
    outputFileTracingRoot: path.join(__dirname, ".."),
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
