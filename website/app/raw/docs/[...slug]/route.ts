import { getDoc, getDocNavItem, listDocSlugs } from "@/lib/docs";

export const dynamic = "force-static";

export function generateStaticParams() {
    return listDocSlugs().map((slug) => {
        const segments = slug.split("/");
        const last = segments.length - 1;
        segments[last] = `${segments[last]}.md`;
        return { slug: segments };
    });
}

/** Serves each docs page as raw markdown for AI readers (spec §8). */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string[] }> }
) {
    const { slug } = await params;
    const joined = slug.join("/").replace(/\.md$/, "");
    if (getDocNavItem(joined) === undefined) {
        return new Response("Not found", { status: 404 });
    }
    const doc = await getDoc(joined);
    // Interactive-only MDX components have no meaning in a markdown export;
    // replace them with a pointer to the live page (spec §8).
    const body = doc.body.replace(
        /^<(HookPlayground)\s*\/>$/gm,
        (_match, name) =>
            `> **Interactive demo (${name})** — try it live at https://retreejs.dev/docs/${joined}`
    );
    const markdown = `# ${doc.title}\n\n> ${doc.description}\n\n${body}`;
    return new Response(markdown, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
}
