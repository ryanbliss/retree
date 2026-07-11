import type { ReactNode } from "react";

const STYLES = {
    note: {
        label: "Note",
        border: "border-l-accent-glow",
        text: "text-accent",
    },
    warning: {
        label: "Caveat",
        border: "border-l-warning",
        text: "text-warning",
    },
} as const;

export function Callout({
    type = "note",
    title,
    children,
}: {
    type?: keyof typeof STYLES;
    title?: string;
    children: ReactNode;
}) {
    const style = STYLES[type];
    return (
        <aside
            className={`my-5 rounded-r-lg border border-border-token border-l-2 ${style.border} bg-surface px-4 py-3`}
        >
            <p
                className={`font-mono text-xs font-semibold uppercase tracking-widest ${style.text}`}
            >
                {title ?? style.label}
            </p>
            <div className="mt-1.5 text-sm text-muted [&>p]:my-1.5 [&_code]:text-foreground">
                {children}
            </div>
        </aside>
    );
}

export function Note(props: { title?: string; children: ReactNode }) {
    return <Callout type="note" {...props} />;
}

export function Warning(props: { title?: string; children: ReactNode }) {
    return <Callout type="warning" {...props} />;
}
