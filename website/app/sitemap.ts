import type { MetadataRoute } from "next";
import { listDocSlugs } from "@/lib/docs";
import { listApiPages } from "@/lib/api-docs";

const BASE = "https://www.retree.dev";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const staticRoutes = [
        "",
        "/why",
        "/compare",
        "/compare/mobx",
        "/compare/valtio",
        "/api",
    ];
    const docRoutes = listDocSlugs().map((slug) => `/docs/${slug}`);
    const apiRoutes = (await listApiPages()).map(
        (page) => `/api/${[page.pkg, ...page.slug].join("/")}`
    );

    return [...staticRoutes, ...docRoutes, ...apiRoutes].map((route) => ({
        url: `${BASE}${route}`,
        changeFrequency: "weekly",
    }));
}
