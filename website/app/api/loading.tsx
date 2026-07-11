import {
    SkeletonBlock,
    SkeletonCard,
    SkeletonStatus,
} from "@/components/site/Skeleton";

/**
 * Skeleton for the /api package index (app/api/page.tsx): eyebrow, title,
 * intro line, and the two-column package-card grid. Also the first paint for
 * a cold navigation into /api/[pkg] before that segment's layout resolves.
 */
export default function ApiIndexLoading() {
    return (
        <main role="status" className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <SkeletonStatus />
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="mt-3 h-9 w-52" />
            <SkeletonBlock className="mt-4 h-4 w-full max-w-xl" />
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <SkeletonCard className="h-36" />
                <SkeletonCard className="h-36" />
                <SkeletonCard className="h-36" />
                <SkeletonCard className="h-36" />
            </div>
        </main>
    );
}
