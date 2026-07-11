"use client";

import { getSandpackCssText } from "@codesandbox/sandpack-react";
import { useServerInsertedHTML } from "next/navigation";

/**
 * Emits Sandpack's runtime CSS during SSR so embeds render without a flash of
 * unstyled content. The `id="sandpack"` attribute is required for hydration
 * dedupe per the official App Router guide.
 */
export function SandpackCSS() {
    useServerInsertedHTML(() => (
        <style
            dangerouslySetInnerHTML={{ __html: getSandpackCssText() }}
            id="sandpack"
        />
    ));
    return null;
}
