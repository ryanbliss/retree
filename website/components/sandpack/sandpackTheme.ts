import type { SandpackTheme } from "@codesandbox/sandpack-react";

/**
 * Sandpack theme wired to the site's CSS custom properties, so embeds follow
 * light/dark switches without re-rendering.
 */
export const retreeSandpackTheme: SandpackTheme = {
    colors: {
        surface1: "var(--code-bg)",
        surface2: "var(--surface)",
        surface3: "var(--surface-raised)",
        disabled: "var(--faint)",
        base: "var(--foreground)",
        clickable: "var(--muted)",
        hover: "var(--foreground)",
        accent: "var(--accent-text)",
        error: "var(--danger)",
        errorSurface: "var(--surface)",
        warning: "var(--warning)",
        warningSurface: "var(--surface)",
    },
    syntax: {
        plain: "var(--shiki-foreground)",
        comment: {
            color: "var(--shiki-token-comment)",
            fontStyle: "italic",
        },
        keyword: "var(--shiki-token-keyword)",
        definition: "var(--shiki-token-function)",
        punctuation: "var(--shiki-token-punctuation)",
        property: "var(--shiki-token-function)",
        tag: "var(--shiki-token-keyword)",
        static: "var(--shiki-token-constant)",
        string: "var(--shiki-token-string)",
    },
    font: {
        body: "var(--font-geist-sans), system-ui, sans-serif",
        mono: "var(--font-geist-mono), ui-monospace, monospace",
        size: "13px",
        lineHeight: "1.6",
    },
};

/**
 * Exact published versions used by every live embed (spec §6). Core must be
 * listed explicitly: it is a peerDependency of @retreejs/react, and the
 * Sandpack bundler does not install peers transitively.
 */
export const SANDPACK_RETREE_DEPENDENCIES = {
    "@retreejs/core": "0.6.0",
    "@retreejs/react": "0.6.0",
} as const;
