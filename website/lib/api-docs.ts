import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";

const apiDir = path.join(process.cwd(), "content", "api");

export interface ApiPackage {
    slug: string;
    npmName: string;
    title: string;
    version: string;
    description: string;
}

export interface ApiNavLeaf {
    title: string;
    /** Path relative to the package dir, e.g. "functions/useNode.mdx". */
    path: string;
    isDeprecated?: boolean;
}

export interface ApiNavGroup {
    title: string;
    children: ApiNavLeaf[];
}

export async function getApiManifest(): Promise<{ packages: ApiPackage[] }> {
    const raw = await readFile(path.join(apiDir, "manifest.json"), "utf8");
    return JSON.parse(raw);
}

export async function getApiNavigation(pkg: string): Promise<ApiNavGroup[]> {
    const raw = await readFile(
        path.join(apiDir, pkg, "navigation.json"),
        "utf8"
    );
    return JSON.parse(raw);
}

/** Converts a navigation path ("functions/useNode.mdx") to route segments. */
export function navPathToSlug(navPath: string): string[] {
    return navPath.replace(/\.mdx$/, "").split("/");
}

export async function getApiPageSource(
    pkg: string,
    slug: string[]
): Promise<string> {
    const relative = slug.length === 0 ? "index" : slug.join("/");
    const filePath = path.join(apiDir, pkg, `${relative}.mdx`);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(apiDir))) {
        throw new Error(
            `getApiPageSource: resolved path escapes the API content directory: ${resolved}`
        );
    }
    return readFile(resolved, "utf8");
}

/** Enumerates every generated MDX page for generateStaticParams. */
export async function listApiPages(): Promise<
    { pkg: string; slug: string[] }[]
> {
    const manifest = await getApiManifest();
    const pages: { pkg: string; slug: string[] }[] = [];
    for (const pkg of manifest.packages) {
        const pkgDir = path.join(apiDir, pkg.slug);
        await walk(pkgDir, [], pages, pkg.slug);
    }
    return pages;
}

async function walk(
    dir: string,
    prefix: string[],
    pages: { pkg: string; slug: string[] }[],
    pkg: string
) {
    const entries = await readdir(dir);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const info = await stat(fullPath);
        if (info.isDirectory()) {
            await walk(fullPath, [...prefix, entry], pages, pkg);
        } else if (entry.endsWith(".mdx")) {
            const name = entry.replace(/\.mdx$/, "");
            const slug =
                name === "index" && prefix.length === 0
                    ? []
                    : [...prefix, name];
            pages.push({ pkg, slug });
        }
    }
}

/**
 * Maps API symbol pages to their hand-written guide, rendered as a "Guide"
 * backlink on the reference page (spec §3.2).
 */
export const API_GUIDE_BACKLINKS: Record<string, string> = {
    "react/functions/useNode": "/docs/react/use-node",
    "react/functions/useTree": "/docs/react/use-tree",
    "react/functions/useSelect": "/docs/react/use-select",
    "react/functions/useRaw": "/docs/react/use-raw",
    "react/functions/useRoot": "/docs/react/use-root",
    "core/classes/ReactiveNode": "/docs/view-models",
    "core/variables/Retree": "/docs/events-and-subscriptions",
    "convex/classes/ConvexNode": "/docs/convex",
    "react-convex/classes/RetreeConvexReactClient": "/docs/convex",
};
