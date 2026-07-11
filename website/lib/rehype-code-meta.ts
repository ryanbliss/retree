import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/**
 * Copies fenced-code meta strings (```tsx title="App.tsx" live) onto the
 * <code> element's properties so MDX component overrides can read them.
 */
export function rehypeCodeMeta() {
    return (tree: Root) => {
        visit(tree, "element", (node: Element) => {
            if (node.tagName !== "code") return;
            const meta = (node.data as { meta?: string } | undefined)?.meta;
            if (typeof meta === "string" && meta.length > 0) {
                node.properties.metastring = meta;
            }
        });
    };
}
