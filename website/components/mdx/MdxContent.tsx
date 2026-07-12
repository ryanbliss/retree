import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { mdxComponents } from "./components";
import { rehypeCodeMeta } from "@/lib/rehype-code-meta";

/** Renders MDX source (guides or generated API pages) with the site map. */
export function MdxContent({ source }: { source: string }) {
    return (
        <MDXRemote
            source={source}
            components={mdxComponents}
            options={{
                mdxOptions: {
                    remarkPlugins: [remarkGfm],
                    rehypePlugins: [rehypeSlug, rehypeCodeMeta],
                },
            }}
        />
    );
}
