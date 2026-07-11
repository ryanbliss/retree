"use client";

import {
    SandpackProvider,
    SandpackLayout,
    SandpackCodeEditor,
    SandpackPreview,
    type SandpackFiles,
} from "@codesandbox/sandpack-react";
import {
    retreeSandpackTheme,
    SANDPACK_RETREE_DEPENDENCIES,
} from "./sandpackTheme";

export interface LiveDemoProps {
    files: SandpackFiles;
    /** Editor height in px. Defaults to 420. */
    height?: number;
    /** Defer bundler start until the user clicks run. */
    manualRun?: boolean;
}

/**
 * Live, editable Retree example. Always mounted lazily via LiveDemoIsland —
 * never import this component directly from a page.
 */
export default function LiveDemo({
    files,
    height = 420,
    manualRun = false,
}: LiveDemoProps) {
    return (
        <SandpackProvider
            template="react-ts"
            theme={retreeSandpackTheme}
            files={files}
            customSetup={{ dependencies: { ...SANDPACK_RETREE_DEPENDENCIES } }}
            options={{
                // LiveDemoIsland already defers mounting until the demo nears
                // the viewport; "immediate" here avoids Sandpack's own second
                // lazy layer, whose deferred CodeMirror init can leave the
                // editor unpainted until clicked (found in QA).
                initMode: "immediate",
                recompileMode: "delayed",
                recompileDelay: 500,
                autorun: !manualRun,
                autoReload: true,
            }}
        >
            <SandpackLayout
                style={{
                    borderRadius: "0.5rem",
                    border: "1px solid var(--border)",
                    background: "var(--code-bg)",
                }}
            >
                <SandpackCodeEditor
                    showTabs
                    showLineNumbers
                    showInlineErrors
                    showRunButton={manualRun}
                    wrapContent
                    style={{ height }}
                />
                <SandpackPreview
                    showOpenInCodeSandbox={false}
                    style={{ height }}
                />
            </SandpackLayout>
        </SandpackProvider>
    );
}
