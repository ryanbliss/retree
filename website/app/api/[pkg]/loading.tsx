import {
    SkeletonBlock,
    SkeletonCard,
    SkeletonLines,
    SkeletonStatus,
} from "@/components/site/Skeleton";

/**
 * Reference-article skeleton for /api/[pkg]/* navigations. Renders inside the
 * package layout (the sidebar stays put), mirroring the geometry of
 * app/api/[pkg]/[[...slug]]/page.tsx: eyebrow row, symbol heading, signature
 * block, and prose.
 */
export default function ApiReferenceLoading() {
    return (
        <div role="status" className="min-w-0 max-w-3xl">
            <SkeletonStatus />
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <SkeletonBlock className="h-4 w-56" />
                <SkeletonBlock className="h-6 w-32" />
            </div>
            <SkeletonBlock className="h-9 w-1/2" />
            <div className="mt-4">
                <SkeletonLines count={2} />
            </div>
            <SkeletonCard className="mt-6 h-28 w-full" />
            <div className="mt-8 space-y-6">
                <SkeletonBlock className="h-6 w-40" />
                <SkeletonLines count={3} />
                <SkeletonBlock className="h-6 w-48" />
                <SkeletonLines count={3} />
            </div>
        </div>
    );
}
