import {
    createHighlighter,
    createCssVariablesTheme,
    type Highlighter,
} from "shiki";

/**
 * Shiki highlighter singleton using the css-variables theme, so highlighted
 * code follows the site's light/dark tokens (see --shiki-* in globals.css)
 * without re-rendering on theme switch.
 */

const cssVariablesTheme = createCssVariablesTheme({
    name: "css-variables",
    variablePrefix: "--shiki-",
    fontStyle: true,
});

const LANGS = [
    "ts",
    "tsx",
    "js",
    "jsx",
    "bash",
    "json",
    "css",
    "html",
    "diff",
] as const;

export type HighlightLang = (typeof LANGS)[number];

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
    highlighterPromise ??= createHighlighter({
        themes: [cssVariablesTheme],
        langs: [...LANGS],
    });
    return highlighterPromise;
}

export async function highlightCode(
    code: string,
    lang: string
): Promise<string> {
    const highlighter = await getHighlighter();
    const resolvedLang = (LANGS as readonly string[]).includes(lang)
        ? lang
        : "ts";
    return highlighter.codeToHtml(code, {
        lang: resolvedLang,
        theme: "css-variables",
    });
}
