import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import matter from "gray-matter";

export interface DocNavItem {
    slug: string;
    title: string;
}

export interface DocNavSection {
    title: string;
    items: DocNavItem[];
}

/**
 * Journey-ordered docs navigation (spec §4). Slugs map to
 * `content/docs/<slug>.mdx`; ordering here drives the sidebar and prev/next
 * links.
 */
export const DOCS_NAV: DocNavSection[] = [
    {
        title: "Start here",
        items: [
            { slug: "quick-start", title: "Quickstart" },
            { slug: "thinking-in-retree", title: "Thinking in Retree" },
            { slug: "common-pitfalls", title: "Common pitfalls" },
        ],
    },
    {
        title: "React",
        items: [
            { slug: "react", title: "Choosing a hook" },
            { slug: "react/use-root", title: "useRoot" },
            { slug: "react/use-node", title: "useNode" },
            { slug: "react/use-tree", title: "useTree" },
            { slug: "react/use-select", title: "useSelect" },
            { slug: "react/use-raw", title: "useRaw" },
        ],
    },
    {
        title: "Core",
        items: [
            {
                slug: "events-and-subscriptions",
                title: "Events & subscriptions",
            },
            { slug: "tree-operations", title: "Tree operations" },
            { slug: "transactions", title: "Transactions & silent writes" },
        ],
    },
    {
        title: "View models",
        items: [
            { slug: "view-models", title: "ReactiveNode & decorators" },
            { slug: "setup-and-decorators", title: "Setup & decorators" },
        ],
    },
    {
        title: "Going deeper",
        items: [
            { slug: "performance", title: "Performance" },
            { slug: "convex", title: "Convex integration" },
        ],
    },
];

const FLAT_NAV: DocNavItem[] = DOCS_NAV.flatMap((section) => section.items);

/**
 * Slugs from the nav whose MDX file exists. Nav entries without content yet
 * are skipped at build time so pages can land incrementally; the QA gate is
 * that this list equals the full nav before launch.
 */
export function listDocSlugs(): string[] {
    return FLAT_NAV.filter((item) =>
        existsSync(path.join(docsDir, `${item.slug}.mdx`))
    ).map((item) => item.slug);
}

export function getDocNavItem(slug: string): DocNavItem | undefined {
    return FLAT_NAV.find((item) => item.slug === slug);
}

export function getAdjacentDocs(slug: string): {
    previous: DocNavItem | undefined;
    next: DocNavItem | undefined;
} {
    const index = FLAT_NAV.findIndex((item) => item.slug === slug);
    if (index === -1) {
        return { previous: undefined, next: undefined };
    }
    return {
        previous: index > 0 ? FLAT_NAV[index - 1] : undefined,
        next: index < FLAT_NAV.length - 1 ? FLAT_NAV[index + 1] : undefined,
    };
}

export interface DocFile {
    slug: string;
    title: string;
    description: string;
    body: string;
}

const docsDir = path.join(process.cwd(), "content", "docs");

export async function getDoc(slug: string): Promise<DocFile> {
    const filePath = path.join(docsDir, `${slug}.mdx`);
    const raw = await readFile(filePath, "utf8");
    const { data, content } = matter(raw);
    if (typeof data.title !== "string") {
        throw new Error(
            `Doc "${slug}" is missing the required "title" frontmatter field at ${filePath}.`
        );
    }
    if (typeof data.description !== "string") {
        throw new Error(
            `Doc "${slug}" is missing the required "description" frontmatter field at ${filePath}.`
        );
    }
    return {
        slug,
        title: data.title,
        description: data.description,
        body: content,
    };
}

export interface TocEntry {
    depth: 2 | 3;
    id: string;
    text: string;
}

/** GitHub-slugger-compatible-enough anchor ids matching rehype-slug output. */
export function slugifyHeading(text: string): string {
    return text
        .toLowerCase()
        .replace(/`/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

/** Extracts h2/h3 headings from MDX source for the on-page TOC. */
export function extractToc(body: string): TocEntry[] {
    const entries: TocEntry[] = [];
    // Strip fenced code blocks so `# comments` inside them are ignored.
    const withoutFences = body.replace(/```[\s\S]*?```/g, "");
    for (const line of withoutFences.split("\n")) {
        const match = /^(##{1,2})\s+(.+)$/.exec(line.trim());
        if (match === null) continue;
        const depth = match[1].length === 2 ? 2 : 3;
        const text = match[2].replace(/`/g, "").trim();
        entries.push({ depth, id: slugifyHeading(match[2]), text });
    }
    return entries;
}
