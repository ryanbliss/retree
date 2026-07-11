import {
    SkeletonBlock,
    SkeletonCard,
    SkeletonLines,
    SkeletonStatus,
} from "@/components/site/Skeleton";

/**
 * Article-area skeleton for /docs/* navigations. Renders inside the docs
 * layout (the sidebar stays put), mirroring the geometry of
 * app/docs/[...slug]/page.tsx: eyebrow + actions row, title, description,
 * body copy with a code block, and the table-of-contents rail.
 */
export default function DocsLoading() {
    return (
        <div role="status" className="flex gap-10">
            <SkeletonStatus />
            <div className="min-w-0 max-w-3xl flex-1">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <SkeletonBlock className="h-4 w-14" />
                    <div className="flex items-center gap-2">
                        <SkeletonBlock className="h-6 w-32" />
                        <SkeletonBlock className="h-6 w-28" />
                    </div>
                </div>
                <SkeletonBlock className="h-9 w-2/3" />
                <div className="mt-4">
                    <SkeletonLines count={2} />
                </div>
                <div className="mt-8 space-y-6">
                    <SkeletonLines count={4} />
                    <SkeletonCard className="h-44 w-full" />
                    <SkeletonLines count={4} />
                </div>
            </div>
            <aside className="hidden w-52 shrink-0 xl:block">
                <div className="sticky top-20 space-y-2.5">
                    <SkeletonBlock className="h-3 w-24" />
                    <SkeletonBlock className="h-3.5 w-36" />
                    <SkeletonBlock className="h-3.5 w-28" />
                    <SkeletonBlock className="h-3.5 w-32" />
                    <SkeletonBlock className="h-3.5 w-24" />
                </div>
            </aside>
        </div>
    );
}
