import type { ReactNode } from "react";
import type { SandpackFiles } from "@codesandbox/sandpack-react";
import { extractFences } from "@/lib/fence";
import { CodeBlock } from "@/components/code/CodeBlock";
import { LiveDemoIsland } from "./LiveDemoIsland";

/**
 * MDX wrapper turning fenced code blocks into a live Sandpack demo.
 *
 * Usage in MDX (fences stay plain markdown, so the page's markdown export
 * and copy-page always contain the runnable code — spec §8):
 *
 * <Sandbox>
 *
 * ```tsx name="/App.tsx"
 * ...
 * ```
 *
 * ```ts name="/state.ts" hidden
 * ...
 * ```
 *
 * </Sandbox>
 */
export function Sandbox({
    children,
    height,
    manualRun,
}: {
    children: ReactNode;
    height?: number;
    manualRun?: boolean;
}) {
    const fences = extractFences(children);
    if (fences.length === 0) {
        throw new Error(
            'Sandbox: no fenced code blocks found in children. Author demo files as fenced blocks with a name="/App.tsx" meta attribute.'
        );
    }

    const files: SandpackFiles = {};
    // Default preview styling so demos aren't a bare white pane inside a
    // dark page; follows the reader's OS color scheme. Demos may override by
    // providing their own /styles.css fence.
    files["/styles.css"] = {
        code: `body {
    font-family: system-ui, sans-serif;
    margin: 16px;
    background: #fafcfa;
    color: #17211b;
}
@media (prefers-color-scheme: dark) {
    body {
        background: #0d1210;
        color: #e9f0ec;
    }
}
`,
        hidden: true,
    };
    for (const fence of fences) {
        const name = fence.meta.name;
        if (typeof name !== "string") {
            throw new Error(
                `Sandbox: a fenced block (lang "${fence.lang}") is missing the name="/File.tsx" meta attribute required to place it in the sandbox filesystem.`
            );
        }
        files[name] = {
            code: fence.code.trimEnd() + "\n",
            hidden: fence.meta.hidden === true,
            active: fence.meta.active === true,
            readOnly: fence.meta.readonly === true,
        };
    }

    const visibleFences = fences.filter((fence) => fence.meta.hidden !== true);
    const fallback = (
        <div>
            {visibleFences.map((fence, index) => (
                <CodeBlock
                    key={index}
                    code={fence.code}
                    lang={fence.lang}
                    title={String(fence.meta.name)}
                />
            ))}
        </div>
    );

    return (
        <LiveDemoIsland
            files={files}
            height={height}
            manualRun={manualRun}
            fallback={fallback}
        />
    );
}
