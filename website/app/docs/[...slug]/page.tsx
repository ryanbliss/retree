import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MdxContent } from "@/components/mdx/MdxContent";
import { Toc } from "@/components/docs/Toc";
import { CopyMarkdownButton } from "@/components/docs/CopyMarkdownButton";
import {
    extractToc,
    getAdjacentDocs,
    getDoc,
    getDocNavItem,
    listDocSlugs,
} from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
    return listDocSlugs().map((slug) => ({ slug: slug.split("/") }));
}

interface PageProps {
    params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({
    params,
}: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const joined = slug.join("/");
    if (getDocNavItem(joined) === undefined) return {};
    const doc = await getDoc(joined);
    return { title: doc.title, description: doc.description };
}

export default async function DocPage({ params }: PageProps) {
    const { slug } = await params;
    const joined = slug.join("/");
    if (getDocNavItem(joined) === undefined) {
        notFound();
    }
    const doc = await getDoc(joined);
    const toc = extractToc(doc.body);
    const { previous, next } = getAdjacentDocs(joined);

    return (
        <div className="flex gap-10">
            <article
                data-pagefind-body
                data-pagefind-filter="section:Docs"
                className="min-w-0 max-w-3xl flex-1"
            >
                <div
                    data-pagefind-ignore
                    className="mb-6 flex flex-wrap items-center justify-between gap-3"
                >
                    <p className="font-mono text-xs uppercase tracking-widest text-faint">
                        Docs
                    </p>
                    <div className="flex items-center gap-2">
                        <CopyMarkdownButton
                            markdownUrl={`/raw/docs/${joined}.md`}
                        />
                        <a
                            href={`https://github.com/ryanbliss/retree/edit/main/website/content/docs/${joined}.mdx`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-border-token px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:border-border-strong hover:text-foreground"
                        >
                            Edit on GitHub
                        </a>
                    </div>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                    {doc.title}
                </h1>
                <p className="mt-3 text-base leading-7 text-muted">
                    {doc.description}
                </p>
                <div className="mt-4">
                    <MdxContent source={doc.body} />
                </div>
                <nav
                    aria-label="Adjacent pages"
                    className="mt-12 flex gap-4 border-t border-border-token pt-6"
                >
                    {previous !== undefined ? (
                        <Link
                            href={`/docs/${previous.slug}`}
                            className="group flex-1 rounded-lg border border-border-token p-4 transition-colors hover:border-border-strong"
                        >
                            <span className="font-mono text-[11px] uppercase tracking-widest text-faint">
                                ← Previous
                            </span>
                            <span className="mt-1 block text-sm font-medium text-muted group-hover:text-foreground">
                                {previous.title}
                            </span>
                        </Link>
                    ) : (
                        <div className="flex-1" />
                    )}
                    {next !== undefined ? (
                        <Link
                            href={`/docs/${next.slug}`}
                            className="group flex-1 rounded-lg border border-border-token p-4 text-right transition-colors hover:border-border-strong"
                        >
                            <span className="font-mono text-[11px] uppercase tracking-widest text-faint">
                                Next →
                            </span>
                            <span className="mt-1 block text-sm font-medium text-muted group-hover:text-foreground">
                                {next.title}
                            </span>
                        </Link>
                    ) : (
                        <div className="flex-1" />
                    )}
                </nav>
            </article>
            <aside className="hidden w-52 shrink-0 xl:block">
                <div className="sticky top-20">
                    <Toc entries={toc} />
                </div>
            </aside>
        </div>
    );
}
