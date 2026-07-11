/**
 * Building blocks for the route-level loading skeletons (the loading.tsx
 * files under app/). Pure server components: token-styled pulsing blocks,
 * no client JS.
 */

export function SkeletonBlock({ className }: { className: string }) {
    return (
        <div
            aria-hidden
            className={`animate-pulse rounded-md bg-surface ${className}`}
        />
    );
}

export function SkeletonCard({ className }: { className: string }) {
    return (
        <div
            aria-hidden
            className={`animate-pulse rounded-xl border border-border-token bg-surface ${className}`}
        />
    );
}

/** Paragraph stand-in: a stack of text-height lines, last one shorter. */
export function SkeletonLines({ count }: { count: number }) {
    const widths = ["w-full", "w-11/12", "w-full", "w-10/12", "w-9/12"];
    return (
        <div aria-hidden className="space-y-3">
            {Array.from({ length: count }, (_, index) => (
                <SkeletonBlock
                    key={index}
                    className={`h-4 ${
                        index === count - 1
                            ? "w-2/3"
                            : widths[index % widths.length]
                    }`}
                />
            ))}
        </div>
    );
}

/** Screen-reader announcement for a loading route. */
export function SkeletonStatus() {
    return <span className="sr-only">Loading page…</span>;
}
