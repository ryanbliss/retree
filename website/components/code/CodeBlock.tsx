import { highlightCode } from "@/lib/highlight";
import { CopyButton } from "./CopyButton";

export interface CodeBlockProps {
    code: string;
    lang?: string;
    /** Filename or label shown in the block header. */
    title?: string;
    /** Hide the copy button (e.g. for illustrative pseudo-code). */
    noCopy?: boolean;
}

/**
 * Server-rendered, Shiki-highlighted code block with copy button. This is the
 * default rendering for every fenced code block on the site.
 */
export async function CodeBlock({
    code,
    lang = "ts",
    title,
    noCopy,
}: CodeBlockProps) {
    const html = await highlightCode(code.trimEnd(), lang);

    return (
        <figure className="group relative my-5 overflow-hidden rounded-lg border border-border-token bg-code-bg">
            {title ? (
                <figcaption className="border-b border-border-token px-4 py-2 font-mono text-xs text-faint">
                    {title}
                </figcaption>
            ) : null}
            <div
                className="overflow-x-auto p-4 text-[13px] leading-relaxed [&_pre]:font-mono [&_pre]:outline-none"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {noCopy ? null : <CopyButton text={code} />}
        </figure>
    );
}
