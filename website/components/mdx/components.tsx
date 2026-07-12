import Link from "next/link";
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import { CodeBlock } from "@/components/code/CodeBlock";
import { Sandbox } from "@/components/sandpack/Sandbox";
import { HookPlayground } from "@/components/visualizer/HookPlayground";
import { PMTabs } from "./PMTabs";
import { Callout, Note, Warning } from "./Callout";
import { extractFences } from "@/lib/fence";

function MdxPre({ children }: { children?: ReactNode }) {
    const [fence] = extractFences(children);
    if (fence === undefined) {
        return <pre>{children}</pre>;
    }
    return (
        <CodeBlock
            code={fence.code}
            lang={fence.lang}
            title={
                typeof fence.meta.title === "string"
                    ? fence.meta.title
                    : undefined
            }
            noCopy={fence.meta.nocopy === true}
        />
    );
}

function MdxLink({
    href,
    children,
    ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
    if (href !== undefined && href.startsWith("/")) {
        // Generated API MDX links carry the .mdx extension; map to routes.
        const route = href.replace(/\.mdx(#|$)/, "$1");
        return (
            <Link
                href={route}
                className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
                {children}
            </Link>
        );
    }
    const external = href !== undefined && href.startsWith("http");
    return (
        <a
            href={href}
            {...rest}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
        >
            {children}
        </a>
    );
}

function heading(Tag: "h1" | "h2" | "h3" | "h4", className: string) {
    return function Heading({
        id,
        children,
        ...rest
    }: HTMLAttributes<HTMLHeadingElement>) {
        return (
            <Tag
                id={id}
                className={`group scroll-mt-20 ${className}`}
                {...rest}
            >
                {children}
                {id !== undefined ? (
                    <a
                        href={`#${id}`}
                        aria-label="Link to this section"
                        className="ml-2 align-middle font-mono text-sm text-faint opacity-0 transition-opacity group-hover:opacity-100"
                    >
                        #
                    </a>
                ) : null}
            </Tag>
        );
    };
}

type MdxComponentMap = NonNullable<MDXRemoteProps["components"]>;

export const mdxComponents: MdxComponentMap = {
    pre: MdxPre,
    a: MdxLink,
    h1: heading(
        "h1",
        "mt-2 text-3xl font-semibold tracking-tight text-foreground"
    ),
    h2: heading(
        "h2",
        "mt-10 border-t border-border-token pt-8 text-xl font-semibold tracking-tight text-foreground"
    ),
    h3: heading(
        "h3",
        "mt-8 text-lg font-semibold tracking-tight text-foreground"
    ),
    h4: heading("h4", "mt-6 text-base font-semibold text-foreground"),
    p: (props) => <p className="my-4 leading-7 text-muted" {...props} />,
    ul: (props) => (
        <ul
            className="my-4 list-disc space-y-2 pl-6 leading-7 text-muted marker:text-faint"
            {...props}
        />
    ),
    ol: (props) => (
        <ol
            className="my-4 list-decimal space-y-2 pl-6 leading-7 text-muted marker:text-faint"
            {...props}
        />
    ),
    li: (props) => <li className="pl-1" {...props} />,
    code: (props) => (
        <code
            className="rounded border border-border-token bg-surface px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
            {...props}
        />
    ),
    table: (props) => (
        <div className="my-5 overflow-x-auto rounded-lg border border-border-token">
            <table className="w-full border-collapse text-sm" {...props} />
        </div>
    ),
    thead: (props) => <thead className="bg-surface" {...props} />,
    th: (props) => (
        <th
            className="border-b border-border-token px-4 py-2.5 text-left font-mono text-xs font-medium uppercase tracking-wider text-faint"
            {...props}
        />
    ),
    td: (props) => (
        <td
            className="border-b border-border-token px-4 py-2.5 align-top leading-6 text-muted last:border-b-0"
            {...props}
        />
    ),
    blockquote: (props) => (
        <blockquote
            className="my-4 border-l-2 border-border-strong pl-4 italic text-muted"
            {...props}
        />
    ),
    hr: () => <hr className="my-8 border-border-token" />,
    strong: (props) => (
        <strong className="font-semibold text-foreground" {...props} />
    ),
    Sandbox,
    HookPlayground,
    PMTabs,
    Callout,
    Note,
    Warning,
};
