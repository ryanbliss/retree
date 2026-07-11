/**
 * Generates public/sandpack.css at build time.
 *
 * Sandpack styles itself with a CSS-in-JS runtime (stitches). The old
 * approach — a <SandpackCSS /> client component in the root layout calling
 * getSandpackCssText() via useServerInsertedHTML — pulled sandpack-react and
 * CodeMirror into every page's client bundle, including pages with no live
 * demo. Instead, this script server-renders the exact Sandpack component tree
 * the site uses (LiveDemo.tsx, with the site theme) in Node, collects the CSS
 * stitches registered during that render, and writes it to a static file the
 * root layout links with a plain <link rel="stylesheet">.
 *
 * The stitches class names are content-hashed, so the names in the static
 * file match the ones the client generates at runtime. Pages without demos
 * pay ~2 kB of gzipped CSS instead of ~80 kB of gzipped JS; pages with demos
 * get styled SSR output with no flash of unstyled content.
 *
 * Wired into the `dev` and `build` npm scripts; also runnable standalone:
 *   node scripts/generate-sandpack-css.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The script imports components/sandpack/sandpackTheme.ts (the theme's single
// source of truth), which needs Node's TypeScript type stripping. When run
// under a Node without it enabled (< 23.6), re-exec once with the flag.
if (
    process.features.typescript === false ||
    process.features.typescript === undefined
) {
    const result = spawnSync(
        process.execPath,
        [
            "--experimental-strip-types",
            "--disable-warning=ExperimentalWarning",
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            fileURLToPath(import.meta.url),
        ],
        { stdio: "inherit" }
    );
    if (result.error !== undefined) {
        throw result.error;
    }
    process.exit(result.status ?? 1);
}

// sandpack-react may be hoisted to the workspace-root node_modules while the
// website has its own react copy. Resolve react/react-dom from sandpack's own
// location so the render and the library share a single React instance.
const localRequire = createRequire(import.meta.url);
const sandpackEntry = localRequire.resolve("@codesandbox/sandpack-react");
const sandpackRequire = createRequire(sandpackEntry);

const { createElement: h } = sandpackRequire("react");
const { renderToString } = sandpackRequire("react-dom/server");
const {
    getSandpackCssText,
    SandpackCodeEditor,
    SandpackLayout,
    SandpackPreview,
    SandpackProvider,
} = sandpackRequire("@codesandbox/sandpack-react");

const { retreeSandpackTheme } = await import(
    "../components/sandpack/sandpackTheme.ts"
);

/**
 * Mirrors the component tree in components/sandpack/LiveDemo.tsx so every
 * stitches rule that render path registers ends up in the CSS text. Rendered
 * in both run-button variants because stitches only emits variant styles that
 * a render actually uses.
 */
function renderLiveDemoVariant(showRunButton) {
    renderToString(
        h(
            SandpackProvider,
            {
                template: "react-ts",
                theme: retreeSandpackTheme,
                files: {
                    "/App.tsx":
                        "export default function App() { return null; }",
                },
            },
            h(
                SandpackLayout,
                null,
                h(SandpackCodeEditor, {
                    showTabs: true,
                    showLineNumbers: true,
                    showInlineErrors: true,
                    showRunButton,
                    wrapContent: true,
                }),
                h(SandpackPreview, { showOpenInCodeSandbox: false })
            )
        )
    );
}

renderLiveDemoVariant(false);
renderLiveDemoVariant(true);

const css = getSandpackCssText();
if (!css.includes("--sp-colors")) {
    throw new Error(
        "generate-sandpack-css: rendered CSS is missing --sp-colors theme variables; the Sandpack render likely failed to register the site theme."
    );
}

const outFile = path.join(websiteDir, "public", "sandpack.css");
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, css);
console.log(
    `generate-sandpack-css: wrote ${css.length} bytes to ${path.relative(
        websiteDir,
        outFile
    )}`
);
