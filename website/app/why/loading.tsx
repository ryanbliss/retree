import {
    SkeletonBlock,
    SkeletonCard,
    SkeletonLines,
    SkeletonStatus,
} from "@/components/site/Skeleton";

/**
 * Skeleton for /why (app/why/page.tsx): eyebrow, wide title, intro
 * paragraphs, the deep-write code block, and the side-by-side demo panels.
 */
export default function WhyLoading() {
    return (
        <main role="status" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
            <SkeletonStatus />
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="mt-3 h-10 w-full max-w-2xl" />
            <div className="mt-6 max-w-3xl">
                <SkeletonLines count={5} />
            </div>
            <SkeletonCard className="mt-6 h-40 w-full max-w-3xl" />
            <div className="mt-10 grid gap-4 md:grid-cols-2">
                <SkeletonCard className="h-72" />
                <SkeletonCard className="h-72" />
            </div>
        </main>
    );
}
