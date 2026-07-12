"use client";

import {
    lazy,
    Suspense,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import type { LiveDemoProps } from "./LiveDemo";

const LiveDemo = lazy(() => import("./LiveDemo"));

/**
 * Mounts the Sandpack editor only when the demo scrolls near the viewport,
 * keeping CodeMirror (~80 kB gz) out of initial page chunks. Until then it
 * renders `fallback` — the server-rendered static Shiki blocks of the same
 * code — so the content is always readable (spec §6/§8).
 */
export function LiveDemoIsland({
    fallback,
    ...demoProps
}: LiveDemoProps & { fallback: ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [nearViewport, setNearViewport] = useState(false);

    useEffect(() => {
        const element = containerRef.current;
        if (element === null) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNearViewport(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "800px 0px" }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={containerRef} className="my-5">
            {nearViewport ? (
                <Suspense fallback={fallback}>
                    <LiveDemo {...demoProps} />
                </Suspense>
            ) : (
                fallback
            )}
        </div>
    );
}
