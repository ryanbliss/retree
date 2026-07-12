import {
    SkeletonBlock,
    SkeletonCard,
    SkeletonLines,
    SkeletonStatus,
} from "@/components/site/Skeleton";

/**
 * Skeleton for /compare/* (mobx, valtio): eyebrow, title, intro copy, and
 * the tall side-by-side code comparisons those pages lead with. /compare
 * itself redirects to /why, so this mostly paints for the subpages.
 */
export default function CompareLoading() {
    return (
        <main role="status" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <SkeletonStatus />
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="mt-3 h-10 w-full max-w-2xl" />
            <div className="mt-6 max-w-3xl">
                <SkeletonLines count={4} />
            </div>
            <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SkeletonCard className="h-96" />
                <SkeletonCard className="h-96" />
            </div>
        </main>
    );
}
