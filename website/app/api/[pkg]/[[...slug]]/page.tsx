import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MdxContent } from "@/components/mdx/MdxContent";
import {
    API_GUIDE_BACKLINKS,
    getApiManifest,
    getApiPageSource,
    listApiPages,
} from "@/lib/api-docs";

export const dynamicParams = false;

export async function generateStaticParams() {
    const pages = await listApiPages();
    return pages.map((page) => ({
        pkg: page.pkg,
        slug: page.slug.length === 0 ? undefined : page.slug,
    }));
}

interface PageProps {
    params: Promise<{ pkg: string; slug?: string[] }>;
}

export async function generateMetadata({
    params,
}: PageProps): Promise<Metadata> {
    const { pkg, slug } = await params;
    const symbol = slug?.at(-1);
    const manifest = await getApiManifest();
    const packageInfo = manifest.packages.find(
        (candidate) => candidate.slug === pkg
    );
    const packageName = packageInfo?.npmName ?? pkg;
    return {
        title:
            symbol !== undefined ? `${symbol} — ${packageName}` : packageName,
        description:
            symbol !== undefined
                ? `API reference for ${symbol} in ${packageName}.`
                : `API reference for ${packageName}.`,
    };
}

export default async function ApiPage({ params }: PageProps) {
    const { pkg, slug = [] } = await params;

    let source: string;
    try {
        source = await getApiPageSource(pkg, slug);
    } catch {
        notFound();
    }

    const backlink = API_GUIDE_BACKLINKS[[pkg, ...slug].join("/")];

    return (
        <article
            data-pagefind-body
            data-pagefind-filter="section:API"
            className="min-w-0 max-w-3xl"
        >
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-widest text-faint">
                    API reference · generated from source
                </p>
                {backlink !== undefined ? (
                    <Link
                        href={backlink}
                        className="rounded-md border border-border-token px-2.5 py-1 font-mono text-[11px] text-accent transition-colors hover:border-border-strong"
                    >
                        Read the guide →
                    </Link>
                ) : null}
            </div>
            <div className="api-content">
                <MdxContent source={source} />
            </div>
        </article>
    );
}
