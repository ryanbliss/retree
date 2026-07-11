import type { TocEntry } from "@/lib/docs";

export function Toc({ entries }: { entries: TocEntry[] }) {
    if (entries.length === 0) return null;
    return (
        <nav aria-label="On this page">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-faint">
                On this page
            </p>
            <ul className="space-y-1.5 text-[13px]">
                {entries.map((entry) => (
                    <li
                        key={entry.id}
                        className={entry.depth === 3 ? "pl-3" : undefined}
                    >
                        <a
                            href={`#${entry.id}`}
                            className="text-muted transition-colors hover:text-foreground"
                        >
                            {entry.text}
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
